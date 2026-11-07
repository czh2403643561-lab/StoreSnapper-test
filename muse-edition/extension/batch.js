import { exportRows, normalizeSources, parseCsv, parseXlsx, toCsv, toHtml, toZip } from './batch-core.mjs';

const KEY = 'storesnapper_muse_batch_v1';
const fileInput = document.querySelector('#file');
const dropZone = document.querySelector('#drop-zone');
const intervalInput = document.querySelector('#interval');
const fileInfo = document.querySelector('#file-info');
const startButton = document.querySelector('#start');
const pauseButton = document.querySelector('#pause');
const progress = document.querySelector('#progress');
const activity = document.querySelector('#activity');
const rowsBody = document.querySelector('#rows');
const exportButtons = ['csv', 'json', 'html', 'zip'].map((format) => document.querySelector(`#export-${format}`));
let batch = null;
let running = false;
let pauseRequested = false;
let currentRequestId = null;
let renderedBatch = null;
const batchTab = await chrome.tabs.getCurrent();

function setActivity(message, error = false) {
  activity.textContent = message;
  activity.classList.toggle('error', error);
}

async function save() {
  if (batch) await chrome.storage.local.set({ [KEY]: batch });
}

function render() {
  const rows = batch?.rows || [];
  const finished = rows.filter((row) => ['完成', '无'].includes(row.status)).length;
  const canContinue = rows.some((row) => !['完成', '无'].includes(row.status));
  progress.textContent = `${finished} / ${rows.length} 已完成`;
  fileInfo.textContent = batch ? `${batch.filename} · ${rows.length} 条 · 结果只保存在此浏览器的扩展本地存储中。` : '尚未导入文件。';
  intervalInput.value = String(batch?.intervalSeconds || 5);
  intervalInput.disabled = running;
  fileInput.disabled = running;
  dropZone.disabled = running;
  startButton.disabled = running || !canContinue;
  pauseButton.disabled = !running || pauseRequested;
  for (const button of exportButtons) button.disabled = rows.length === 0;
  if (renderedBatch !== batch) {
    rowsBody.replaceChildren();
    for (const row of rows) {
      const tr = document.createElement('tr');
      const rank = document.createElement('td'); rank.textContent = row.source_rank;
      const picture = document.createElement('td');
      const link = document.createElement('a');
      link.href = row.source_image_url; link.target = '_blank'; link.rel = 'noopener noreferrer';
      const image = document.createElement('img'); image.src = row.source_image_url; image.alt = `rank ${row.source_rank} 原图`; image.referrerPolicy = 'no-referrer'; image.loading = 'lazy';
      link.append(image); picture.append(link);
      const title = document.createElement('td'); title.className = 'title'; title.textContent = row.source_title;
      const status = document.createElement('td');
      const count = document.createElement('td');
      const note = document.createElement('td'); note.className = 'note';
      tr.append(rank, picture, title, status, count, note);
      rowsBody.append(tr);
    }
    renderedBatch = batch;
  }
  for (let index = 0; index < rows.length; index += 1) {
    const cells = rowsBody.children[index].children;
    cells[3].textContent = rows[index].status;
    cells[4].textContent = `${rows[index].candidates?.length || 0} / ${rows[index].similarTotal || 0}`;
    cells[5].textContent = rows[index].error || '';
  }
}

function currentInterval() {
  const seconds = Math.min(60, Math.max(3, Number(intervalInput.value) || 5));
  intervalInput.value = String(seconds);
  return seconds;
}

async function importFile(file) {
  if (!file || running) return;
  try {
    if (file.size > 10 * 1024 * 1024) throw new Error('文件超过 10 MB，请拆分榜单。');
    const name = file.name.toLowerCase();
    let table;
    if (name.endsWith('.csv')) table = parseCsv(await file.text());
    else if (name.endsWith('.xlsx')) table = parseXlsx(await file.arrayBuffer(), globalThis.fflate?.unzipSync);
    else throw new Error('请选择 .csv 或 .xlsx 文件。');
    const rows = normalizeSources(table);
    batch = { filename: file.name, importedAt: new Date().toISOString(), intervalSeconds: currentInterval(), rows };
    await save();
    render();
    setActivity(`已导入 ${rows.length} 条。请确认 1688 已登录，再开始搜图。`);
  } catch (error) {
    setActivity(error?.message || '文件导入失败。', true);
  }
}

async function waitBetweenRows(seconds) {
  const end = Date.now() + seconds * 1000;
  while (!pauseRequested && Date.now() < end) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(200, end - Date.now())));
  }
}

