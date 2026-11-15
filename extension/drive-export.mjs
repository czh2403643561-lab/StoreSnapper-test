const SETTINGS_KEY = 'storesnapper1688ExportSettings';
const TOKEN_KEY = 'storesnapper1688DriveSessionToken';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const CHUNK_BYTES = 1024 * 1024;
const MAX_ARCHIVE_BYTES = 96 * 1024 * 1024;
const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

export function isDriveExportMessage(type) {
  return [
    'STORESNAPPER_1688_EXPORT_SETTINGS_GET',
    'STORESNAPPER_1688_EXPORT_SETTINGS_SAVE',
    'STORESNAPPER_1688_DRIVE_PICK_FOLDER',
    'STORESNAPPER_1688_DRIVE_DISCONNECT',
  ].includes(type);
}

export async function handleDriveExportMessage(message, sender) {
  assertCollectorSender(sender);

  if (message.type === 'STORESNAPPER_1688_EXPORT_SETTINGS_GET') {
    return publicSettings(await readSettings());
  }

  if (message.type === 'STORESNAPPER_1688_EXPORT_SETTINGS_SAVE') {
    const current = await readSettings();
    const mode = message.mode === 'drive' ? 'drive' : 'local';
    const clientId = validateClientId(message.clientId || current.clientId || '');
    const changedClient = Boolean(current.clientId && clientId && current.clientId !== clientId);
    const next = {
      ...current,
      mode,
      clientId,
      ...(changedClient ? { folderId: '', folderName: '' } : {}),
    };
    await chrome.storage.local.set({ [SETTINGS_KEY]: next });
    if (changedClient) await chrome.storage.session.remove(TOKEN_KEY);
    return publicSettings(next);
  }

  if (message.type === 'STORESNAPPER_1688_DRIVE_PICK_FOLDER') {
    const current = await readSettings();
    const clientId = validateClientId(message.clientId || current.clientId || '');
    const authorization = await authorizeGoogle(clientId, { picker: true, interactive: true });
    const folderId = authorization.pickedIds[0];
    if (!folderId) throw new Error('没有选中 Google Drive 文件夹。');
    const folder = await getDriveFolder(authorization.accessToken, folderId);
    if (folder.mimeType !== FOLDER_MIME_TYPE) throw new Error('所选项目不是文件夹，请重新选择目标文件夹。');

    const next = { ...current, clientId, mode: 'drive', folderId, folderName: folder.name };
    await chrome.storage.local.set({ [SETTINGS_KEY]: next });
    await saveSessionToken(authorization.accessToken, authorization.expiresIn);
    return publicSettings(next);
  }

  if (message.type === 'STORESNAPPER_1688_DRIVE_DISCONNECT') {
    const current = await readSettings();
    const next = { ...current, mode: 'local', folderId: '', folderName: '' };
    await chrome.storage.local.set({ [SETTINGS_KEY]: next });
    await chrome.storage.session.remove(TOKEN_KEY);
    return publicSettings(next);
  }

  throw new Error('不支持的 Google Drive 设置操作。');
}

export function handleDriveUploadPort(port) {
  if (port.name !== 'STORESNAPPER_1688_DRIVE_UPLOAD') return;
  try {
    assertCollectorSender(port.sender);
  } catch {
    port.disconnect();
    return;
  }

  const state = { queue: Promise.resolve(), phase: 'waiting', controller: new AbortController() };
  port.onDisconnect.addListener(() => state.controller.abort(new Error('Google Drive 上传已中断。')));
  port.onMessage.addListener((message) => {
    state.queue = state.queue
      .then(() => handleUploadMessage(port, state, message))
      .catch((error) => failPort(port, state, error));
  });
}

