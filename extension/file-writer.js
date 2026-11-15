(() => {
  const DB_NAME = 'storesnapper-local-exports';
  const STORE_NAME = 'handles';
  const HANDLE_KEY = '1688-export-directory';
  const CHUNK_BYTES = 1024 * 1024;
  let activeWrite;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender?.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return false;
    if (!['LOCAL_EXPORT_WRITER_START', 'LOCAL_EXPORT_WRITER_CHUNK', 'LOCAL_EXPORT_WRITER_CANCEL'].includes(message?.type)) return false;
    if (message.type === 'LOCAL_EXPORT_WRITER_CANCEL') {
      void abortActiveWrite().then(() => sendResponse({ ok: true }));
      return true;
    }
    const operation = message.type === 'LOCAL_EXPORT_WRITER_START' ? startWrite(message) : writeChunk(message);
    void operation.then(sendResponse).catch((error) => sendResponse({ ok: false, error: error?.message || '无法写入所选文件夹。' }));
    return true;
  });

  async function startWrite(message) {
    if (activeWrite) throw new Error('已有一个 ZIP 正在写入本机文件夹。');
    const totalBytes = Number(message.totalBytes);
    if (!Number.isSafeInteger(totalBytes) || totalBytes <= 0) throw new Error('ZIP 大小无效。');
    const directory = await readDirectoryHandle();
    if (!directory) throw new Error('找不到已选择的本机文件夹，请重新选择。');
    const permission = await directory.queryPermission({ mode: 'readwrite' }).catch(() => 'denied');
    if (permission !== 'granted') throw new Error('Chrome 需要重新确认此文件夹的写入权限。打开导出设置并点击“恢复访问权限”。');

    const filename = await chooseUnusedFilename(directory, sanitizeFilename(message.filename));
    const fileHandle = await directory.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    activeWrite = { writable, filename, totalBytes, nextOffset: 0 };
    return { ok: true, filename };
  }

  async function writeChunk(message) {
    if (!activeWrite) throw new Error('本机文件写入尚未开始。');
    const offset = Number(message.offset);
    const bytes = decodeBase64(message.data);
    if (!Number.isSafeInteger(offset) || offset !== activeWrite.nextOffset) throw new Error('本机文件写入顺序异常。');
    const expectedLength = Math.min(CHUNK_BYTES, activeWrite.totalBytes - offset);
    if (bytes.byteLength !== expectedLength) throw new Error('本机文件写入分块大小不匹配。');
    await activeWrite.writable.write(bytes);
    activeWrite.nextOffset += bytes.byteLength;
    const response = { ok: true, offset: activeWrite.nextOffset, done: activeWrite.nextOffset === activeWrite.totalBytes };
    if (response.done) {
      response.filename = activeWrite.filename;
      await activeWrite.writable.close();
      activeWrite = undefined;
    }
    return response;
  }

  async function abortActiveWrite() {
    if (!activeWrite) return;
    const write = activeWrite;
    activeWrite = undefined;
    await write.writable.abort().catch(() => undefined);
  }

  async function readDirectoryHandle() {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(HANDLE_KEY);
      request.onsuccess = () => { database.close(); resolve(request.result); };
      request.onerror = () => { database.close(); reject(request.error || new Error('无法读取已选文件夹。')); };
    });
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('无法打开本机文件夹设置。'));
    });
  }

  async function chooseUnusedFilename(directory, filename) {
    const stem = filename.replace(/\.zip$/i, '');
    let candidate = filename;
    let suffix = 2;
    while (true) {
      try {
        await directory.getFileHandle(candidate);
        candidate = `${stem}-${suffix}.zip`;
        suffix += 1;
      } catch (error) {
        if (error?.name === 'NotFoundError') return candidate;
        if (error?.name === 'TypeMismatchError') {
          candidate = `${stem}-${suffix}.zip`;
          suffix += 1;
          continue;
        }
        throw error;
      }
    }
  }

  function sanitizeFilename(value) {
    const filename = String(value || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
    if (!/^StoreSnapper-1688-\d+-[\d-]+\.zip$/i.test(filename)) throw new Error('ZIP 文件名无效。');
    return filename.slice(0, 180);
  }

  function decodeBase64(value) {
    if (typeof value !== 'string' || value.length > Math.ceil(CHUNK_BYTES * 4 / 3) + 8) throw new Error('ZIP 分块无效。');
    let binary;
    try { binary = atob(value); } catch { throw new Error('ZIP 分块编码无效。'); }
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }
})();
