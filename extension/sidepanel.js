(() => {
  const content = document.querySelector('#content');
  const contextLabel = document.querySelector('.context-label');
  let activeTabId = null;
  let activeMode = null;
  let refreshTimer = 0;
  let latestState = null;
  let tiktokLogsOpen = false;
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

  async function showTemu(state) {
    activeMode = 'temu';
    document.body.classList.remove('collector-mode');
    contextLabel.textContent = 'Temu 找货';
    document.body.classList.toggle('compact', (await settings()).compactResults);
    content.replaceChildren();
    const header = h('section', 'feature-head');
    header.append(h('h1', '', '1688 相似货源'));
    const status = h('div', 'status');
    const phase = state.phase || 'idle';
    status.dataset.kind = phase;
    status.textContent = phase === 'ready' ? '已显示 1688 返回的相似货源。'
      : state.message || '悬停 Temu 商品主图后，点击放大镜开始搜图。';
    const title = h('p', '', state.title || '');
    title.className = 'product-context';
    title.style.cssText = 'margin:3px 0 0;overflow:hidden;color:#687873;text-overflow:ellipsis;white-space:nowrap';
    header.append(title);
    content.append(header);
    if (phase !== 'ready') {
      content.append(status);
      const actions = h('div', 'actions');
      if (phase === 'needs-auth') {
        actions.append(actionButton('在 1688 登录／验证', 'primary', () => sendTemuAction('login')));
        actions.append(actionButton('已完成，重新搜索', '', () => sendTemuAction('retry')));
      } else if (['failed', 'empty'].includes(phase)) {
        actions.append(actionButton('重新搜索', 'primary', () => sendTemuAction('retry')));
      } else if (!state.hasProduct) {
        content.append(h('div', 'no-data', '在商品主图上悬停并点击放大镜，结果会显示在这里。'));
      }
      if (actions.childElementCount) content.append(actions);
    }
    if (state.count > 0) {
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
    document.body.classList.add('collector-mode');
    contextLabel.textContent = 'TikTok';
    document.body.classList.remove('compact');
    content.replaceChildren();
    content.append(h('section', 'feature-head', 'TikTok 商品管理采集'));
    if (!state.recognized) { renderUnsupported('尚未识别到商品管理标题和商品表格。'); return; }
    const status = h('div', 'collector-status', `状态：${state.status || '待命'}`);
    status.dataset.kind = state.statusCode || 'idle';
    content.append(status);
    const metrics = h('div', 'metrics');
    const cells = [
      ['当前页 / 总页数', `${state.page ?? '—'} / ${state.totalPages ?? '—'}`],
      ['本页 / 预计商品', `${state.pageCount ?? 0} / ${state.expected ?? '—'}`],
      ['已采集商品', state.cumulative ?? 0],
      ['筛选范围', state.filterLabel || '当前列表'],
    ];
    for (const [label, value] of cells) {
      const metric = h('div', 'metric'); metric.append(h('span', '', label), h('strong', '', value)); metrics.append(metric);
    }
    content.append(metrics);
    const actions = h('div', 'collector-actions');
    const start = actionButton(state.startLabel || '开始采集本页', 'primary', () => sendTikTokAction('start'));
    start.disabled = !state.canStart;
    const pause = actionButton(state.paused ? '继续' : '暂停', '', () => sendTikTokAction('pause'));
    pause.disabled = !state.canPause;
    const next = actionButton(state.nextLabel || '采集下一页', '', () => sendTikTokAction('next'));
    next.disabled = !state.canNext;
    const exportButton = actionButton('导出 JSON', '', () => sendTikTokAction('export'));
    exportButton.disabled = !state.canExport;
    actions.append(start, pause, next, exportButton);
    content.append(actions, h('p', 'hint', state.hint || '翻页由你手动确认；采集不会自动连续翻页。'));
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

  async function refresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      activeTabId = tab?.id ?? null;
      latestState = null;
      let url;
      try { url = new URL(tab?.url || ''); } catch { url = null; }
      let mode = null;
      if (url?.hostname === 'www.temu.com') {
        const hasItemId = [...url.searchParams.keys()].some((key) => /^(goods|product|item)[_-]?id$/i.test(key));
        const detail = /\/(?:login|register|signup|account|checkout)(?:\.html|\/|$)/i.test(url.pathname)
          || /(?:^|\/)(?:goods|product|item)(?:_detail)?\.html$/.test(url.pathname)
          || /(?:goods|product|item)[_-]?detail|\/(?:goods|product|item)\/|(?:^|-)g-\d{6,}/i.test(url.pathname)
          || hasItemId;
        if (!detail) mode = 'temu';
      } else if (url?.hostname === 'seller.eu.tiktokshopglobalselling.com' && /^\/product\/manage\/?$/.test(url.pathname)) mode = 'tiktok';
      if (!mode || !tab?.id) { activeMode = null; contextLabel.textContent = '识别当前页面'; renderUnsupported(); return; }
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { type: 'STORESNAPPER_GET_PANEL_STATE', mode });
        if (tab.id !== activeTabId) return;
        if (!response?.ok || !response.state?.recognized) { activeMode = null; contextLabel.textContent = '页面尚未就绪'; renderUnsupported('刷新目标页面后再打开工具栏菜单。'); return; }
        latestState = response.state;
        if (mode === 'temu') await showTemu(response.state);
        else await showTikTok(response.state);
      } catch {
        activeMode = null; contextLabel.textContent = '页面尚未就绪';
        renderUnsupported('页面脚本暂不可用，请刷新目标页面后重试。');
      }
    }, 40);
  }

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (message?.type !== 'STOREPANEL_STATE' || sender.tab?.id !== activeTabId || !message.state) return;
    latestState = message.state;
    if (message.mode === 'temu') void showTemu(message.state);
    else if (message.mode === 'tiktok') void showTikTok(message.state);
  });
  chrome.tabs.onActivated.addListener(() => void refresh());
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (tabId === activeTabId && (changeInfo.status === 'complete' || changeInfo.url)) void refresh();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.storesnapper_settings_v1 && latestState && activeMode === 'temu') void showTemu(latestState);
  });
  void refresh();
})();
