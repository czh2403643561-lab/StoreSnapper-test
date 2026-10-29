(() => {
  const context = document.querySelector('.context');
  const title = document.querySelector('.context-title');
  const detail = document.querySelector('.context-detail');
  const actions = document.querySelector('.actions');
  const footer = document.querySelector('footer');
  const isTemuHost = (host) => host === 'www.temu.com';
  const isTemuDetailPage = (url) => {
    if (!url) return false;
    const path = url.pathname.toLowerCase();
    const hasItemId = [...url.searchParams.keys()].some((key) => /^(goods|product|item)[_-]?id$/i.test(key));
    return (/(?:^|\/)(?:goods|product|item)(?:_detail)?\.html$/.test(path) && hasItemId)
      || /(?:goods|product|item)[_-]?detail|\/(?:goods|product|item)\/|(?:^|-)g-\d{6,}/i.test(path);
  };

  function addAction(label, hint, message) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'action';
    const text = document.createElement('span');
    text.textContent = label;
    const sub = document.createElement('small');
    sub.textContent = hint;
    button.append(text, sub);
    button.addEventListener('click', () => openWorkbench(message));
    actions.append(button);
  }

  async function openWorkbench(message) {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.id) return;
    try {
      const response = await chrome.tabs.sendMessage(tab.id, message);
      if (!response?.ok) throw new Error('content script unavailable');
      window.close();
    } catch {
      context.dataset.kind = 'unsupported';
      title.textContent = '页面组件尚未加载';
      detail.textContent = '刷新当前页面后，再点击浏览器工具栏的 StoreSnapper 图标。';
    }
  }

  void (async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    let url;
    try { url = new URL(tab?.url || ''); } catch { url = null; }
    if (url && isTemuHost(url.hostname)) {
      context.dataset.kind = 'ready';
      title.textContent = '已识别 Temu 网站';
      detail.textContent = isTemuDetailPage(url)
        ? 'Temu 网站已识别；商品详情页暂不启用搜图。'
        : '首页、闪购、类目和搜索页均可扫描商品卡片。';
      footer.textContent = isTemuDetailPage(url)
        ? '回到 Temu 商品列表页后，可从主图开始搜图。'
        : '在商品卡片主图上悬停，可开始图片找货。';
      if (!isTemuDetailPage(url)) addAction('打开 Temu 找货工作台', '图片搜货', { type: 'STORESNAPPER_OPEN_WORKBENCH', mode: 'temu' });
      return;
    }

    if (url?.hostname === 'seller.eu.tiktokshopglobalselling.com' && /^\/product\/manage\/?$/.test(url.pathname)) {
      let pageContext = null;
      try {
        pageContext = await chrome.tabs.sendMessage(tab.id, { type: 'STORESNAPPER_GET_CONTEXT', mode: 'tiktok' });
      } catch { /* Content script may not be ready on this tab yet. */ }
      if (pageContext?.recognized) {
        context.dataset.kind = 'ready';
        title.textContent = '已识别 TikTok 商品管理页';
        detail.textContent = '商品管理标题和表格结构已确认。';
        footer.textContent = '翻页由你手动确认；工作台不会自动翻页。';
        addAction('打开 TikTok 采集工作台', '商品管理', { type: 'STORESNAPPER_OPEN_WORKBENCH', mode: 'tiktok' });
      } else {
        context.dataset.kind = 'unsupported';
        title.textContent = '暂未识别商品管理表格';
        detail.textContent = pageContext
          ? '当前页面缺少商品管理标题或所需表格字段。'
          : '页面组件还未就绪；刷新页面后再试一次。';
        footer.textContent = '仅在商品管理标题和商品表格同时识别后，才会开启采集。';
      }
      return;
    }

    context.dataset.kind = 'unsupported';
    title.textContent = '当前页面暂不支持';
    detail.textContent = '请打开 Temu 商品列表页或 TikTok Shop 商品管理页。';
    footer.textContent = '打开支持的平台页面后，再点击工具栏图标进入工作台。';
  })();
})();
