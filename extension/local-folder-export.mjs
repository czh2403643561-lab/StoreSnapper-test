const SETTINGS_KEY = 'storesnapper1688ExportSettings';
const WRITER_PAGE = 'file-writer.html';
const CHUNK_BYTES = 1024 * 1024;
const MAX_ARCHIVE_BYTES = 96 * 1024 * 1024;
let writerBusy = false;

export function isLocalFolderMessage(type) {
  return type === 'STORESNAPPER_1688_OPEN_FOLDER_SETTINGS';
}

export async function clearLegacyDriveData() {
  const saved = await chrome.storage.local.get(SETTINGS_KEY).catch(() => ({}));
  const current = saved[SETTINGS_KEY] || {};
  if (current.mode === 'drive' || current.clientId || current.folderId) {
    await chrome.storage.local.set({
      [SETTINGS_KEY]: {
        mode: current.mode === 'folder' && current.folderName ? 'folder' : 'local',
        folderName: current.mode === 'folder' ? String(current.folderName || '') : '',
      },
    }).catch(() => undefined);
  }
  await chrome.storage.session?.remove('storesnapper1688DriveSessionToken').catch(() => undefined);
}

export async function handleLocalFolderMessage(message, sender) {
  assertCollectorSender(sender);
  if (message.type !== 'STORESNAPPER_1688_OPEN_FOLDER_SETTINGS') throw new Error('不支持的本机文件夹操作。');
  await chrome.tabs.create({ url: chrome.runtime.getURL('folder-settings.html'), active: true });
  return { opened: true };
}

export function handleLocalFolderExportPort(port) {
  if (port.name !== 'STORESNAPPER_1688_LOCAL_FOLDER_EXPORT') return;
  try {
    assertCollectorSender(port.sender);
  } catch {
    port.disconnect();
    return;
  }

  const state = { queue: Promise.resolve(), phase: 'waiting', disconnected: false, writerClaimed: false, offerId: '', totalBytes: 0, nextOffset: 0 };
  port.onDisconnect.addListener(() => {
    state.disconnected = true;
    if (state.phase === 'uploading') {
      state.phase = 'cancelled';
      state.queue = state.queue
        .catch(() => undefined)
        .then(() => sendWriterMessage({ type: 'LOCAL_EXPORT_WRITER_CANCEL' }))
        .finally(async () => {
          await closeWriterDocument();
          if (state.writerClaimed) writerBusy = false;
          state.writerClaimed = false;
        });
    }
  });
  port.onMessage.addListener((message) => {
    state.queue = state.queue
      .then(() => handleExportMessage(port, state, message))
      .catch((error) => failPort(port, state, error));
  });
}

