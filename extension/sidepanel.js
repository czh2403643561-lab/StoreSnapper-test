(() => {
  const content = document.querySelector('#content');
  const contextLabel = document.querySelector('.context-label');
  let activeTabId = null;
  let activeWindowId = null;
  let activeMode = null;
  let refreshTimer = 0;
  let latestState = null;
  let retainedOnDetail = false;
  let stateRevision = 0;
  let recentSaveQueue = Promise.resolve();
  let tiktokLogsOpen = false;
  let selectorState = null;
  let authReady = false;
  let authChecking = false;
  let authFlow = null;
  const imageDiagnoses = new Set();
  const imageRecovery = new Map();

  const h = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = String(text);
    return element;
  };
  const cleanUrl = (value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' ? url : null;
    } catch { return null; }
  };

  async function settings() {
    const stored = await chrome.storage.local.get('storesnapper_settings_v1');
    return { compactResults: stored.storesnapper_settings_v1?.compactResults !== false };
  }

  function recentResultsKey(windowId) {
    return `storesnapper_recent_results_v1_${windowId}`;
  }

  async function readRecentResults(windowId) {
    if (!Number.isInteger(windowId)) return null;
    const key = recentResultsKey(windowId);
    const stored = await chrome.storage.session.get(key);
    const recent = stored[key];
    return Array.isArray(recent?.results) && recent.results.length ? recent : null;
  }

  function shouldSaveRecentResults(state) {
    return ['enriching', 'ready'].includes(state?.phase)
      && !state.retainedResults
      && Array.isArray(state.results)
      && state.results.length > 0;
  }

  function saveRecentResults(windowId, mode, state) {
    if (!Number.isInteger(windowId) || !shouldSaveRecentResults(state)) return Promise.resolve();
    const key = recentResultsKey(windowId);
    const resultTitle = state.resultTitle || state.title || '';
    const recent = {
      mode,
      title: state.title || resultTitle,
      resultTitle,
      results: state.results,
      savedAt: Date.now(),
    };
    recentSaveQueue = recentSaveQueue
      .then(() => chrome.storage.session.set({ [key]: recent }))
      .catch(() => undefined);
    return recentSaveQueue;
  }

  function includeRecentResults(state, recent) {
    if (!recent?.results?.length || state?.results?.length) return state;
    return {
      ...state,
      count: recent.results.length,
      results: recent.results,
      resultTitle: recent.resultTitle || recent.title || '',
      retainedResults: true,
    };
  }

  function recentResultsState(recent) {
    const title = recent.resultTitle || recent.title || '';
    return {
      recognized: true,
      phase: 'ready',
      title,
      resultTitle: title,
      count: recent.results.length,
      results: recent.results,
      retainedResults: true,
      hasProduct: true,
    };
  }

  async function showTemu(state, mode = 'temu', onDetail = false) {
    const revision = stateRevision;
    const tabId = activeTabId;
    activeMode = mode;
    retainedOnDetail = onDetail;
    document.body.classList.remove('collector-mode');
    contextLabel.textContent = onDetail ? '最近识图结果' : mode === '1688' ? '1688 找货测试' : 'Temu 找货';
    document.body.classList.toggle('compact', (await settings()).compactResults);
    if (revision !== stateRevision || activeTabId !== tabId) return;
    content.replaceChildren();
    const header = h('section', 'feature-head');
    header.append(h('h1', '', '1688 相似货源'));
    const status = h('div', 'status');
    const phase = state.phase || 'idle';
    status.dataset.kind = phase;
    status.textContent = onDetail ? '当前商品详情页保留了最近一次识图结果。'
      : phase === 'ready' ? '已显示 1688 返回的相似货源。'
      : state.message || '悬停 Temu 商品主图后，点击放大镜开始搜图。';
    const title = h('p', '', state.title || '');
    title.className = 'product-context';
    title.style.cssText = 'margin:3px 0 0;overflow:hidden;color:#687873;text-overflow:ellipsis;white-space:nowrap';
    header.append(title);
    content.append(header);
    if (onDetail || phase !== 'ready') content.append(status);
    if (phase !== 'ready') {
      const actions = h('div', 'actions');
      if (phase === 'needs-auth') {
        actions.append(actionButton('在 1688 登录／验证', 'primary', () => sendTemuAction('login')));
        actions.append(actionButton('我已登录，重新检查', '', () => sendTemuAction('retry')));
      } else if (['failed', 'empty'].includes(phase)) {
        actions.append(actionButton('重新搜索', 'primary', () => sendTemuAction('retry')));
      } else if (!state.hasProduct) {
        content.append(h('div', 'no-data', '在商品主图上悬停并点击放大镜，结果会显示在这里。'));
      }
      if (actions.childElementCount) content.append(actions);
    }
    if (state.count > 0) {
      if (onDetail || state.retainedResults) {
        const titleText = state.resultTitle || state.title;
        content.append(h('p', 'result-context', titleText ? `保留的识图结果：${titleText}` : '保留最近一次识图结果'));
      }
      content.append(h('div', 'count', `${state.count} 个相似货源`));
      const list = h('div', 'supplier-list');
      for (const item of state.results || []) list.append(makeOfferCard(item));
      content.append(list);
    } else if (phase === 'empty') {
      content.append(h('div', 'no-data', '本次没有返回货源。可以换一张商品主图重新搜索。'));
    }
  }

  function actionButton(label, kind, callback) {
    const button = h('button', `action ${kind}`.trim(), label);
    button.type = 'button';
    button.addEventListener('click', callback);
    return button;
  }

  async function sendTemuAction(action) {
    if (!activeTabId) return;
    try { await chrome.tabs.sendMessage(activeTabId, { type: 'TEMU_PANEL_ACTION', action }); }
    catch { renderUnsupported('页面脚本暂不可用，请刷新 Temu 页面后重试。'); }
  }

  function show1688Auth(message, checking = false) {
    activeMode = '1688-auth';
    document.body.classList.remove('collector-mode');
    contextLabel.textContent = '1688 验证';
    content.replaceChildren();
    const header = h('section', 'feature-head');
    header.append(h('h1', '', '1688 搜图准备'));
    content.append(header);
    const status = h('div', 'status', message);
    status.dataset.kind = authReady ? 'ready' : checking ? 'uploading' : 'needs-auth';
    content.append(status);
    const actions = h('div', 'actions');
    if (!authReady) {
      const retry = actionButton('重新检查搜图凭据', '', () => void check1688Auth());
      retry.disabled = checking;
      actions.append(retry);
    }
    actions.append(actionButton(authReady ? '返回 Temu，继续搜图' : '返回 Temu', authReady ? 'primary' : '', () => void returnToTemu()));
    content.append(actions);
  }

  async function check1688Auth() {
    if (authChecking || !authFlow || activeTabId !== authFlow.authTabId || authReady) return;
    const tabId = activeTabId;
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab || activeTabId !== tabId) return;
    if (/^https:\/\/login\.1688\.com\//.test(tab.url || '')) {
      show1688Auth('请在此页完成登录。进入 1688 首页后会自动检查搜图凭据。');
      return;
    }
    authChecking = true;
    show1688Auth('正在检查 1688 搜图凭据…', true);
    try {
      const response = await chrome.runtime.sendMessage({ type: 'CHECK_1688_TOKEN' });
      if (activeTabId !== tabId || activeMode !== '1688-auth') return;
      authReady = response?.ok === true;
      show1688Auth(authReady
        ? '已取得 1688 搜图凭据，可以返回 Temu 点击放大镜。'
        : '网页已打开，但尚无搜图令牌。请返回 Temu 点击放大镜，插件会用当前商品图片初始化后继续搜索。');
    } catch {
      if (activeTabId === tabId && activeMode === '1688-auth') show1688Auth('检查暂时失败，请稍后重试。');
    } finally { authChecking = false; }
  }

  async function returnToTemu() {
    const flow = authFlow;
    if (!flow || activeTabId !== flow.authTabId) return;
    try {
      if (authReady) await chrome.tabs.sendMessage(flow.originTabId, { type: 'TEMU_PANEL_ACTION', action: 'auth_ready' }).catch(() => undefined);
      await chrome.tabs.update(flow.originTabId, { active: true });
      await chrome.storage.session.remove('storesnapper_1688_auth_flow');
      authFlow = null;
    } catch { show1688Auth('原 Temu 页面已关闭，请手动打开 Temu 商品列表。'); }
  }

  function makeOfferCard(item) {
    const offerId = String(item.offer_id || '');
    const card = h('button', 'supplier-card');
    card.type = 'button';
    card.disabled = !/^\d{8,}$/.test(offerId);
    card.setAttribute('aria-label', `打开 1688 相似货源：${item.title || '商品详情'}`);
    const url = cleanUrl(item.image_url);
    if (url) {
      const image = h('img', 'supplier-image');
      image.alt = item.title || '1688 商品图片';
      image.loading = 'lazy';
      image.referrerPolicy = 'no-referrer';
      image.addEventListener('error', () => void recoverOfferImage(image, item, url), { once: true });
      image.src = url.href;
      card.append(image);
    } else card.append(h('div', 'image-placeholder', '商品图片暂无'));

    const details = h('div', 'supplier-info');
    details.append(h('p', 'supplier-title', item.title || '商品标题暂无'));
    details.append(h('p', 'supplier-price', item.price?.display || '价格暂无'));
    const meta = h('div', 'supplier-meta');
    meta.append(h('span', '', `起批：${item.minimum_order || '暂无'}`));
    meta.append(h('span', '', `销量：${item.sales || '暂无'}`));
    details.append(meta);
    if (item.supplier_name) details.append(h('div', 'supplier-name', `供应商：${item.supplier_name}`));
    const badges = [...(Array.isArray(item.badges) ? item.badges.slice(0, 2) : [])];
    if (item.supplier_years) badges.unshift(item.supplier_years);
    for (const badge of badges.slice(0, 2)) details.append(h('span', 'supplier-badge', badge));
    card.append(details);
    card.addEventListener('click', () => {
      if (card.disabled) return;
      void chrome.runtime.sendMessage({ type: 'OPEN_1688_OFFER', offerId });
    });
    return card;
  }

  async function recoverOfferImage(image, item, url) {
    const imageKey = url.href;
    const cached = imageRecovery.get(imageKey);
    if (cached) { image.src = cached; return; }
    if (imageDiagnoses.has(imageKey)) {
      if (image.isConnected) image.replaceWith(h('div', 'image-placeholder', '商品图片暂不可用'));
      return;
    }
    imageDiagnoses.add(imageKey);
    const record = { at: new Date().toISOString(), type: '1688_image', offerId: String(item.offer_id || ''), host: url.hostname, path: url.pathname, status: 'failed' };
    await saveDiagnostic(record);
    try {
      const response = await chrome.runtime.sendMessage({ type: 'DIAGNOSE_1688_IMAGE', imageUrl: url.href });
      const result = response?.result;
      const { imageDataBase64, imageMimeType, ...probe } = result || {};
      record.probe = probe;
      if (response?.ok && imageDataBase64 && image.isConnected) {
        const recoveredUrl = `data:${imageMimeType || 'image/webp'};base64,${imageDataBase64}`;
        imageRecovery.set(imageKey, recoveredUrl);
        image.src = recoveredUrl;
        record.status = 'restored';
      } else if (image.isConnected) {
        const placeholder = h('div', 'image-placeholder', '商品图片暂不可用');
        image.replaceWith(placeholder);
        record.status = probe?.state || 'unavailable';
      }
    } catch {
      if (image.isConnected) image.replaceWith(h('div', 'image-placeholder', '商品图片暂不可用'));
      record.status = 'diagnosis_failed';
    }
    await saveDiagnostic(record);
  }

  async function saveDiagnostic(record) {
    const key = 'storesnapper_diagnostics_v1';
    const stored = await chrome.storage.local.get(key);
    const records = Array.isArray(stored[key]) ? stored[key] : [];
    records.push(record);
    await chrome.storage.local.set({ [key]: records.slice(-100) });
  }

  async function showTikTok(state) {
    activeMode = 'tiktok';
    selectorState = state;
    document.body.classList.add('collector-mode');
    contextLabel.textContent = 'TikTok';
    document.body.classList.remove('compact');
    content.replaceChildren();
    content.append(h('section', 'feature-head', 'TikTok 按 ID 勾选'));
    if (!state.recognized) { renderUnsupported('尚未识别到商品管理标题和商品表格。'); return; }
    const stepOne = h('section', 'selector-box');
    stepOne.append(h('h2', 'step-title', '① 导入本轮清单'));
    const template = h('button', '', '下载清单模板');
    template.addEventListener('click', downloadTikTokTemplate);
    const file = h('input'); file.type = 'file'; file.accept = '.csv,.xlsx'; file.multiple = true;
    file.disabled = state.selecting || state.canPause;
    file.addEventListener('change', () => void importSelectorFiles([...file.files]));
    stepOne.append(template, h('p', 'hint', '可一次选择多份 CSV / XLSX，每份是一轮独立任务。'), file);
    const taskList = h('div', 'task-list');
    for (const task of state.tasks || []) {
      const row = h('div', `task-row${task.id === state.activeTaskId ? ' active' : ''}`);
      const choose = h('button', 'task-choose', `${task.id === state.activeTaskId ? '● ' : '○ '}${task.name} · ${task.count} 件${state.indexReady ? ` · 索引匹配 ${task.matched}` : ''}${task.duplicates ? ` · 重复 ${task.duplicates}` : ''}`);
      choose.disabled = state.selecting || state.canPause;
      choose.addEventListener('click', () => void updateSelectorTask('activate_task', task.id));
      const remove = h('button', 'task-remove', '移除');
      remove.disabled = state.selecting || state.canPause;
      remove.addEventListener('click', () => void updateSelectorTask('remove_task', task.id));
      row.append(choose, remove); taskList.append(row);
    }
    if (!state.tasks?.length) taskList.append(h('p', 'hint', '尚未导入清单。'));
    stepOne.append(taskList);
    content.append(stepOne);

    const stepTwo = h('section', 'selector-box');
    stepTwo.append(h('h2', 'step-title', '② 采集并勾选当前页'));
    const status = h('div', 'collector-status', state.indexReady
      ? `已有索引 ${state.cumulative}/${state.totalRows || state.cumulative} 件，优先按记录定位`
      : state.pageIndexReady ? '当前页已有索引，可直接按记录定位'
      : state.countChanged ? '商品列表已变化，需要更新索引'
        : `索引进度：${state.status || '待命'}`);
    status.dataset.kind = state.statusCode || 'idle';
    stepTwo.append(status);
    const metrics = h('div', 'metrics');
    const cells = [
      ['当前页 / 总页数', `${state.page ?? '—'} / ${state.totalPages ?? '—'}`],
      ['本页 / 预计商品', `${state.pageCount ?? 0} / ${state.expected ?? '—'}`],
      ['已采集 / 列表商品', `${state.cumulative ?? 0} / ${state.totalRows ?? '—'}`],
      ['本页清单商品', state.pageIndexReady ? state.pageMatches ?? 0 : '采集时识别'],
    ];
    for (const [label, value] of cells) {
      const metric = h('div', 'metric'); metric.append(h('span', '', label), h('strong', '', value)); metrics.append(metric);
    }
    stepTwo.append(metrics);
    const actions = h('div', 'collector-actions');
    const start = actionButton(state.pageIndexReady ? '处理当前页' : '开始本轮：采集并勾选', 'primary', () => sendTikTokAction('run'));
    start.disabled = !state.activeTaskId || !state.canStart || state.selecting || state.canPause;
    const pause = actionButton(state.paused ? '继续' : '暂停', '', () => sendTikTokAction('pause'));
    pause.disabled = !state.canPause;
    const next = actionButton('下一页并继续', '', () => sendTikTokAction('next'));
    next.disabled = !state.canNext || !state.canContinue || state.selecting;
    const stop = actionButton('停止本轮', '', async () => {
      try { await selectorAction('stop'); await showTikTok(selectorState); }
      catch (error) { selectorState = { ...selectorState, selectionMessage: error.message }; await showTikTok(selectorState); }
    });
    stop.disabled = !state.selecting && !state.canPause;
    const exportButton = actionButton('下载商品列表', '', () => sendTikTokAction('export'));
    exportButton.disabled = !state.canExport;
    exportButton.classList.add('wide');
    actions.append(start, pause, next, stop, exportButton);
    stepTwo.append(actions);
    const reason = !state.activeTaskId ? '先导入并选择一份清单。'
      : state.selectionPending ? '本页有商品未确认勾选，请先重新处理本页。'
      : state.countChanged && state.page !== 1 ? '商品数量已变化，请先切回第 1 页更新索引。'
        : state.selecting || state.canPause ? '正在运行，可暂停或停止。'
          : state.canNext && !state.canContinue ? '先处理当前页，再决定是否进入下一页。'
          : !state.canStart ? '当前页仍在加载，或页码尚未识别。'
            : state.pageIndexReady ? '优先定位本页清单商品；找不到或页面变化时才重采本页。'
              : '采集经过目标商品时会当场勾选，不再重新扫一遍。';
    stepTwo.append(h('p', 'hint', reason));
    content.append(stepTwo);

    const stepThree = h('section', 'selector-box');
    stepThree.append(h('h2', 'step-title', '③ 本页结果'));
    const feedback = h('p', 'selector-message', state.selectionMessage || '选择清单后开始本轮。');
    stepThree.append(feedback);
    if (state.selected?.length) stepThree.append(h('p', '', `本页新勾选 ${state.selected.length} 件，请在后台核对。`));
    stepThree.append(h('p', 'hint', '插件只勾选商品；下架、删除和确认由你操作。'));
    content.append(stepThree);

    const details = h('details');
    details.open = tiktokLogsOpen;
    details.addEventListener('toggle', () => { tiktokLogsOpen = details.open; });
    const summary = h('summary', '', '运行日志');
    const logActions = h('div', 'log-actions');
    const copy = h('button', '', '复制脱敏日志'); copy.type = 'button';
    copy.addEventListener('click', async () => {
      const text = (state.logs || []).map((item) => `${item.at || ''} [${item.step || ''}] ${item.message || ''}`).join('\n');
      try { await navigator.clipboard.writeText(text); copy.textContent = '已复制'; }
      catch { copy.textContent = '复制失败'; }
    });
    logActions.append(copy);
    const logs = h('pre', 'logs', (state.logs || []).map((item) => `${(item.at || '').slice(11, 19)} [${item.step || ''}] ${item.message || ''}`).join('\n') || '暂无记录');
    details.append(summary, logActions, logs);
    content.append(details);
  }

  async function selectorAction(action, extra = {}) {
    if (!activeTabId) return null;
    const response = await chrome.tabs.sendMessage(activeTabId, { type: 'TIKTOK_SELECT_ACTION', action, ...extra });
    if (!response?.ok) throw new Error(response?.error || '页面操作失败。');
    selectorState = response.state;
    return response.state;
  }

  function downloadTikTokTemplate() {
    const root = 'http://schemas.openxmlformats.org/';
    const files = {
      '[Content_Types].xml': `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
      '_rels/.rels': `<?xml version="1.0"?><Relationships xmlns="${root}package/2006/relationships"><Relationship Id="rId1" Type="${root}officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      'xl/workbook.xml': `<?xml version="1.0"?><workbook xmlns="${root}spreadsheetml/2006/main" xmlns:r="${root}officeDocument/2006/relationships"><sheets><sheet name="商品ID清单" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      'xl/_rels/workbook.xml.rels': `<?xml version="1.0"?><Relationships xmlns="${root}package/2006/relationships"><Relationship Id="rId1" Type="${root}officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${root}officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
      'xl/styles.xml': `<?xml version="1.0"?><styleSheet xmlns="${root}spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Arial"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`,
      'xl/worksheets/sheet1.xml': `<?xml version="1.0"?><worksheet xmlns="${root}spreadsheetml/2006/main"><cols><col min="1" max="1" width="26" customWidth="1" style="1"/></cols><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>商品ID</t></is></c></row></sheetData></worksheet>`,
    };
    const bytes = globalThis.fflate.zipSync(Object.fromEntries(Object.entries(files).map(([name, xml]) => [name, globalThis.fflate.strToU8(xml)])));
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = h('a'); a.href = url; a.download = 'TikTok-商品ID模板.xlsx'; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  async function updateSelectorTask(action, id) {
    try { await selectorAction(action, { id }); }
    catch (error) { selectorState = { ...selectorState, selectionMessage: error.message }; }
    await showTikTok(selectorState);
  }

  async function importSelectorFiles(files) {
    if (!files.length) return;
    try {
      const { parseCsv, parseXlsx } = await import('./batch-core.mjs');
      const tasks = [];
      for (const file of files) {
        const xlsx = file.name.toLowerCase().endsWith('.xlsx');
        if (!xlsx && !file.name.toLowerCase().endsWith('.csv')) throw new Error(`${file.name}：请选择 CSV 或 XLSX 文件。`);
        const table = xlsx ? parseXlsx(await file.arrayBuffer(), globalThis.fflate?.unzipSync, { includeCellTypes: true }) : parseCsv(await file.text());
        const headers = table[0]?.map((cell) => String(cell || '').trim().toLowerCase()) || [];
        const column = headers.findIndex((value) => ['商品id', 'product_id', 'product id'].includes(value));
        if (column < 0) throw new Error(`${file.name}：找不到“商品ID”列。`);
        if (xlsx && table.slice(1).some((row) => row[column] && !['s', 'inlineStr', 'str'].includes(row.cellTypes?.[column]))) {
          throw new Error(`${file.name}：商品 ID 列含数字单元格，请改成纯文本。`);
        }
        const ids = table.slice(1).map((row) => String(row[column] || '').trim()).filter(Boolean);
        if (!ids.length || ids.some((id) => !/^\d{16,22}$/.test(id))) throw new Error(`${file.name}：商品 ID 必须是完整的纯数字文字。`);
        tasks.push({ name: file.name, ids });
      }
      await selectorAction('import_tasks', { tasks });
      await showTikTok(selectorState);
    } catch (error) { selectorState = { ...(selectorState || {}), selectionMessage: error.message || '导入失败。' }; await showTikTok(selectorState); }
  }

  async function sendTikTokAction(action) {
    if (!activeTabId) return;
    try {
      const response = await chrome.tabs.sendMessage(activeTabId, { type: 'TIKTOK_PANEL_ACTION', action });
      if (!response?.ok) renderUnsupported(response?.error || '此操作当前不可用。');
    } catch { renderUnsupported('页面脚本暂不可用，请刷新 Seller Center 页面后重试。'); }
  }

  function renderUnsupported(message) {
    document.body.classList.remove('collector-mode');
    content.replaceChildren();
    const box = h('section', 'empty');
    box.append(h('strong', '', '当前页面没有可用功能'), h('p', '', message || '打开 Temu 商品列表或 TikTok Seller Center 商品管理页后，功能会自动识别。'));
    content.append(box);
  }

  function isTemuProductDetail(url) {
    const path = url.pathname.toLowerCase();
    if (/-o\d+-\d+\.html$/.test(path) || /search_result/.test(path)) return false;
    const hasItemId = [...url.searchParams.keys()].some((key) => /^(goods|product|item)[_-]?id$/i.test(key));
    return /(?:^|\/)(?:goods|product|item)(?:_detail)?\.html$/.test(path)
      || /(?:goods|product|item)[_-]?detail|\/(?:goods|product|item)\/|(?:^|-)g-\d{6,}/i.test(path)
      || hasItemId;
  }

  async function showContentState(message, mode) {
    const revision = ++stateRevision;
    const tabId = activeTabId;
    const state = message.state;
    if (shouldSaveRecentResults(state)) await saveRecentResults(activeWindowId, mode, state);
    if (revision !== stateRevision || activeTabId !== tabId) return;
    let recent = null;
    if (!state.results?.length) recent = await readRecentResults(activeWindowId).catch(() => null);
    if (revision !== stateRevision || activeTabId !== tabId) return;
    latestState = includeRecentResults(state, recent);
    void showTemu(latestState, mode);
  }

  async function refresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      activeTabId = tab?.id ?? null;
      activeWindowId = tab?.windowId ?? null;
      latestState = null;
      retainedOnDetail = false;
      stateRevision += 1;
      let url;
      try { url = new URL(tab?.url || ''); } catch { url = null; }
      let mode = null;
      let retainRecentOnDetail = false;
      if (url?.hostname === 'www.temu.com') {
        if (isTemuProductDetail(url)) retainRecentOnDetail = true;
        else if (!/\/(?:login|register|signup|account|checkout)(?:\.html|\/|$)/i.test(url.pathname)) mode = 'temu';
      } else if (url?.hostname === 'seller.eu.tiktokshopglobalselling.com' && /^\/product\/manage\/?$/.test(url.pathname)) mode = 'tiktok';
      else if (url?.hostname === 'detail.1688.com') retainRecentOnDetail = true;
      else if (['login.1688.com', 'www.1688.com', 'search.1688.com', 'air.1688.com'].includes(url?.hostname)) {
        const stored = await chrome.storage.session.get('storesnapper_1688_auth_flow');
        if (tab?.id !== activeTabId) return;
        const flow = stored.storesnapper_1688_auth_flow;
        if (flow?.authTabId === tab?.id) {
          authFlow = flow;
          authReady = false;
          show1688Auth('正在检查 1688 搜图凭据…', true);
          void check1688Auth();
          return;
        }
        if (url.hostname !== 'login.1688.com') mode = '1688';
      }
      if (!mode || !tab?.id) {
        if (retainRecentOnDetail && tab?.windowId !== undefined) {
          const recent = await readRecentResults(tab.windowId).catch(() => null);
          if (tab.id !== activeTabId) return;
          if (recent) {
            latestState = recentResultsState(recent);
            await showTemu(latestState, recent.mode, true);
            return;
          }
        }
        activeMode = null; contextLabel.textContent = '识别当前页面';
        renderUnsupported(retainRecentOnDetail ? '此商品详情页暂不显示识图入口。先在商品列表点击放大镜，结果会保留在这里。' : undefined);
        return;
      }
      retainedOnDetail = false;
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { type: 'STORESNAPPER_GET_PANEL_STATE', mode });
        if (tab.id !== activeTabId) return;
        if (!response?.ok || !response.state?.recognized) { activeMode = null; contextLabel.textContent = '页面尚未就绪'; renderUnsupported('刷新目标页面后再打开工具栏菜单。'); return; }
        if (mode === 'temu' || mode === '1688') {
          if (shouldSaveRecentResults(response.state)) await saveRecentResults(tab.windowId, mode, response.state);
          if (tab.id !== activeTabId) return;
          const recent = response.state.results?.length ? null : await readRecentResults(tab.windowId).catch(() => null);
          if (tab.id !== activeTabId) return;
          latestState = includeRecentResults(response.state, recent);
          await showTemu(latestState, mode);
        }
        else await showTikTok(response.state);
      } catch {
        activeMode = null; contextLabel.textContent = '页面尚未就绪';
        renderUnsupported('页面脚本暂不可用，请刷新目标页面后重试。');
      }
    }, 40);
  }

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (message?.type !== 'STOREPANEL_STATE' || sender.tab?.id !== activeTabId || !message.state) return;
    if (message.mode === 'temu' || message.mode === '1688') void showContentState(message, message.mode);
    else if (message.mode === 'tiktok') void showTikTok(message.state);
  });
  chrome.tabs.onActivated.addListener(() => void refresh());
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (tabId === activeTabId && (changeInfo.status === 'complete' || changeInfo.url)) void refresh();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.storesnapper_settings_v1 && latestState && ['temu', '1688'].includes(activeMode)) void showTemu(latestState, activeMode, retainedOnDetail);
  });
  setInterval(() => {
    if (activeMode === '1688-auth' && !authReady) void check1688Auth();
  }, 5_000);
  void refresh();
})();