async function handleUploadMessage(port, state, message) {
  if (message?.type === 'start') {
    if (state.phase !== 'waiting') throw new Error('Google Drive 上传已开始。');
    const settings = await readSettings();
    if (settings.mode !== 'drive' || !settings.folderId) throw new Error('请先在采集面板设置中绑定 Google Drive 文件夹。');
    if (String(message.offerId || '') !== extractOfferId(port.sender.url)) throw new Error('商品页面已变化，请对当前商品重新采集。');
    const totalBytes = Number(message.totalBytes);
    if (!Number.isSafeInteger(totalBytes) || totalBytes <= 0 || totalBytes > MAX_ARCHIVE_BYTES) throw new Error('ZIP 大小超出 Google Drive 上传限制。');
    const filename = sanitizeFilename(message.filename);
    if (extractFilenameOfferId(filename) !== String(message.offerId)) throw new Error('ZIP 与当前商品编号不一致，请重新采集。');
    const token = await getAccessToken(settings.clientId);
    const sessionUrl = await createResumableSession(token, settings.folderId, filename, totalBytes, state.controller.signal);
    state.phase = 'uploading';
    state.upload = { settings, token, sessionUrl, filename, totalBytes, nextOffset: 0, offerId: String(message.offerId) };
    port.postMessage({ type: 'ready' });
    return;
  }

  if (message?.type === 'chunk') {
    if (state.phase !== 'uploading' || !state.upload) throw new Error('Google Drive 上传尚未准备好。');
    await uploadChunk(port, state, message);
    return;
  }

  throw new Error('Google Drive 上传数据无效。');
}

async function uploadChunk(port, state, message) {
  const upload = state.upload;
  const offset = Number(message.offset);
  const bytes = decodeBase64(message.data);
  if (!Number.isSafeInteger(offset) || offset !== upload.nextOffset) throw new Error('Google Drive 上传顺序异常，请重新上传。');
  const expectedLength = Math.min(CHUNK_BYTES, upload.totalBytes - offset);
  if (bytes.byteLength !== expectedLength) throw new Error('Google Drive 上传分块大小不匹配。');
  const end = offset + bytes.byteLength - 1;
  let token = upload.token;
  let response;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      response = await fetch(upload.sessionUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/zip',
          'Content-Range': `bytes ${offset}-${end}/${upload.totalBytes}`,
        },
        body: bytes,
        signal: state.controller.signal,
      });
      if (response.status === 401 && attempt === 0) {
        await chrome.storage.session.remove(TOKEN_KEY);
        token = await getAccessToken(upload.settings.clientId);
        upload.token = token;
        continue;
      }
      if ((response.status >= 500 || response.status === 429) && attempt < 2) {
        await pause(400 * (attempt + 1), state.controller.signal);
        continue;
      }
      if (response.status === 308) {
        const range = response.headers.get('Range') || '';
        const received = range.match(/bytes=0-(\d+)/i);
        const nextOffset = received ? Number(received[1]) + 1 : 0;
        if (nextOffset === end + 1) {
          upload.nextOffset = nextOffset;
          port.postMessage({ type: 'chunk_ack', offset: nextOffset, totalBytes: upload.totalBytes });
          return;
        }
        if (nextOffset !== offset) throw new Error('Google Drive 返回了不连续的上传位置。');
        if (attempt < 2) continue;
        throw new Error('Google Drive 尚未确认上传数据，请稍后重试。');
      }
      if ((response.status === 200 || response.status === 201) && end + 1 === upload.totalBytes) {
        const file = await response.json().catch(() => ({}));
        upload.nextOffset = upload.totalBytes;
        port.postMessage({ type: 'chunk_ack', offset: upload.nextOffset, totalBytes: upload.totalBytes });
        port.postMessage({ type: 'done', file: { id: file.id || '', name: file.name || upload.filename } });
        state.phase = 'done';
        return;
      }
      throw await driveError(response, 'Google Drive 上传失败。');
    } catch (error) {
      if (state.controller.signal.aborted) throw state.controller.signal.reason || error;
      if (error?.message?.includes('Google Drive')) throw error;
      if (attempt === 2) throw new Error('连接 Google Drive 失败，请检查网络后重试。');
      await pause(400 * (attempt + 1), state.controller.signal);
    }
  }
}