async function handleExportMessage(port, state, message) {
  if (state.disconnected) return;
  if (message?.type === 'start') {
    if (state.phase !== 'waiting') throw new Error('ZIP 保存任务已开始。');
    if (writerBusy) throw new Error('另一个 ZIP 正在保存，请稍等后重试。');
    const settings = await chrome.storage.local.get(SETTINGS_KEY);
    const destination = settings[SETTINGS_KEY] || {};
    if (destination.mode !== 'folder' || !destination.folderName) throw new Error('请先选择一个本机保存文件夹。');
    const offerId = String(message.offerId || '');
    if (offerId !== extractOfferId(port.sender.url)) throw new Error('商品页面已变化，请对当前商品重新采集。');
    const filename = sanitizeFilename(message.filename);
    if (extractFilenameOfferId(filename) !== offerId) throw new Error('ZIP 与当前商品编号不一致，请重新采集。');
    const totalBytes = Number(message.totalBytes);
    if (!Number.isSafeInteger(totalBytes) || totalBytes <= 0 || totalBytes > MAX_ARCHIVE_BYTES) throw new Error('ZIP 大小超出本机保存限制。');

    writerBusy = true;
    state.writerClaimed = true;
    try {
      await ensureWriterDocument();
      if (state.disconnected) throw new Error('页面已关闭，已取消 ZIP 保存。');
      const response = await sendWriterMessage({ type: 'LOCAL_EXPORT_WRITER_START', filename, totalBytes });
      if (!response?.ok) throw new Error(response?.error || '无法写入所选文件夹。');
      state.phase = 'uploading';
      state.filename = filename;
      state.folderName = destination.folderName;
      state.totalBytes = totalBytes;
      state.offerId = offerId;
      state.nextOffset = 0;
      if (state.disconnected) {
        await sendWriterMessage({ type: 'LOCAL_EXPORT_WRITER_CANCEL' });
        state.phase = 'cancelled';
        writerBusy = false;
        await closeWriterDocument();
        return;
      }
      port.postMessage({ type: 'ready' });
    } catch (error) {
      writerBusy = false;
      state.writerClaimed = false;
      await closeWriterDocument();
      throw error;
    }
    return;
  }

  if (message?.type === 'chunk') {
    if (state.phase !== 'uploading') throw new Error('ZIP 保存任务尚未准备好。');
    const offset = Number(message.offset);
    const bytes = decodeBase64(message.data);
    if (!Number.isSafeInteger(offset) || offset !== state.nextOffset) throw new Error('ZIP 保存顺序异常，请重试。');
    const expectedLength = Math.min(CHUNK_BYTES, state.totalBytes - offset);
    if (bytes.byteLength !== expectedLength) throw new Error('ZIP 保存分块大小不匹配。');
    const response = await sendWriterMessage({ type: 'LOCAL_EXPORT_WRITER_CHUNK', offset, data: message.data });
    if (!response?.ok || response.offset !== offset + bytes.byteLength) throw new Error(response?.error || '本机文件夹未确认写入。');
    state.nextOffset = response.offset;
    port.postMessage({ type: 'chunk_ack', offset: state.nextOffset, totalBytes: state.totalBytes });
    if (response.done) {
      state.phase = 'done';
      writerBusy = false;
      state.writerClaimed = false;
      port.postMessage({ type: 'done', file: { name: response.filename || state.filename }, folderName: state.folderName });
      await closeWriterDocument();
    }
    return;
  }

  throw new Error('本机 ZIP 保存数据无效。');
}

async function ensureWriterDocument() {
  if (!chrome.offscreen?.createDocument || !chrome.runtime.getContexts) throw new Error('当前 Chrome 不支持静默保存文件夹，请升级浏览器后重试。');
  const url = chrome.runtime.getURL(WRITER_PAGE);
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] });
  if (contexts.length) return;
  await chrome.offscreen.createDocument({
    url: WRITER_PAGE,
    reasons: ['BLOBS'],
    justification: 'Write the ZIP archive to the folder the user selected for 1688 exports.',
  });
}

async function sendWriterMessage(message) {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await chrome.runtime.sendMessage(message);
      if (response) return response;
      lastError = new Error('本机文件保存组件尚未就绪。');
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 80 * (attempt + 1)));
  }
  throw new Error(lastError?.message || '无法连接本机文件保存组件。');
}

async function closeWriterDocument() {
  try {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [chrome.runtime.getURL(WRITER_PAGE)],
    });
    if (contexts.length) await chrome.offscreen.closeDocument();
  } catch { /* Chrome may already have closed the offscreen document. */ }
}

function failPort(port, state, error) {
  if (state.phase === 'uploading') {
    void sendWriterMessage({ type: 'LOCAL_EXPORT_WRITER_CANCEL' }).finally(closeWriterDocument);
  }
  if (state.writerClaimed && !state.disconnected) {
    writerBusy = false;
    state.writerClaimed = false;
  }
  state.phase = 'failed';
  try { port.postMessage({ type: 'error', error: error?.message || '本机 ZIP 保存失败。' }); } catch { /* The collector tab may already be closed. */ }
  try { port.disconnect(); } catch { /* The port may already be closed. */ }
}

function assertCollectorSender(sender) {
  const url = String(sender?.url || '');
  if (sender?.tab?.id === undefined || !/^https:\/\/detail\.1688\.com\/offer\/\d+\.html(?:[?#].*)?$/i.test(url)) {
    throw new Error('仅允许 1688 商品采集面板使用本机文件夹导出。');
  }
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
  if (typeof value !== 'string' || value.length > Math.ceil(CHUNK_BYTES * 4 / 3) + 8) throw new Error('ZIP 保存分块无效。');
  let binary;
  try { binary = atob(value); } catch { throw new Error('ZIP 保存分块编码无效。'); }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
