(() => {
  const IMAGE_HOSTS = new Set(['img.kwcdn.com', 'img-eu.kwcdn.com', 'aimg.kwcdn.com', 'cbu01.alicdn.com']);
  const PRICE_PATTERN = /(?:£|\$|€|¥|￥)\s*\d[\d,.]*/;
  let routeUrl = location.href;
  let root;
  let shadow;
  let icon;
  let activeImage;
  let activeHoverTarget;
  let activeProduct;
  let lastPointerX = 0;
  let lastPointerY = 0;
  let currentRequestId;
  let lastDiagnosticState = '';
  let diagnosticWrite = Promise.resolve();
  let supported = false;
  const state = {
    phase: 'idle',
    product: undefined,
    results: [],
    message: '',
    issue: undefined,
    diagnostic: undefined,
  };

  function isTemuHost(hostname = location.hostname) {
    return hostname === 'www.temu.com';
  }

  function is1688Source() {
    return ['www.1688.com', 'search.1688.com', 'air.1688.com'].includes(location.hostname);
  }

  function isSupportedListing() {
    // Website recognition is intentionally independent of URL layout. Product cards
    // are checked separately so home, channel, category and search feeds can vary.
    if (is1688Source()) return true;
    return isTemuHost() && !isProductLink(location.href)
      && !/\/(?:login|register|signup|account|checkout)(?:\.html|\/|$)/i.test(location.pathname);
  }

  function ensureUi() {
    if (root) return;
    root = document.createElement('div');
    root.id = 'storesnapper-sourcing-root';
    root.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
    shadow = root.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<style>:host{all:initial}.icon{position:fixed;display:none;place-items:center;width:30px;height:30px;padding:0;border:1px solid rgba(20,54,44,.16);border-radius:50%;color:#174d3c;background:rgba(255,255,255,.97);box-shadow:0 2px 8px rgba(0,0,0,.2);cursor:pointer;pointer-events:auto;transition:transform .12s ease}.icon:hover,.icon:focus-visible{transform:scale(1.08);outline:2px solid #1e7658;outline-offset:1px}.icon svg{width:16px;height:16px}</style><button class="icon" type="button" aria-label="在1688按图搜索" title="在1688按图搜索"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"><circle cx="10.8" cy="10.8" r="6.4"></circle><path d="m15.6 15.6 4.4 4.4"></path></svg></button>';
    document.documentElement.append(root);
    icon = shadow.querySelector('.icon');
    icon.addEventListener('pointerleave', hideIcon);
    icon.addEventListener('blur', hideIcon);
    icon.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (activeProduct) void startSearch(activeProduct);
    });
  }

  function getCandidate(media) {
    const isImage = media instanceof HTMLImageElement;
    const isVideoPoster = media instanceof HTMLVideoElement && Boolean(media.poster || media.getAttribute('poster'));
    if ((!isImage && !isVideoPoster) || !media.isConnected || (isImage && !media.complete)) return undefined;
    if (isProductLink(location.href)) return undefined;
    const rect = media.getBoundingClientRect();
    if (rect.width < 72 || rect.height < 72 || rect.width > 1100 || rect.height > 1100) return undefined;
    if (isImage && (media.naturalWidth < 120 || media.naturalHeight < 120)) return undefined;
    const ratio = rect.width / rect.height;
    if (ratio < 0.75 || ratio > 1.35) return undefined;
    const mediaStyle = getComputedStyle(media);
    if (mediaStyle.visibility === 'hidden' || mediaStyle.display === 'none' || Number(mediaStyle.opacity) < 0.05) return undefined;

    const imageUrl = isImage
      ? media.currentSrc || media.getAttribute('data-src') || media.getAttribute('src') || ''
      : media.poster || media.getAttribute('poster') || '';
    let parsedImage;
    try { parsedImage = new URL(imageUrl, location.href); } catch { return undefined; }
    if (parsedImage.protocol !== 'https:' || !IMAGE_HOSTS.has(parsedImage.hostname)) return undefined;
    if (is1688Source()) {
      if (parsedImage.hostname !== 'cbu01.alicdn.com') return undefined;
      const title = cleanTitle(media.getAttribute('alt') || media.getAttribute('title') || '') || '1688 商品图片';
      return { image: media, imageUrl: parsedImage.href, title, card: media.parentElement };
    }

    const ancestors = [];
    for (let node = media.parentElement, depth = 0; node && depth < 7 && node !== document.body; node = node.parentElement, depth += 1) ancestors.push(node);
    const links = new Set();
    for (const node of ancestors) {
      if (node.matches('a[href]')) links.add(node);
      node.querySelectorAll('a[href]').forEach((link) => { if (links.size < 5) links.add(link); });
      if (links.size >= 5) break;
    }
    const productLink = [...links].find((link) => isProductLink(link.href));
    const dataId = ancestors.some((node) => [...node.attributes].some((attribute) => /(?:goods|product|item)[_-]?id/i.test(attribute.name) && attribute.value.trim()));
    const card = ancestors.find((node) => {
      const text = (node.innerText || node.textContent || '').trim();
      const mediaCount = node.querySelectorAll('img, video[poster]').length;
      const linkCount = node.querySelectorAll('a[href]').length;
      return text.length >= 12 && text.length <= 900 && mediaCount >= 1 && mediaCount <= 5 && linkCount <= 5;
    }) || productLink || media.parentElement;
    const cardText = (card?.innerText || card?.textContent || '').replace(/\s+/g, ' ').trim();
    const priceSignal = PRICE_PATTERN.test(cardText);
    const alt = isImage ? cleanTitle(media.getAttribute('alt') || media.getAttribute('title') || '') : '';
    const headingText = cleanTitle(productLink?.querySelector('h1, h2, h3, [role="heading"]')?.innerText || '');
    const titleSignal = alt.length >= 10 || headingText.length >= 10 || cardText.length >= 28;
    const interactive = [...links].length > 0 || ancestors.some((node) => node.getAttribute('role') === 'link' || node.getAttribute('role') === 'button' || getComputedStyle(node).cursor === 'pointer');
    const cardContainsMedia = Boolean(card?.contains(media));
    const cardContainsProductLink = Boolean(productLink && card?.contains(productLink));
    const productCardSignal = cardContainsMedia && titleSignal && (
      cardContainsProductLink
      || (dataId && (priceSignal || cardText.length >= 28))
      || (interactive && priceSignal)
    );
    if (!productCardSignal) return undefined;

    const title = alt || headingText || cleanTitle(cardText).slice(0, 140) || 'Temu 商品';
    return { image: media, imageUrl: parsedImage.href, title, card };
  }

  function getCandidateAtPointer(target, x, y) {
    if (target instanceof HTMLImageElement || target instanceof HTMLVideoElement) {
      const direct = getCandidate(target);
      if (direct) return direct;
    }
    const seen = new Set();
    for (let node = target, depth = 0; node && depth < 9 && node !== document.body; node = node.parentElement, depth += 1) {
      const media = [];
      if (node instanceof HTMLImageElement || node instanceof HTMLVideoElement) media.push(node);
      for (const descendant of node.querySelectorAll('img, video[poster]')) {
        if (media.length >= 8) break;
        media.push(descendant);
      }
      const candidates = [];
      for (const element of media) {
        if (seen.has(element)) continue;
        seen.add(element);
        const rect = element.getBoundingClientRect();
        if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
        const candidate = getCandidate(element);
        if (candidate) candidates.push(candidate);
      }
      if (candidates.length) {
        candidates.sort((a, b) => {
          const aRect = a.image.getBoundingClientRect();
          const bRect = b.image.getBoundingClientRect();
          const areaDifference = (bRect.width * bRect.height) - (aRect.width * aRect.height);
          if (Math.abs(areaDifference) > 1) return areaDifference;
          return (b.image.naturalWidth || 0) - (a.image.naturalWidth || 0);
        });
        return candidates[0];
      }
      if (node.querySelectorAll('img, video[poster]').length > 8) break;
    }
    return undefined;
  }

  function isProductLink(href) {
    try {
      const url = new URL(href, location.href);
      if (url.protocol !== 'https:' || !isTemuHost(url.hostname)) return false;
      const path = url.pathname.toLowerCase();
      if (/-o\d+-\d+\.html$/.test(path) || /search_result/.test(path)) return false;
      const keys = [...url.searchParams.keys()].map((key) => key.toLowerCase());
      return keys.some((key) => /^(goods|product|item)[_-]?id$/.test(key))
        || /(?:goods|product|item)[_-]?detail|\/goods\/|\/product\/|\/item\/|(?:^|-)g-\d{6,}/i.test(path);
    } catch { return false; }
  }

  function cleanTitle(value) {
    return String(value || '').replace(/^\s*(?:商品图片|image|img)\s*/i, '').replace(/\s+/g, ' ').trim();
  }

  function setActiveImage(target, x, y) {
    activeHoverTarget = target;
    const product = getCandidateAtPointer(target, x, y);
    if (!supported || !product) {
      activeImage = undefined;
      activeProduct = undefined;
      hideIcon(false);
      return;
    }
    activeImage = product.image;
    activeProduct = product;
    positionIcon();
    icon.hidden = false;
    icon.style.display = 'grid';
  }

  function positionIcon() {
    if (!activeImage?.isConnected || !icon) return;
    const rect = activeImage.getBoundingClientRect();
    const left = Math.max(4, Math.min(window.innerWidth - 34, rect.right - 36));
    const top = Math.max(4, Math.min(window.innerHeight - 34, rect.top + 6));
    icon.style.left = `${left}px`;
    icon.style.top = `${top}px`;
  }

  function hideIcon(clearTarget = true) {
    if (!icon) return;
    icon.style.display = 'none';
    if (clearTarget) {
      activeImage = undefined;
      activeHoverTarget = undefined;
    }
    activeProduct = undefined;
  }

  function onPointerOver(event) {
    if (!supported || !event.target || (root && root.contains(event.target))) return;
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
    setActiveImage(event.target, lastPointerX, lastPointerY);
  }

  function onPointerOut(event) {
    if (event.target !== activeHoverTarget) return;
    const related = event.relatedTarget;
    if (related === root || related === icon || (related instanceof Node && root?.contains(related))) return;
    hideIcon();
  }

  async function startSearch(product) {
    if (!supported || !product?.imageUrl) return;
    ensureUi();
    void chrome.runtime.sendMessage({ type: 'OPEN_STORE_SIDEPANEL' }).catch(() => undefined);
    state.phase = 'preparing';
    state.product = product;
    state.results = [];
    state.diagnostic = undefined;
    state.message = '正在准备商品图片…';
    state.issue = undefined;
    currentRequestId = crypto.randomUUID();
    const requestId = currentRequestId;
    hideIcon();
    render();

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'SEARCH_IMAGE', requestId, imageUrl: product.imageUrl, title: product.title,
      });
      if (requestId !== currentRequestId) return;
      if (!response?.ok) {
        state.phase = 'failed';
        state.message = response?.error || '无法启动 1688 搜图，请重试。';
        render();
      }
    } catch {
      if (requestId !== currentRequestId) return;
      state.phase = 'failed';
      state.message = '插件后台暂不可用。请在扩展管理页重新加载插件后重试。';
      render();
    }
  }

  function render() {
    if (!supported) return;
    const diagnostic = state.diagnostic;
    const diagnosticState = `${state.phase}:${state.results.length}:${diagnostic?.stage || ''}:${diagnostic?.duration_ms ?? ''}:${diagnostic?.credential_found ?? ''}:${diagnostic?.cookie_changed ?? ''}:${diagnostic?.outcome || ''}`;
    if (state.phase !== 'idle' && diagnosticState !== lastDiagnosticState) {
      lastDiagnosticState = diagnosticState;
      const phase = state.phase;
      const resultCount = state.results.length;
      const record = { at: new Date().toISOString(), type: is1688Source() ? '1688_search' : 'temu_search', phase, resultCount };
      if (diagnostic) {
        record.upload_stage = diagnostic.stage;
        if (Number.isFinite(diagnostic.duration_ms)) record.elapsed_ms = diagnostic.duration_ms;
        if (typeof diagnostic.credential_found === 'boolean') record.credential_found = diagnostic.credential_found;
        if (typeof diagnostic.cookie_changed === 'boolean') record.cookie_changed = diagnostic.cookie_changed;
        if (diagnostic.outcome) record.outcome = diagnostic.outcome;
      }
      diagnosticWrite = diagnosticWrite.then(async () => {
        const stored = await chrome.storage.local.get('storesnapper_diagnostics_v1');
        const records = Array.isArray(stored.storesnapper_diagnostics_v1) ? stored.storesnapper_diagnostics_v1 : [];
        records.push(record);
        await chrome.storage.local.set({ storesnapper_diagnostics_v1: records.slice(-100) });
      }).catch(() => undefined);
    }
    const mode = is1688Source() ? '1688' : 'temu';
    void chrome.runtime.sendMessage({ type: 'STOREPANEL_STATE', mode, state: {
      recognized: true,
      phase: state.phase,
      title: state.product?.title || '',
      message: state.message || phaseMessage(state.phase) || `悬停${is1688Source() ? '1688' : 'Temu'}商品主图，点击放大镜开始搜图。`,
      count: state.results.length,
      results: state.results,
      hasProduct: Boolean(state.product),
    } }).catch(() => undefined);
  }

  function phaseMessage(phase) {
    if (phase === 'preparing') return '正在准备商品图片…';
    if (phase === 'uploading') return '正在提交图片到 1688…';
    if (phase === 'searching') return '正在搜索相似货源…';
    if (phase === 'enriching') return '正在读取 1688 官方卡片信息…';
    if (phase === 'empty') return '1688 本次没有返回相似货源。';
    if (phase === 'needs-auth') return '请在 1688 完成登录或安全验证后重新搜索。';
    if (phase === 'failed') return '搜索失败，请重试。';
    if (phase === 'ready') return '';
    return '';
  }

  async function retrySearch() {
    if (state.product) await startSearch(state.product);
  }

  async function openLogin() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'OPEN_1688_LOGIN' });
      if (!response?.ok) throw new Error(response?.error || '无法打开 1688 登录页。');
    } catch {
      state.message = '无法打开 1688 登录页，请手动打开 1688 后重试。';
      render();
    }
  }

  function closePanel(cancel) {
    const oldRequestId = currentRequestId;
    currentRequestId = undefined;
    if (cancel && oldRequestId) void chrome.runtime.sendMessage({ type: 'CANCEL_SEARCH', requestId: oldRequestId }).catch(() => undefined);
    render();
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'STORESNAPPER_GET_PANEL_STATE' && supported) {
      sendResponse({ ok: true, mode: is1688Source() ? '1688' : 'temu', state: {
        recognized: true,
        phase: state.phase,
        title: state.product?.title || '',
        message: state.message || phaseMessage(state.phase) || `悬停${is1688Source() ? '1688' : 'Temu'}商品主图，点击放大镜开始搜图。`,
        count: state.results.length,
        results: state.results,
        hasProduct: Boolean(state.product),
      } });
      return false;
    }
    if (message?.type === 'TEMU_PANEL_ACTION' && supported) {
      if (message.action === 'retry') void retrySearch().then(() => sendResponse({ ok: true }));
      else if (message.action === 'login') void openLogin().then(() => sendResponse({ ok: true }));
      else if (message.action === 'auth_ready') {
        state.phase = 'idle';
        state.message = '已取得 1688 搜图凭据，请在商品主图上点击放大镜重新搜索。';
        state.diagnostic = undefined;
        render();
        sendResponse({ ok: true });
        return false;
      }
      else sendResponse({ ok: false });
      return true;
    }
    if (message?.type !== 'SEARCH_UPDATE' || message.requestId !== currentRequestId) return;
    state.phase = message.state || 'failed';
    state.results = Array.isArray(message.results) ? message.results : [];
    state.message = message.message || phaseMessage(state.phase);
    state.issue = message.issue;
    state.diagnostic = safeUploadDiagnostic(message.diagnostic);
    render();
  });

  function safeUploadDiagnostic(value) {
    const stages = [
      'token_lookup', 'token_refresh', 'token_after_bootstrap', 'token_cookie_url', 'token_cookie_domain', 'token_page_cookie',
      'token_cookie_after_bootstrap', 'image_upload_bootstrap', 'token_first_party_bootstrap', 'image_upload', 'image_upload_retry',
    ];
    if (!value || !stages.includes(value.stage)) return undefined;
    const diagnostic = { stage: value.stage };
    if (Number.isFinite(value.duration_ms)) diagnostic.duration_ms = Math.max(0, Math.round(value.duration_ms));
    if (typeof value.credential_found === 'boolean') diagnostic.credential_found = value.credential_found;
    if (typeof value.cookie_changed === 'boolean') diagnostic.cookie_changed = value.cookie_changed;
    if (['found', 'empty', 'error', 'timeout', 'completed', 'sent', 'no_page', 'request_failed'].includes(value.outcome)) diagnostic.outcome = value.outcome;
    return diagnostic;
  }

  document.addEventListener('pointerover', onPointerOver, true);
  document.addEventListener('pointerout', onPointerOut, true);
  document.addEventListener('load', (event) => {
    if (!(event.target instanceof HTMLImageElement)) return;
    const rect = event.target.getBoundingClientRect();
    if (lastPointerX >= rect.left && lastPointerX <= rect.right && lastPointerY >= rect.top && lastPointerY <= rect.bottom) {
      setActiveImage(event.target, lastPointerX, lastPointerY);
    }
  }, true);
  window.addEventListener('scroll', positionIcon, { capture: true, passive: true });
  window.addEventListener('resize', positionIcon, { passive: true });
  window.addEventListener('popstate', handleRouteChange);
  window.addEventListener('hashchange', handleRouteChange);

  const routeObserver = new MutationObserver(() => {
    if (location.href !== routeUrl) handleRouteChange();
  });
  routeObserver.observe(document.documentElement, { childList: true, subtree: true });
  supported = isSupportedListing();
  if (supported) ensureUi();

  function handleRouteChange() {
    if (location.href === routeUrl) return;
    routeUrl = location.href;
    supported = isSupportedListing();
    if (supported) ensureUi();
    else {
      closePanel(true);
      root?.remove();
      root = undefined;
      shadow = undefined;
      icon = undefined;
    }
    hideIcon();
  }
})();