async function createResumableSession(accessToken, folderId, filename, totalBytes, signal) {
  const url = new URL(`${DRIVE_UPLOAD_API}/files`);
  url.searchParams.set('uploadType', 'resumable');
  url.searchParams.set('supportsAllDrives', 'true');
  url.searchParams.set('fields', 'id,name,webViewLink');
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': 'application/zip',
      'X-Upload-Content-Length': String(totalBytes),
    },
    body: JSON.stringify({ name: filename, mimeType: 'application/zip', parents: [folderId] }),
    signal,
  });
  if (!response.ok) throw await driveError(response, '无法在所选 Google Drive 文件夹创建 ZIP。');
  const sessionUrl = response.headers.get('Location');
  if (!sessionUrl || !sessionUrl.startsWith('https://www.googleapis.com/upload/drive/')) throw new Error('Google Drive 未返回有效的上传地址。');
  return sessionUrl;
}

async function getAccessToken(clientId) {
  const stored = await chrome.storage.session.get(TOKEN_KEY);
  if (stored[TOKEN_KEY]?.accessToken && stored[TOKEN_KEY].expiresAt > Date.now() + 60_000) return stored[TOKEN_KEY].accessToken;
  try {
    const authorization = await authorizeGoogle(validateClientId(clientId), { picker: false, interactive: false });
    await saveSessionToken(authorization.accessToken, authorization.expiresIn);
    return authorization.accessToken;
  } catch {
    throw new Error('Google Drive 授权已过期，请打开采集设置重新连接并选择文件夹。');
  }
}

