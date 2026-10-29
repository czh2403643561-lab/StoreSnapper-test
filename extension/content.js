(() => {
  const IMAGE_HOSTS = new Set(['img.kwcdn.com', 'aimg.kwcdn.com']);
  const PRICE_PATTERN = /(?:£|\$|€|¥|￥)\s*\d[\d,.]*/;
  let routeUrl = location.href;
  let root;
  let shadow;
  let icon;
  let panel;
  let rail;
  let titleNode;
  let messageNode;
  let disclaimerNode;
  let actionsNode;
  let cardsNode;
  let resultsCountNode;
  let activeImage;
  let activeProduct;
  let hideTimer;
  let currentRequestId;
  let supported = false;
  const state = {
    open: false,
    collapsed: false,
    phase: 'idle',
    product: undefined,
    results: [],
    message: '',
    disclaimer: '',
    issue: undefined,
  };

  function isSupportedListing() {
    if (location.hostname !== 'www.temu.com') return false;
    const path = location.pathname.toLowerCase();
    const params = new URLSearchParams(location.search);
    const category = /-o\d+-\d+\.html$/.test(path) || params.get('_x_enter_scene_type') === 'cate_tab';
    const search = /\/search_result(?:\.html)?\/?$/.test(path)
      && ['search_key', 'searchKey', 'q', 'query'].some((key) => Boolean(params.get(key)));
    return category || search;
  }

  function ensureUi() {
    if (root) return;
    root = document.createElement('div');
    root.id = 'storesnapper-temu-sourcing-root';
    root.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
    shadow = root.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; }
        button { font: inherit; }
        .icon {
          position: fixed; display: none; place-items: center; width: 30px; height: 30px;
          padding: 0; border: 1px solid rgba(20, 54, 44, .16); border-radius: 50%;
          color: #174d3c; background: rgba(255,255,255,.96); box-shadow: 0 2px 8px rgba(0,0,0,.2);
          cursor: pointer; pointer-events: auto; transition: transform .12s ease, opacity .12s ease;
        }
        .icon:hover, .icon:focus-visible { transform: scale(1.08); outline: 2px solid #1e7658; outline-offset: 1px; }
        .icon svg { width: 16px; height: 16px; }
        .panel, .rail {
          position: fixed; left: 0; top: 0; height: 100vh; color: #202822; background: #fff;
          box-shadow: 5px 0 24px rgba(20, 35, 28, .18); pointer-events: auto;
          font: 13px/1.45 Arial, "Microsoft YaHei", sans-serif;
        }
        .panel { display: flex; flex-direction: column; width: min(360px, 94vw); max-width: 360px; }
        .rail {
          display: flex; align-items: center; justify-content: center; width: 42px; cursor: pointer;
          border: 0; border-right: 1px solid #e7ece8; color: #21543f; background: #f7faf8;
          font-weight: 700; letter-spacing: .04em; writing-mode: vertical-rl;
        }
        .header {
          display: flex; align-items: center; gap: 8px; padding: 12px 12px 10px;
          border-bottom: 1px solid #e9eeeb; background: #fff;
        }
        .heading { min-width: 0; flex: 1; }
        .heading strong { display: block; font-size: 15px; line-height: 20px; }
        .product-title { overflow: hidden; margin-top: 2px; color: #69746e; text-overflow: ellipsis; white-space: nowrap; }
        .header-button {
          display: grid; place-items: center; width: 29px; height: 29px; flex: 0 0 auto;
          border: 1px solid #e0e7e2; border-radius: 7px; color: #405148; background: #fff; cursor: pointer;
        }
        .header-button:hover { background: #f1f6f2; }
        .scroll-area { min-height: 0; flex: 1; overflow-y: auto; overscroll-behavior: contain; padding: 10px 10px 18px; }
        .message {
          margin: 0 0 9px; padding: 10px; border: 1px solid #e7ece8; border-radius: 9px;
          color: #425048; background: #f8faf8;
        }
        .message[data-state="loading"] { color: #245c43; background: #f1f8f3; }
        .message[data-state="auth"] { color: #684c15; border-color: #f0dfb5; background: #fff9e9; }
        .message[data-state="error"] { color: #783d38; border-color: #f0d3cf; background: #fff6f5; }
        .disclaimer { margin: 0 1px 9px; color: #7a827d; font-size: 11px; }
        .actions { display: flex; gap: 7px; margin: 0 0 10px; }
        .action {
          min-height: 32px; padding: 6px 9px; border: 1px solid #dce5de; border-radius: 7px;
          color: #245c43; background: #fff; cursor: pointer;
        }
        .action.primary { color: #fff; border-color: #26734f; background: #26734f; }
        .action:hover { filter: brightness(.97); }
        .count { margin: 5px 1px 8px; color: #6c7770; font-size: 11px; }
        .cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }
        .card {
          min-width: 0; overflow: hidden; padding: 0; border: 1px solid #e6ebe7; border-radius: 9px;
          text-align: left; color: inherit; background: #fff; cursor: pointer;
        }
        .card:hover { border-color: #83aa92; box-shadow: 0 2px 8px rgba(25, 77, 51, .1); }
        .card-image, .image-placeholder { display: grid; place-items: center; width: 100%; aspect-ratio: 1; background: #f3f5f3; }
        .card-image { object-fit: contain; }
        .image-placeholder { padding: 8px; color: #8b938e; font-size: 11px; text-align: center; }
        .card-info { padding: 7px 7px 8px; }
        .card-title { display: -webkit-box; height: 33px; overflow: hidden; margin: 0 0 6px; color: #38423c; font-size: 11px; line-height: 16px; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
        .price { min-height: 19px; margin-bottom: 5px; color: #a83e32; font-size: 14px; font-weight: 700; }
        .meta { display: flex; flex-direction: column; gap: 2px; color: #657068; font-size: 10px; }
        .supplier { overflow: hidden; margin-top: 6px; color: #42554a; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
        .badge { display: inline-block; max-width: 100%; overflow: hidden; margin: 5px 3px 0 0; padding: 2px 5px; border-radius: 4px; color: #486453; background: #eff5f0; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
        .icon[hidden], .panel[hidden], .rail[hidden], .actions[hidden], .disclaimer[hidden], .count[hidden] { display: none !important; }
        @media (max-width: 320px) { .panel { width: 100vw; } .cards { grid-template-columns: 1fr; } }
      </style>
      <button class="icon" type="button" aria-label="在1688按图搜索" title="在1688按图搜索">
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round">
          <circle cx="10.8" cy="10.8" r="6.4"></circle><path d="m15.6 15.6 4.4 4.4"></path>
        </svg>
      </button>
      <aside class="panel" aria-label="1688 相似货源" hidden>
        <div class="header">
          <div class="heading"><strong>1688 相似货源</strong><div class="product-title"></div></div>
          <button class="header-button collapse" type="button" aria-label="收起货源栏" title="收起">−</button>
          <button class="header-button close" type="button" aria-label="关闭货源栏" title="关闭">×</button>
        </div>
        <div class="scroll-area">
          <p class="message" role="status" aria-live="polite"></p>
          <p class="disclaimer" hidden></p>
          <div class="actions" hidden></div>
          <p class="count" hidden></p>
          <div class="cards"></div>
        </div>
      </aside>
      <button class="rail" type="button" aria-label="展开1688货源栏" title="展开货源栏" hidden>⌕&nbsp;1688</button>
    `;
    document.documentElement.append(root);
    icon = shadow.querySelector('.icon');
    panel = shadow.querySelector('.panel');
    rail = shadow.querySelector('.rail');
    titleNode = shadow.querySelector('.product-title');
    messageNode = shadow.querySelector('.message');
    disclaimerNode = shadow.querySelector('.disclaimer');
    actionsNode = shadow.querySelector('.actions');
    cardsNode = shadow.querySelector('.cards');
    resultsCountNode = shadow.querySelector('.count');

    icon.addEventListener('pointerenter', () => clearTimeout(hideTimer));
    icon.addEventListener('pointerleave', hideIconSoon);
    icon.addEventListener('focus', () => clearTimeout(hideTimer));
    icon.addEventListener('blur', hideIconSoon);
    icon.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (activeProduct) void startSearch(activeProduct);
    });
    shadow.querySelector('.collapse').addEventListener('click', () => {
      state.collapsed = true;
      render();
    });
    shadow.querySelector('.close').addEventListener('click', () => closePanel(true));
    rail.addEventListener('click', () => {
      state.collapsed = false;
      state.open = true;
      render();
    });
    render();
  }

  function getCandidate(media) {
    const isImage = media instanceof HTMLImageElement;
    const isVideoPoster = media instanceof HTMLVideoElement && Boolean(media.poster || media.getAttribute('poster'));
    if ((!isImage && !isVideoPoster) || !media.isConnected || (isImage && !media.complete)) return undefined;
    const rect = media.getBoundingClientRect();
    if (rect.width < 72 || rect.height < 72 || rect.width > 1100 || rect.height > 1100) return undefined;
    if (isImage && (media.naturalWidth < 120 || media.naturalHeight < 120)) return undefined;
    const ratio = rect.width / rect.height;
    if (ratio < 0.75 || ratio > 1.35) return undefined;
    if (getComputedStyle(media).visibility === 'hidden' || getComputedStyle(media).display === 'none') return undefined;

    const imageUrl = isImage
      ? media.currentSrc || media.getAttribute('data-src') || media.getAttribute('src') || ''
      : media.poster || media.getAttribute('poster') || '';
    let parsedImage;
    try { parsedImage = new URL(imageUrl, location.href); } catch { return undefined; }
    if (parsedImage.protocol !== 'https:' || !IMAGE_HOSTS.has(parsedImage.hostname)) return undefined;

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
    const strongIdentity = Boolean(dataId || productLink);
    if (!strongIdentity && !(interactive && priceSignal && titleSignal)) return undefined;

    const title = alt || headingText || cleanTitle(cardText).slice(0, 140) || 'Temu 商品';
    return { image: media, imageUrl: parsedImage.href, title, card };
  }

  function isProductLink(href) {
    try {
      const url = new URL(href, location.href);
      if (url.protocol !== 'https:' || url.hostname !== 'www.temu.com') return false;
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

  function setActiveImage(image) {
    activeImage = image;
    const product = getCandidate(image);
    if (!supported || !product) {
      activeProduct = undefined;
      hideIcon(false);
      return;
    }
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
    if (clearTarget) activeImage = undefined;
    activeProduct = undefined;
  }

  function hideIconSoon() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      hideIcon();
    }, 650);
  }

  function onPointerOver(event) {
    if (!supported || !event.target || (root && root.contains(event.target))) return;
    if (event.target instanceof HTMLImageElement || event.target instanceof HTMLVideoElement) {
      clearTimeout(hideTimer);
      setActiveImage(event.target);
    }
  }

  function onPointerOut(event) {
    if (event.target !== activeImage) return;
    const related = event.relatedTarget;
    if (related === root || related === icon || (related instanceof Node && root?.contains(related))) return;
    hideIconSoon();
  }

  async function startSearch(product) {
    if (!supported || !product?.imageUrl) return;
    ensureUi();
    clearTimeout(hideTimer);
    state.open = true;
    state.collapsed = false;
    state.phase = 'preparing';
    state.product = product;
    state.results = [];
    state.message = '正在准备商品图片…';
    state.disclaimer = '只展示图片相似货源，不代表完全同款或库存已确认。';
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
    if (!shadow) return;
    panel.hidden = !state.open || state.collapsed;
    rail.hidden = !state.open || !state.collapsed;
    if (!state.open || state.collapsed) return;
    titleNode.textContent = state.product?.title || 'Temu 商品';
    messageNode.textContent = state.message || phaseMessage(state.phase);
    messageNode.dataset.state = ['preparing', 'uploading', 'searching', 'enriching'].includes(state.phase)
      ? 'loading' : state.phase === 'needs-auth' ? 'auth' : ['failed', 'empty'].includes(state.phase) ? 'error' : 'ready';
    disclaimerNode.hidden = !state.disclaimer;
    disclaimerNode.textContent = state.disclaimer;
    cardsNode.replaceChildren(...state.results.map(createCard));
    resultsCountNode.hidden = !state.results.length;
    resultsCountNode.textContent = state.results.length ? `${state.results.length} 个相似货源` : '';

    actionsNode.replaceChildren();
    const needsActions = ['needs-auth', 'failed', 'empty'].includes(state.phase);
    actionsNode.hidden = !needsActions;
    if (state.phase === 'needs-auth') {
      actionsNode.append(makeAction('在 1688 登录／验证', 'primary', openLogin));
      actionsNode.append(makeAction('已完成，重新搜索', '', retrySearch));
    } else if (needsActions) {
      actionsNode.append(makeAction('重新搜索', 'primary', retrySearch));
      if (state.phase === 'needs-auth') actionsNode.append(makeAction('在 1688 登录', '', openLogin));
    }
  }

  function phaseMessage(phase) {
    if (phase === 'preparing') return '正在准备商品图片…';
    if (phase === 'uploading') return '正在提交图片到 1688…';
    if (phase === 'searching') return '正在搜索相似货源…';
    if (phase === 'enriching') return '正在读取 1688 官方卡片信息…';
    if (phase === 'empty') return '1688 本次没有返回相似货源。';
    if (phase === 'needs-auth') return '请在 1688 完成登录或安全验证后重新搜索。';
    if (phase === 'failed') return '搜索失败，请重试。';
    if (phase === 'ready') return '已显示 1688 返回的相似货源。';
    return '';
  }

  function makeAction(label, variant, handler) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `action ${variant}`.trim();
    button.textContent = label;
    button.addEventListener('click', handler);
    return button;
  }

  function createCard(item) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'card';
    card.setAttribute('aria-label', `打开 1688 相似货源：${item.title || '商品详情'}`);
    const imageUrl = safeHttpsUrl(item.image_url);
    if (imageUrl) {
      const image = document.createElement('img');
      image.className = 'card-image';
      image.loading = 'lazy';
      image.referrerPolicy = 'no-referrer';
      image.alt = item.title || '1688 商品图片';
      image.src = imageUrl;
      image.addEventListener('error', () => {
        const placeholder = document.createElement('div');
        placeholder.className = 'image-placeholder';
        placeholder.textContent = '商品图片暂不可用';
        image.replaceWith(placeholder);
      }, { once: true });
      card.append(image);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'image-placeholder';
      placeholder.textContent = '商品图片暂无';
      card.append(placeholder);
    }

    const info = document.createElement('div');
    info.className = 'card-info';
    const title = document.createElement('p');
    title.className = 'card-title';
    title.textContent = item.title || '商品标题暂无';
    const price = document.createElement('div');
    price.className = 'price';
    price.textContent = item.price?.display || '价格暂无';
    const meta = document.createElement('div');
    meta.className = 'meta';
    const minimum = document.createElement('span');
    minimum.textContent = `起批：${item.minimum_order || '暂无'}`;
    const sales = document.createElement('span');
    sales.textContent = `销量：${item.sales || '暂无'}`;
    meta.append(minimum, sales);
    info.append(title, price, meta);
    if (item.supplier_name) {
      const supplier = document.createElement('div');
      supplier.className = 'supplier';
      supplier.textContent = `供应商：${item.supplier_name}`;
      info.append(supplier);
    }
    if (item.supplier_years) {
      const years = document.createElement('span');
      years.className = 'badge';
      years.textContent = item.supplier_years;
      info.append(years);
    }
    if (Array.isArray(item.badges)) {
      for (const value of item.badges.slice(0, 2)) {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = value;
        info.append(badge);
      }
    }
    card.append(info);
    card.addEventListener('click', () => {
      void chrome.runtime.sendMessage({ type: 'OPEN_1688_OFFER', offerId: item.offer_id }).catch(() => undefined);
    });
    return card;
  }

  function safeHttpsUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' ? url.href : '';
    } catch { return ''; }
  }

  async function retrySearch() {
    if (state.product) await startSearch(state.product);
  }

  async function openLogin() {
    try {
      await chrome.runtime.sendMessage({ type: 'OPEN_1688_LOGIN' });
    } catch {
      state.message = '无法打开 1688 登录页，请手动打开 1688 后重试。';
      render();
    }
  }

  function closePanel(cancel) {
    state.open = false;
    state.collapsed = false;
    const oldRequestId = currentRequestId;
    currentRequestId = undefined;
    if (cancel && oldRequestId) void chrome.runtime.sendMessage({ type: 'CANCEL_SEARCH', requestId: oldRequestId }).catch(() => undefined);
    render();
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== 'SEARCH_UPDATE' || message.requestId !== currentRequestId) return;
    state.phase = message.state || 'failed';
    state.results = Array.isArray(message.results) ? message.results : [];
    state.message = message.message || phaseMessage(state.phase);
    state.disclaimer = message.disclaimer || (state.results.length ? '相似货源仅供参考；请在 1688 核实款式、价格和库存。' : '');
    state.issue = message.issue;
    render();
  });

  document.addEventListener('pointerover', onPointerOver, true);
  document.addEventListener('pointerout', onPointerOut, true);
  document.addEventListener('load', (event) => {
    if (event.target === activeImage) setActiveImage(activeImage);
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
    else closePanel(true);
    hideIcon();
  }
})();
