(() => {
  const SETTINGS_KEY = 'storesnapper1688ExportSettings';
  const DB_NAME = 'storesnapper-local-exports';
  const STORE_NAME = 'handles';
  const HANDLE_KEY = '1688-export-directory';
  const view = {
    folder: document.querySelector('.folder-name'),
    choose: document.querySelector('.choose'),
    restore: document.querySelector('.restore'),
    clear: document.querySelector('.clear'),
    status: document.querySelector('.status'),
  };
  let directoryHandle;

  view.choose.addEventListener('click', () => void chooseFolder());
  view.restore.addEventListener('click', () => void restorePermission());
  view.clear.addEventListener('click', () => void clearFolder());
  void refresh();

  async function refresh() {
    directoryHandle = await readHandle().catch(() => undefined);
    view.folder.textContent = directoryHandle?.name || '尚未选择';
    view.clear.hidden = !directoryHandle;
    if (!directoryHandle) {
      view.restore.hidden = true;
      return;
    }
    const permission = await queryWritePermission(directoryHandle);
    view.restore.hidden = permission === 'granted';
    setStatus(permission === 'granted' ? '文件夹已准备好，可以回到 1688 页面采集。' : 'Chrome 需要重新确认这个文件夹的写入权限。', permission !== 'granted');
  }

  async function chooseFolder() {
    if (typeof window.showDirectoryPicker !== 'function') {
      setStatus('当前 Chrome 不支持文件夹直存，请升级浏览器后重试。', true);
      return;
    }
    setBusy(true);
    try {
      const options = { id: 'storesnapper-1688-export', mode: 'readwrite' };
      if (directoryHandle) options.startIn = directoryHandle;
      directoryHandle = await window.showDirectoryPicker(options);
      await saveHandle(directoryHandle);
      const permission = await queryWritePermission(directoryHandle);
      if (permission !== 'granted') {
        const requested = await requestWritePermission(directoryHandle);
        if (requested !== 'granted') {
          await saveFolderSettings(directoryHandle.name, 'folder');
          await refresh();
          setStatus('文件夹已记住，但 Chrome 尚未允许写入。点“恢复此文件夹的访问权限”再授权。', true);
          return;
        }
      }
      await saveFolderSettings(directoryHandle.name, 'folder');
      await refresh();
      setStatus(`已选择“${directoryHandle.name}”。ZIP 将直接保存到这个文件夹。`);
    } catch (error) {
      if (error?.name === 'AbortError') setStatus('已取消选择，原设置保留。');
      else setStatus(error?.message || '无法保存这个文件夹，请重试。', true);
    } finally {
      setBusy(false);
    }
  }

  async function restorePermission() {
    if (!directoryHandle) return;
    setBusy(true);
    try {
      const permission = await requestWritePermission(directoryHandle);
      if (permission !== 'granted') throw new Error('Chrome 未允许访问此文件夹。');
      await saveFolderSettings(directoryHandle.name, 'folder');
      await refresh();
      setStatus(`已恢复“${directoryHandle.name}”的访问权限。`);
    } catch (error) {
      setStatus(error?.message || '无法恢复文件夹访问权限。', true);
    } finally {
      setBusy(false);
    }
  }

  async function clearFolder() {
    setBusy(true);
    try {
      await deleteHandle();
      directoryHandle = undefined;
      await saveFolderSettings('', 'local');
      await refresh();
      setStatus('已清除保存文件夹设置，采集会使用浏览器下载。');
    } catch (error) {
      setStatus(error?.message || '清除文件夹设置失败。', true);
    } finally {
      setBusy(false);
    }
  }

  async function saveFolderSettings(folderName, mode) {
    await chrome.storage.local.set({
      [SETTINGS_KEY]: { mode, folderName },
    });
  }

  async function queryWritePermission(handle) {
    try { return await handle.queryPermission({ mode: 'readwrite' }); }
    catch { return 'denied'; }
  }

  async function requestWritePermission(handle) {
    try { return await handle.requestPermission({ mode: 'readwrite' }); }
    catch { return 'denied'; }
  }

  function setBusy(busy) {
    view.choose.disabled = busy;
    view.restore.disabled = busy;
    view.clear.disabled = busy;
  }

  function setStatus(message, isError = false) {
    view.status.textContent = message || '';
    view.status.className = `status${isError ? ' error' : ''}`;
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('无法打开本机文件夹设置。'));
    });
  }

  async function readHandle() {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(HANDLE_KEY);
      request.onsuccess = () => { database.close(); resolve(request.result); };
      request.onerror = () => { database.close(); reject(request.error); };
    });
  }

  async function saveHandle(handle) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(handle, HANDLE_KEY);
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => { database.close(); reject(transaction.error); };
      transaction.onabort = () => { database.close(); reject(transaction.error || new Error('无法保存文件夹授权。')); };
    });
  }

  async function deleteHandle() {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).delete(HANDLE_KEY);
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => { database.close(); reject(transaction.error); };
      transaction.onabort = () => { database.close(); reject(transaction.error || new Error('无法删除文件夹授权。')); };
    });
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && Object.hasOwn(changes, SETTINGS_KEY)) void refresh();
  });
})();