async function authorizeGoogle(clientId, { picker, interactive }) {
  if (!chrome.identity?.launchWebAuthFlow || !chrome.identity?.getRedirectURL) throw new Error('当前 Chrome 不支持 Google Drive 授权，请升级浏览器后重试。');
  const validClientId = validateClientId(clientId);
  if (!validClientId) throw new Error('请先在采集设置中填写 Google OAuth 客户端 ID。');
  const state = randomState();
  const redirectUri = chrome.identity.getRedirectURL('drive-picker');
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', validClientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'token');
  url.searchParams.set('scope', DRIVE_SCOPE);
  url.searchParams.set('state', state);
  url.searchParams.set('prompt', picker ? 'consent select_account' : 'none');
  if (picker) {
    url.searchParams.set('trigger_onepick', 'true');
    url.searchParams.set('allow_folder_selection', 'true');
    url.searchParams.set('mimetypes', FOLDER_MIME_TYPE);
  }

  let redirected;
  try {
    redirected = await chrome.identity.launchWebAuthFlow({ url: url.href, interactive });
  } catch {
    throw new Error(picker ? 'Google Drive 授权或文件夹选择未完成。' : '无法静默刷新 Google Drive 授权。');
  }
  if (!redirected) throw new Error('Google Drive 授权没有返回结果。');
  const resultUrl = new URL(redirected);
  const query = resultUrl.searchParams;
  const fragment = new URLSearchParams(resultUrl.hash.replace(/^#/, ''));
  const returnedState = query.get('state') || fragment.get('state');
  if (returnedState !== state) throw new Error('Google Drive 授权状态校验失败，请重新连接。');
  const oauthError = query.get('error') || fragment.get('error');
  if (oauthError) throw new Error(oauthError === 'access_denied' ? '你取消了 Google Drive 授权。' : `Google Drive 授权失败：${oauthError}`);
  const accessToken = fragment.get('access_token') || query.get('access_token') || query.get('code') || fragment.get('code');
  if (!accessToken) throw new Error('Google Drive 没有返回访问令牌。');
  const picked = query.get('picked_file_ids') || fragment.get('picked_file_ids') || '';
  const pickedIds = picked.split(',').map((value) => value.trim()).filter((value) => /^[A-Za-z0-9_-]+$/.test(value));
  if (picker && !pickedIds.length) throw new Error('未选择文件夹；请重新选择一个 Google Drive 文件夹。');
  const expiresIn = Number(fragment.get('expires_in') || query.get('expires_in') || 3600);
  return { accessToken, expiresIn: Number.isFinite(expiresIn) ? expiresIn : 3600, pickedIds };
}

async function getDriveFolder(accessToken, folderId) {
  const url = new URL(`${DRIVE_API}/files/${encodeURIComponent(folderId)}`);
  url.searchParams.set('fields', 'id,name,mimeType');
  url.searchParams.set('supportsAllDrives', 'true');
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw await driveError(response, '无法读取所选 Google Drive 文件夹。');
  return response.json();
}

async function driveError(response, fallback) {
  let detail = '';
  try {
    const body = await response.json();
    detail = String(body?.error?.message || '').slice(0, 180);
  } catch { /* The response may have no JSON body. */ }
  return new Error(`${fallback}${detail ? ` ${detail}` : ''}（${response.status}）`);
}

async function readSettings() {
  const saved = await chrome.storage.local.get(SETTINGS_KEY);
  const value = saved[SETTINGS_KEY] || {};
  return {
    mode: value.mode === 'drive' ? 'drive' : 'local',
    clientId: typeof value.clientId === 'string' ? value.clientId : '',
    folderId: typeof value.folderId === 'string' ? value.folderId : '',
    folderName: typeof value.folderName === 'string' ? value.folderName : '',
  };
}

function publicSettings(value) {
  return { mode: value.mode, clientId: value.clientId, folderId: value.folderId, folderName: value.folderName };
}

function validateClientId(value) {
  const clientId = String(value || '').trim();
  if (!clientId) return '';
  if (!/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId)) throw new Error('Google OAuth 客户端 ID 格式不正确。');
  return clientId;
}

function assertCollectorSender(sender) {
  const url = String(sender?.url || '');
  if (!sender?.tab?.id || !/^https:\/\/detail\.1688\.com\/offer\/\d+\.html(?:[?#].*)?$/i.test(url)) throw new Error('仅允许 1688 商品采集面板使用 Google Drive 导出。');
}

function extractOfferId(url) {
  return String(url || '').match(/^https:\/\/detail\.1688\.com\/offer\/(\d+)\.html/i)?.[1] || '';
}

function extractFilenameOfferId(filename) {
  return String(filename || '').match(/^StoreSnapper-1688-(\d+)-/i)?.[1] || '';
}

function sanitizeFilename(value) {
  const filename = String(value || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  if (!/^StoreSnapper-1688-\d+-[\d-]+\.zip$/i.test(filename)) throw new Error('ZIP 文件名无效。');
  return filename.slice(0, 180);
}

function decodeBase64(value) {
  if (typeof value !== 'string' || value.length > Math.ceil(CHUNK_BYTES * 4 / 3) + 8) throw new Error('Google Drive 上传分块无效。');
  let binary;
  try { binary = atob(value); } catch { throw new Error('Google Drive 上传分块编码无效。'); }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function saveSessionToken(accessToken, expiresIn) {
  const duration = Math.max(60, Number(expiresIn) || 3600) * 1000;
  await chrome.storage.session.set({ [TOKEN_KEY]: { accessToken, expiresAt: Date.now() + duration } });
}

function randomState() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function pause(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason || new Error('Google Drive 上传已中断。'));
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(signal.reason || new Error('Google Drive 上传已中断。'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function failPort(port, state, error) {
  state.phase = 'failed';
  try { port.postMessage({ type: 'error', error: error?.message || 'Google Drive 上传失败。' }); } catch { /* The collector tab may have closed. */ }
  try { port.disconnect(); } catch { /* The port may already be closed. */ }
}