async function run() {
  if (!batch || running) return;
  if (batchTab?.id === undefined) { setActivity('无法识别批量页标签，请关闭后从工具栏图标重新打开。', true); return; }
  running = true;
  pauseRequested = false;
  batch.intervalSeconds = currentInterval();
  render();
  try {
    for (const row of batch.rows) {
      if (pauseRequested) break;
      if (['完成', '无'].includes(row.status)) continue;
      row.status = '进行中';
      row.error = '';
      row.candidates = [];
      row.similarTotal = 0;
      await save();
      render();
      setActivity(`正在搜索 rank ${row.source_rank}：准备图片…`);
      const requestId = crypto.randomUUID();
      currentRequestId = requestId;
      let response;
      try {
        response = await chrome.runtime.sendMessage({ type: 'SEARCH_IMAGE', tabId: batchTab.id, requestId, imageUrl: row.source_image_url, title: row.source_title });
      } catch (error) {
        response = { ok: false, error: error?.message || '扩展后台未响应。' };
      }
      currentRequestId = null;
      if (response?.ok && response.state === 'ready') {
        row.candidates = Array.isArray(response.results) ? response.results.slice(0, 5) : [];
        row.similarTotal = Number(response.similarTotal) || row.candidates.length;
        row.status = row.candidates.length ? '完成' : '无';
        row.error = '';
        setActivity(`rank ${row.source_rank} 已完成：${row.candidates.length} 个候选，返回 ${row.similarTotal} 个相似货源。`);
      } else if (response?.ok && response.state === 'empty') {
        row.status = '无';
        row.error = '';
        setActivity(`rank ${row.source_rank} 无相似货源。`);
      } else {
        row.status = response?.state === 'needs-auth' ? '待验证' : '失败';
        row.error = response?.message || response?.error || '搜图未完成。';
        pauseRequested = true;
        setActivity(`已停在 rank ${row.source_rank}：${row.error} 处理后点击“开始／继续”重试。`, true);
      }
      await save();
      render();
      if (pauseRequested) break;
      if (batch.rows.some((item) => !['完成', '无'].includes(item.status))) {
        setActivity(`rank ${row.source_rank} 已完成；等待 ${batch.intervalSeconds} 秒后继续。`);
        await waitBetweenRows(batch.intervalSeconds);
      }
    }
  } catch (error) {
    const currentRow = batch.rows.find((row) => row.status === '进行中');
    if (currentRow) { currentRow.status = '失败'; currentRow.error = error?.message || '批次处理被中断。'; }
    pauseRequested = true;
    setActivity(currentRow?.error || error?.message || '批次处理被中断。', true);
  } finally {
    currentRequestId = null;
    running = false;
    await save();
    render();
    if (!pauseRequested && batch.rows.every((row) => ['完成', '无'].includes(row.status))) setActivity(`全部 ${batch.rows.length} 条已处理，现可导出给 Muse。`);
    else if (pauseRequested && !activity.classList.contains('error')) setActivity('已暂停。点击“开始／继续”从未完成的条目续跑。');
  }
}

function download(content, mime, extension) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  link.href = url;
  link.download = `storesnapper-muse-${stamp}.${extension}`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

fileInput.addEventListener('change', () => void importFile(fileInput.files?.[0]));
dropZone.addEventListener('click', () => fileInput.click());
const isFileDrag = (event) => [...(event.dataTransfer?.types || [])].includes('Files');
let dragDepth = 0;
document.addEventListener('dragover', (event) => { if (isFileDrag(event)) event.preventDefault(); });
document.addEventListener('drop', (event) => { if (isFileDrag(event)) event.preventDefault(); });
dropZone.addEventListener('dragenter', (event) => {
  if (!isFileDrag(event) || running) return;
  event.preventDefault();
  dragDepth += 1;
  dropZone.classList.add('is-dragover');
});
dropZone.addEventListener('dragover', (event) => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = running ? 'none' : 'copy';
});
dropZone.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) dropZone.classList.remove('is-dragover');
});
dropZone.addEventListener('drop', (event) => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  dragDepth = 0;
  dropZone.classList.remove('is-dragover');
  if (running) return;
  const files = [...event.dataTransfer.files];
  if (files.length !== 1) { setActivity('请一次拖入一个 CSV 或 XLSX 文件。', true); return; }
  fileInput.value = '';
  void importFile(files[0]);
});
intervalInput.addEventListener('change', () => {
  if (!batch || running) return;
  batch.intervalSeconds = currentInterval();
  void save();
});
startButton.addEventListener('click', () => void run());
pauseButton.addEventListener('click', () => {
  pauseRequested = true;
  pauseButton.disabled = true;
  setActivity('暂停已请求；当前条处理完后停止。');
});
document.querySelector('#export-csv').addEventListener('click', () => {
  if (batch) download(toCsv(exportRows(batch.rows)), 'text/csv;charset=utf-8', 'csv');
});
document.querySelector('#export-json').addEventListener('click', () => {
  if (batch) download(JSON.stringify(exportRows(batch.rows), null, 2), 'application/json;charset=utf-8', 'json');
});
document.querySelector('#export-html').addEventListener('click', () => {
  if (batch) download(toHtml(exportRows(batch.rows)), 'text/html;charset=utf-8', 'html');
});
document.querySelector('#export-zip').addEventListener('click', () => {
  if (!batch) return;
  try {
    download(toZip(exportRows(batch.rows), globalThis.fflate), 'application/zip', 'zip');
    setActivity('已下载 ZIP，内含 CSV、JSON 和缩略图 HTML。');
  } catch (error) {
    setActivity(error?.message || 'ZIP 导出失败。', true);
  }
});
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'SEARCH_UPDATE' && message.requestId === currentRequestId && message.message) {
    const currentRow = batch?.rows.find((row) => row.status === '进行中');
    setActivity(`正在搜索 rank ${currentRow?.source_rank || '—'}：${message.message}`);
  }
});

const stored = await chrome.storage.local.get(KEY);
batch = stored[KEY] || null;
if (batch?.rows) {
  for (const row of batch.rows) if (row.status === '进行中') row.status = '待处理';
  await save();
  setActivity('已恢复上次批次，可从未完成的条目继续。');
}
render();
