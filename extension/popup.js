(() => {
  const context = document.querySelector('.context');
  const title = document.querySelector('.context-title');
  const detail = document.querySelector('.context-detail');
  const footer = document.querySelector('.footer');
  const openPanel = document.querySelector('.open-panel');
  const compactSetting = document.querySelector('.compact-setting');
  const exportTikTok = document.querySelector('.export-tiktok');
  const exportDiagnostics = document.querySelector('.export-diagnostics');
  const logsNode = document.querySelector('.logs');
  const copyLogs = document.querySelector('.copy-logs');
  let activeTab = null;
  let activeMode = null;
  let panelState = null;
  let logsText = '';
  let diagnosticRecords = [];

  function isTemuListing(url) {
    if (url.hostname !== 'www.temu.com') return false;
    const hasItemId = [...url.searchParams.keys()].some((key) => /^(goods|product|item)[_-]?id$/i.test(key));
    return !hasItemId && !/\/(?:login|register|signup|account|checkout)(?:\.html|\/|$)/i.test(url.pathname)
      && !/(?:^|\/)(?:goods|product|item)(?:_detail)?\.html$/.test(url.pathname)
      && !/(?:goods|product|item)[_-]?detail|\/(?:goods|product|item)\/|(?:^|-)g-\d{6,}/i.test(url.pathname);
  }

  function isTemuDetail(url) {
    const hasItemId = [...url.searchParams.keys()].some((key) => /^(goods|product|item)[_-]?id$/i.test(key));
    return /(?:^|\/)(?:goods|product|item)(?:_detail)?\.html$/.test(url.pathname) && hasItemId
      || /(?:goods|product|item)[_-]?detail|\/(?:goods|product|item)\/|(?:^|-)g-\d{6,}/i.test(url.pathname);
  }

  function downloadJson(name, data) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = name; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  async function loadUtilityState() {
    const keys = ['storesnapper_settings_v1', 'storesnapper_diagnostics_v1'];
    const stored = await chrome.storage.local.get(keys);
    compactSetting.checked = stored.storesnapper_settings_v1?.compactResults !== false;
    diagnosticRecords = Array.isArray(stored.storesnapper_diagnostics_v1) ? stored.storesnapper_diagnostics_v1 : [];
    exportDiagnostics.disabled = diagnosticRecords.length === 0;
  }

  compactSetting.addEventListener('change', async () => {
    await chrome.storage.local.set({ storesnapper_settings_v1: { compactResults: compactSetting.checked } });
  });
  exportDiagnostics.addEventListener('click', () => {
    if (diagnosticRecords.length) downloadJson(`storesnapper-diagnostics-${new Date().toISOString().slice(0, 10)}.json`, diagnosticRecords);
  });
  exportTikTok.addEventListener('click', async () => {
    if (!activeTab?.id) return;
    try {
      const response = await chrome.tabs.sendMessage(activeTab.id, { type: 'TIKTOK_PANEL_ACTION', action: 'export' });
      if (!response?.ok) { footer.textContent = response?.error || '请先在 TikTok 采集面板中采集商品。'; }
    } catch { footer.textContent = '页面脚本暂不可用，请刷新 TikTok 页面后重试。'; }
  });
  openPanel.addEventListener('click', async () => {
    if (!activeTab?.id || !chrome.sidePanel?.open) { footer.textContent = '此 Chrome 版本暂不支持右侧功能面板。'; return; }
    try { await chrome.sidePanel.open({ tabId: activeTab.id }); window.close(); }
    catch { footer.textContent = '无法打开右侧功能面板，请检查 Chrome 版本或扩展设置。'; }
  });
  copyLogs.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(logsText || '暂无记录'); copyLogs.textContent = '已复制'; }
    catch { copyLogs.textContent = '复制受限'; }
  });

  void (async () => {
    await loadUtilityState();
    [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    let url;
    try { url = new URL(activeTab?.url || ''); } catch { url = null; }
    if (url && isTemuListing(url)) {
      activeMode = 'temu';
      context.dataset.kind = 'ready';
      title.textContent = '已识别 Temu 商品浏览页';
      detail.textContent = '首页、闪购、类目和搜索列表均可使用主图搜货。';
      footer.textContent = '悬停商品主图并点击放大镜，右侧显示 1688 相似货源。';
      openPanel.hidden = false;
      openPanel.textContent = '打开当前页面功能面板';
    } else if (url?.hostname === 'seller.eu.tiktokshopglobalselling.com' && /^\/product\/manage\/?$/.test(url.pathname)) {
      try { panelState = (await chrome.tabs.sendMessage(activeTab.id, { type: 'STORESNAPPER_GET_PANEL_STATE', mode: 'tiktok' }))?.state; }
      catch { panelState = null; }
      if (panelState?.recognized) {
        activeMode = 'tiktok';
        context.dataset.kind = 'ready';
        title.textContent = '已识别 TikTok 商品管理页';
        detail.textContent = `当前状态：${panelState.status || '待命'} · 已采集 ${panelState.cumulative || 0} 件`;
        footer.textContent = '采集和手动翻页操作在右侧页面面板中进行。';
        openPanel.hidden = false;
        openPanel.textContent = '打开当前页面功能面板';
        exportTikTok.hidden = !(panelState.canExport && panelState.cumulative > 0);
        logsText = (panelState.logs || []).map((item) => `${item.at || ''} [${item.step || ''}] ${item.message || ''}`).join('\n');
      } else {
        context.dataset.kind = 'unsupported';
        title.textContent = '暂未识别商品管理表格';
        detail.textContent = '需要商品管理标题和商品表格同时就绪。';
        footer.textContent = '刷新 Seller Center 页面后再试。';
      }
    } else if (url?.hostname === 'www.temu.com' && isTemuDetail(url)) {
      context.dataset.kind = 'unsupported';
      title.textContent = 'Temu 商品详情页暂不支持';
      detail.textContent = '请返回首页、闪购、类目或搜索列表使用搜图。';
      footer.textContent = '商品详情页不提供主图搜货入口。';
    } else if (url?.hostname === 'www.temu.com') {
      context.dataset.kind = 'unsupported';
      title.textContent = '当前 Temu 页面没有商品列表';
      detail.textContent = '登录、购物车等非商品列表页面不提供搜货入口。';
      footer.textContent = '打开首页、闪购、类目或搜索列表后即可使用。';
    } else {
      context.dataset.kind = 'unsupported';
      title.textContent = '当前页面没有已启用功能';
      detail.textContent = '打开 Temu 商品列表或 TikTok Shop 商品管理页后，功能会自动识别。';
      footer.textContent = '本菜单用于设置、导出与查看诊断信息。';
    }

    const stored = await chrome.storage.local.get('storesnapper_diagnostics_v1');
    diagnosticRecords = Array.isArray(stored.storesnapper_diagnostics_v1) ? stored.storesnapper_diagnostics_v1 : [];
    if (activeMode === 'temu' && diagnosticRecords.length) {
      const lines = diagnosticRecords.slice(-80).map((item) => `${item.at || ''} [${item.type || '图片诊断'}] ${item.status || ''}${item.host ? ` · ${item.host}${item.path || ''}` : ''}${item.probe?.message ? ` · ${item.probe.message}` : ''}`);
      logsText = lines.join('\n');
    }
    logsNode.textContent = logsText || '暂无记录';
    exportDiagnostics.disabled = diagnosticRecords.length === 0;
  })();
})();
