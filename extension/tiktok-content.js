(() => {
  if (!location.hostname.endsWith('seller.eu.tiktokshopglobalselling.com')) return;
  if (!/^\/product\/manage\/?$/.test(location.pathname)) return;
  if (window.__storeSnapperTikTokCollector) return;
  window.__storeSnapperTikTokCollector = true;

  const Core = window.StoreSnapperTikTokCore;
  if (!Core || !chrome?.storage?.local) return;
  const STORE_KEY = 'storesnapper_tiktok_collection_v1';
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const textOf = (element) => (element?.innerText || element?.textContent || '').replace(/\s+/g, ' ').trim();
  const visible = (element) => Boolean(element?.getClientRects?.().length);
  const safeError = (error) => {
    const text = String(error?.message || error || '未知错误').replace(/https?:\/\/\S+/g, '[链接]').replace(/[\r\n\t]+/g, ' ').slice(0, 120);
    return text || '未知错误';
  };

  const state = {
    host: null,
    shadow: null,
    mode: '识别中',
    status: 'idle',
    session: null,
    sessionKey: null,
    logs: [],
    paused: false,
    pauseWaiters: [],
    running: false,
    restoreDone: false,
    targetPage: null,
    mutationTimer: 0,
    lastScope: null,
  };

  function log(step, message, details = {}) {
    const entry = {
      at: new Date().toISOString(),
      step,
      message: String(message).replace(/https?:\/\/\S+/g, '[链接]').slice(0, 160),
      ...details,
    };
    state.logs.push(entry);
    state.logs = state.logs.slice(-120);
    render();
    void persist();
  }

  function setStatus(status, message, step = '状态') {
    state.status = status;
    if (state.session) state.session.status = status;
    if (message) log(step, message);
    render();
    void persist();
  }

  function findManageHeading() {
    return [...document.querySelectorAll('h1,h2,[role="heading"]')]
      .find((element) => visible(element) && textOf(element) === '商品管理') || null;
  }

  function headerInfo(table) {
    const headerRow = table?.tHead?.rows?.[0] || table?.querySelector('thead tr');
    if (!headerRow) return null;
    const cells = [...headerRow.cells].map(textOf);
    const indexes = {};
    for (const [index, label] of cells.entries()) {
      const normalized = label.replace(/\s+/g, '');
      if (normalized === '商品') indexes.product = index;
      else if (normalized === '表现') indexes.performance = index;
      else if (normalized === '状态') indexes.status = index;
      else if (normalized === '库存') indexes.inventory = index;
      else if (normalized === '零售价') indexes.price = index;
    }
    if (['product', 'status', 'inventory', 'price'].some((name) => indexes[name] === undefined)) return null;
    return { cells, indexes };
  }

  function findProductTable() {
    return [...document.querySelectorAll('main table, table')]
      .map((table) => ({ table, headers: headerInfo(table) }))
      .filter(({ table, headers }) => headers && table.tBodies.length > 0)
      .sort((left, right) => right.table.querySelectorAll('tbody tr').length - left.table.querySelectorAll('tbody tr').length)[0] || null;
  }

  function pageControls(table) {
    const root = document.querySelector('main') || document;
    const pagination = [...root.querySelectorAll('[class*="pagination"]')].find((element) => /总行数|\d+\s*\/\s*页|下一页/.test(textOf(element))) || root;
    const totalElement = [...pagination.querySelectorAll('*')].find((element) => /^总行数\s*[:：]?\s*[\d,]+$/.test(textOf(element)));
    const pageSizeElement = [...pagination.querySelectorAll('button,[role="button"],select,[class*="option"],[class*="size"]')]
      .find((element) => /(?:每页\s*)?\d+\s*(?:\/\s*页|条\s*\/\s*页)/.test(textOf(element)) || (element.tagName === 'SELECT' && element.value));
    const pageSizeRaw = pageSizeElement?.tagName === 'SELECT'
      ? pageSizeElement.selectedOptions?.[0]?.textContent || pageSizeElement.value
      : textOf(pageSizeElement);
    const active = pagination.querySelector('[aria-current="page"], [aria-current="true"], .core-pagination-item-active, [class*="pagination-item-active"]');
    const activeLabel = active?.getAttribute('aria-label') || active?.getAttribute('title') || '';
    const activeText = textOf(active);
    const totalText = textOf(totalElement) || textOf(pagination).match(/总行数\s*[:：]?\s*[\d,]+/)?.[0] || '';
    const paginationState = Core.parsePagination({ totalText, pageSizeText: pageSizeRaw, activePageText: activeText, activePageLabel: activeLabel });
    if (paginationState.totalRows === 0) {
      paginationState.currentPage = null;
      paginationState.totalPages = 0;
      paginationState.expectedRows = 0;
    }
    return { root, pagination, paginationState, active, totalText, pageSizeRaw };
  }

  function getFilterEvidence() {
    const main = document.querySelector('main');
    if (!main) return [];
    const values = [];
    for (const element of main.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]),select')) {
      if (!visible(element)) continue;
      const value = element.tagName === 'SELECT' ? element.selectedOptions?.[0]?.textContent : element.value;
      const placeholder = element.getAttribute('placeholder') || element.getAttribute('aria-label') || element.name || '';
      if (value || placeholder) values.push(`filter:${placeholder}=${value || ''}`);
    }
    for (const element of main.querySelectorAll('[aria-selected="true"],[aria-current="true"],[class*="tab-active"],[class*="header-title-active"]')) {
      if (!visible(element)) continue;
      const label = textOf(element);
      if (label && !/^(?:\d+|上一页|下一页)$/.test(label)) values.push(`selected:${label}`);
    }
    return [...new Set(values)].sort();
  }

  function pageSnapshot() {
    const found = findProductTable();
    if (!found) return null;
    const controls = pageControls(found.table);
    const filters = getFilterEvidence();
    const scopeId = Core.stableScopeFingerprint({ pathname: location.pathname, search: location.search, filters });
    return { ...found, ...controls, filters, scopeId };
  }

  function isTargetPage() {
    if (!/^\/product\/manage\/?$/.test(location.pathname) || !findManageHeading()) return false;
    return Boolean(findProductTable());
  }

  function detectScrollTarget(table) {
    let candidate = table;
    while (candidate && candidate !== document.body && candidate !== document.documentElement) {
      const style = getComputedStyle(candidate);
      const vertical = `${style.overflowY} ${style.overflow}`;
      if (/(auto|scroll)/.test(vertical) && candidate.scrollHeight > candidate.clientHeight + 8) return candidate;
      candidate = candidate.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }

  function scrollMetrics(target) {
    if (target === document.scrollingElement || target === document.documentElement || target === document.body) {
      return { top: window.scrollY, height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0), viewport: window.innerHeight };
    }
    return { top: target.scrollTop, height: target.scrollHeight, viewport: target.clientHeight };
  }

  function setScroll(target, top) {
    if (target === document.scrollingElement || target === document.documentElement || target === document.body) window.scrollTo({ top, behavior: 'instant' });
    else target.scrollTop = top;
  }

  function rowsFor(table, headers, pageNumber, filters) {
    const rows = [...table.querySelectorAll('tbody tr')];
    const products = [];
    let unidentifiedRows = 0;
    let pendingImages = 0;
    let failedImages = 0;
    for (const row of rows) {
      const cells = [...row.cells];
      if (!cells.length) continue;
      const productCell = cells[headers.indexes.product] || cells.find((cell) => /\bID\s*[:：]\s*\d{8,}/i.test(textOf(cell)));
      const identity = Core.parseProductIdentity(textOf(productCell));
      if (!identity.productId) {
        if (productCell && textOf(productCell) && productCell.querySelector('img')) unidentifiedRows += 1;
        continue;
      }
      const image = productCell?.querySelector('img');
      const imageUrl = image?.currentSrc || image?.src || image?.getAttribute('data-src') || image?.getAttribute('data-original') || null;
      let imageStatus = 'missing';
      if (imageUrl && image?.complete && image.naturalWidth > 0) imageStatus = 'loaded';
      else if (imageUrl && image?.complete && image.naturalWidth === 0) imageStatus = 'failed';
      else if (imageUrl) imageStatus = 'loading';
      if (imageStatus === 'loading') pendingImages += 1;
      if (imageStatus === 'failed') failedImages += 1;
      const value = (name) => cells[headers.indexes[name]] ? textOf(cells[headers.indexes[name]]) : '';
      const nextRow = row.nextElementSibling;
      const skuSummary = textOf(nextRow).match(/[\d,]+\s*个?\s*SKU/i)?.[0] || '';
      products.push(Core.buildProductRecord({
        productId: identity.productId,
        title: identity.title,
        imageUrl,
        imageStatus,
        statusRaw: value('status'),
        inventoryRaw: value('inventory'),
        priceRaw: value('price'),
        performanceRaw: headers.indexes.performance === undefined ? '' : value('performance'),
        skuRaw: skuSummary,
        source: { page_url: location.href, page_number: pageNumber, filter_state: filters },
      }));
    }
    return { products, unidentifiedRows, pendingImages, failedImages, rowCount: rows.length };
  }

  function ensureSession(snapshot) {
    if (state.session && state.session.scope_id === snapshot.scopeId) return;
    state.lastScope = snapshot.scopeId;
    state.session = {
      schema_version: 1,
      scope_id: snapshot.scopeId,
      scope: { page_url: location.href, pathname: location.pathname, filters: snapshot.filters },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      status: 'idle',
      current_page: snapshot.paginationState.currentPage,
      total_pages: snapshot.paginationState.totalPages,
      total_rows: snapshot.paginationState.totalRows,
      page_size: snapshot.paginationState.pageSize,
      pages: [],
      products: {},
      logs: [],
    };
    state.sessionKey = `storesnapper_tiktok_scope_${snapshot.scopeId}`;
    state.status = 'idle';
    state.targetPage = null;
  }

  async function restore() {
    const snapshot = pageSnapshot();
    if (!snapshot) return false;
    state.lastScope = snapshot.scopeId;
    const key = `storesnapper_tiktok_scope_${snapshot.scopeId}`;
    state.sessionKey = key;
    try {
      const stored = await chrome.storage.local.get(key);
      if (stored[key]) {
        state.session = stored[key];
        const interrupted = ['collecting', 'checking', 'paused', 'paging'].includes(state.session.status);
        const pageChanged = state.session.current_page && Number(state.session.current_page) !== Number(snapshot.paginationState.currentPage);
        if (interrupted) state.session.status = 'interrupted';
        else if (pageChanged) state.session.status = 'needs_review';
        state.status = state.session.status || 'idle';
        state.logs = [...(state.session.logs || [])].slice(-120);
        log('恢复', '已恢复本地采集记录；可重新检查当前页或继续。', { recovered: true });
      } else {
        ensureSession(snapshot);
        log('识别', '已识别商品管理表格及分页结构。', { table: 'recognized', current_page: snapshot.paginationState.currentPage, expected: snapshot.paginationState.expectedRows });
      }
      state.restoreDone = true;
      render();
      return true;
    } catch (error) {
      state.restoreDone = true;
      state.status = 'error';
      log('保存', `本地恢复失败：${safeError(error)}`);
      render();
      return false;
    }
  }

  async function persist() {
    if (!state.session || !state.sessionKey) return;
    state.session.updated_at = new Date().toISOString();
    state.session.status = state.status;
    state.session.logs = state.logs.slice(-120);
    try { await chrome.storage.local.set({ [state.sessionKey]: state.session }); }
    catch (error) { state.status = 'error'; state.session.status = 'error'; }
  }

  function currentPageState(snapshot) {
    if (!state.session) return null;
    return state.session.pages.find((page) => Number(page.page_number) === Number(snapshot.paginationState.currentPage));
  }

  function upsertProducts(products) {
    for (const product of products) {
      const id = product.product_id;
      if (!id) continue;
      const previous = state.session.products[id];
      if (previous) {
        const sources = [...(previous.source_pages || [previous.source.page_number]), product.source.page_number].filter(Boolean);
        product.source_pages = [...new Set(sources)];
        if (product.main_image.load_status === 'missing' && previous.main_image?.url) product.main_image = previous.main_image;
        if (product.main_image.load_status === 'failed' && previous.main_image?.load_status === 'loaded') product.main_image = previous.main_image;
      } else product.source_pages = [product.source.page_number].filter(Boolean);
      state.session.products[id] = product;
    }
  }

  function recordPage(snapshot, scan, stablePasses, atBottom, timedOut) {
    const pageNumber = snapshot.paginationState.currentPage;
    const ids = scan.products.map((product) => product.product_id);
    const evaluated = Core.evaluatePage({
      expectedRows: snapshot.paginationState.expectedRows,
      productIds: ids,
      atBottom,
      stablePasses,
      pendingImages: scan.pendingImages,
      failedImages: scan.failedImages,
      missingCriticalRecords: Core.countIncompleteProducts(scan.products),
      unidentifiedRows: scan.unidentifiedRows,
      timedOut,
    });
    state.session.pages = state.session.pages.filter((page) => Number(page.page_number) !== Number(pageNumber));
    state.session.pages.push({
      page_number: pageNumber,
      status: evaluated.status,
      expected_products: snapshot.paginationState.expectedRows,
      unique_products: evaluated.uniqueCount,
      product_ids: [...new Set(ids)],
      captured_at: new Date().toISOString(),
      reasons: evaluated.reasons,
      scroll: { at_bottom: atBottom, stable_passes: stablePasses, row_count: scan.rowCount },
    });
    state.session.pages.sort((a, b) => Number(a.page_number) - Number(b.page_number));
    state.session.current_page = pageNumber;
    const nativeNext = findNextControl(snapshot.pagination);
    const isLastPage = snapshot.paginationState.totalPages
      ? Number(pageNumber) >= Number(snapshot.paginationState.totalPages)
      : Boolean(nativeNext && nextControlDisabled(nativeNext));
    const inferredTotalPages = snapshot.paginationState.totalPages || (isLastPage ? Number(pageNumber) : null);
    state.session.total_pages = inferredTotalPages;
    state.session.total_rows = snapshot.paginationState.totalRows;
    state.session.page_size = snapshot.paginationState.pageSize;
    const everyPageComplete = isLastPage && Core.isEntireCollectionComplete(state.session.pages, inferredTotalPages);
    const status = evaluated.status === 'complete'
      ? (everyPageComplete ? 'all_complete' : 'page_complete')
      : 'needs_review';
    const missingCounts = new Map();
    for (const product of scan.products) {
      for (const field of product.missing_fields || []) missingCounts.set(field, (missingCounts.get(field) || 0) + 1);
    }
    if (missingCounts.size) {
      log('字段', `字段缺失数量：${[...missingCounts.entries()].map(([field, count]) => `${field} ${count} 条`).join('、')}。`);
    } else {
      log('字段', '本页采集字段均有值。');
    }
    setStatus(status, status === 'needs_review'
      ? `本页待检查：${evaluated.reasons.join('；')}`
      : `第 ${pageNumber} 页检查通过，共识别 ${evaluated.uniqueCount} 条商品。`, '核对');
    return { ...evaluated, status, everyPageComplete, pageRecord: state.session.pages.find((page) => Number(page.page_number) === Number(pageNumber)) };
  }

  async function waitForResume() {
    while (state.paused) await new Promise((resolve) => state.pauseWaiters.push(resolve));
  }

  function scopeStillMatches(snapshot) {
    const latest = pageSnapshot();
    if (!latest) return { ok: false, reason: '商品表格或管理页标题已变化' };
    if (latest.scopeId !== snapshot.scopeId) return { ok: false, reason: '筛选条件或采集范围已变化' };
    if (Number(latest.paginationState.currentPage) !== Number(state.targetPage)) return { ok: false, reason: '检测到页面页码被手动切换' };
    return { ok: true, latest };
  }

  async function collectCurrentPage({ recheck = false } = {}) {
    if (state.running) return;
    const snapshot = pageSnapshot();
    if (!snapshot || !snapshot.paginationState.currentPage) {
      state.status = 'needs_review';
      log('识别', '当前页码或商品表格无法可靠识别，请确认页面已加载后重试。');
      render();
      return;
    }
    if (state.session && state.session.scope_id !== snapshot.scopeId) {
      ensureSession(snapshot);
      const restored = await chrome.storage.local.get(state.sessionKey);
      if (restored[state.sessionKey]) state.session = restored[state.sessionKey];
    } else ensureSession(snapshot);
    if (state.session.current_page && Number(state.session.current_page) !== Number(snapshot.paginationState.currentPage) && !recheck) {
      state.status = 'needs_review';
      log('页码', '页面页码与上次采集记录不同；请重新检查当前页，确认后再继续。', { expected_page: state.session.current_page, actual_page: snapshot.paginationState.currentPage });
      render();
      return;
    }
    const pageNumber = snapshot.paginationState.currentPage;
    state.targetPage = pageNumber;
    state.running = true;
    state.paused = false;
    state.status = 'collecting';
    state.session.status = 'collecting';
    if (recheck) log('检查', `重新检查第 ${pageNumber} 页；既有其他页记录会保留。`, { page: pageNumber });
    else log('开始', `开始采集第 ${pageNumber} 页商品。`, { page: pageNumber, expected: snapshot.paginationState.expectedRows });
    render();
    const table = snapshot.table;
    const scrollTarget = detectScrollTarget(table);
    const initialMetrics = scrollMetrics(scrollTarget);
    log('滚动', scrollTarget === document.scrollingElement || scrollTarget === document.documentElement ? '识别到页面滚动区域。' : '识别到表格所在的独立滚动区域。');
    const priorPage = currentPageState(snapshot);
    if (recheck || priorPage) {
      state.session.pages = state.session.pages.filter((page) => Number(page.page_number) !== Number(pageNumber));
    }
    const pageExisting = null;
    const pageMap = new Map();
    let stablePasses = 0;
    let unidentifiedRowsMax = 0;
    let pageEvaluationSaved = false;
    let previousSignature = '';
    let atBottom = false;
    let timedOut = false;
    const startTime = Date.now();
    const timeoutMs = 150000;
    let step = 0;
    try {
      setScroll(scrollTarget, 0);
      await wait(500);
      while (Date.now() - startTime < timeoutMs) {
        await waitForResume();
        const scopeCheck = scopeStillMatches(snapshot);
        if (!scopeCheck.ok) {
          log('中断', `${scopeCheck.reason}；已采集记录已保留。`);
          state.status = 'needs_review';
          break;
        }
        const scan = rowsFor(scopeCheck.latest.table, scopeCheck.latest.headers, pageNumber, snapshot.filters);
        unidentifiedRowsMax = Math.max(unidentifiedRowsMax, scan.unidentifiedRows);
        for (const product of scan.products) pageMap.set(product.product_id, product);
        upsertProducts(scan.products);
        await persist();
        const metrics = scrollMetrics(scrollTarget);
        atBottom = metrics.top + metrics.viewport >= metrics.height - 4;
        const signature = [...pageMap.keys()].sort().join(',') + `|${scan.rowCount}|${metrics.height}|${atBottom}`;
        if (signature === previousSignature && atBottom && scan.pendingImages === 0) stablePasses += 1;
        else stablePasses = 0;
        previousSignature = signature;
        const counted = new Set([...pageMap.keys(), ...(pageExisting?.product_ids || [])]).size;
        state.status = 'collecting';
        render({ pageCount: counted, expected: snapshot.paginationState.expectedRows, pageNumber });
        if (step % 4 === 0) {
          log('采集', `已识别 ${counted}${snapshot.paginationState.expectedRows ? ` / ${snapshot.paginationState.expectedRows}` : ''} 条商品，正在等待图片和页面内容稳定。`, { page: pageNumber, count: counted });
        }
        if (atBottom && stablePasses >= 2 && scan.pendingImages === 0) {
          const finalScan = rowsFor(scopeCheck.latest.table, scopeCheck.latest.headers, pageNumber, snapshot.filters);
          for (const product of finalScan.products) pageMap.set(product.product_id, product);
          upsertProducts(finalScan.products);
          const aggregated = [...pageMap.values()];
          const result = recordPage(scopeCheck.latest, {
            ...finalScan,
            products: aggregated,
            pendingImages: aggregated.filter((product) => product.main_image.load_status === 'loading').length,
            failedImages: aggregated.filter((product) => product.main_image.load_status === 'failed').length,
            unidentifiedRows: unidentifiedRowsMax,
            missingCriticalRecords: Core.countIncompleteProducts(aggregated),
          }, stablePasses, true, false);
          pageEvaluationSaved = true;
          if (result.status !== 'needs_review') log('完成', `第 ${pageNumber} 页采集并通过数量核对。`, { page: pageNumber, count: result.uniqueCount });
          break;
        }
        if (atBottom && scan.pendingImages > 0) await wait(1200);
        else {
          const nextTop = Math.min(metrics.top + Math.max(240, Math.floor(metrics.viewport * 0.72)), Math.max(0, metrics.height - metrics.viewport));
          if (nextTop <= metrics.top + 2) await wait(850);
          else { setScroll(scrollTarget, nextTop); await wait(520); }
        }
        step += 1;
        if (step > 160) { timedOut = true; break; }
      }
      if (Date.now() - startTime >= timeoutMs || step > 160) timedOut = true;
      if (state.status === 'collecting' && (timedOut || stablePasses < 2)) {
        const latest = pageSnapshot();
        const scan = latest ? rowsFor(latest.table, latest.headers, pageNumber, snapshot.filters) : { products: [...pageMap.values()], rowCount: 0, pendingImages: 0, failedImages: 0, unidentifiedRows: 0 };
        for (const product of scan.products) pageMap.set(product.product_id, product);
        upsertProducts(scan.products);
        recordPage(latest || snapshot, { ...scan, products: [...pageMap.values()], unidentifiedRows: unidentifiedRowsMax }, stablePasses, atBottom, timedOut);
        pageEvaluationSaved = true;
      } else if (state.status === 'needs_review' && !pageEvaluationSaved) {
        const preserved = [...pageMap.values()];
        recordPage(snapshot, {
          products: preserved,
          rowCount: 0,
          pendingImages: preserved.filter((product) => product.main_image.load_status === 'loading').length,
          failedImages: preserved.filter((product) => product.main_image.load_status === 'failed').length,
          unidentifiedRows: unidentifiedRowsMax,
        }, stablePasses, false, false);
      }
      if (state.status === 'collecting') state.status = 'needs_review';
      await persist();
      render();
    } catch (error) {
      state.status = 'error';
      log('失败', `采集停止：${safeError(error)}；已采集数据已保留。`, { page: pageNumber });
    } finally {
      state.running = false;
      state.paused = false;
      render();
      await persist();
    }
  }

  function findNextControl(pagination) {
    const candidates = [...pagination.querySelectorAll('button,a,[role="button"],li,[class*="next"]')];
    return candidates.find((element) => /下一页|next/i.test(`${element.getAttribute('aria-label') || ''} ${element.getAttribute('title') || ''} ${textOf(element)}`))
      || pagination.querySelector('.core-pagination-item-next, [class*="pagination-item-next"]');
  }

  function nextControlDisabled(control) {
    return !control || control.getAttribute('aria-disabled') === 'true' || control.hasAttribute('disabled')
      || control.classList.contains('core-pagination-item-disabled') || control.className.toString().includes('item-disabled');
  }

  async function goToNextPage() {
    if (state.running || state.status === 'paging' || !state.session) return;
    const snapshot = pageSnapshot();
    const current = snapshot?.paginationState.currentPage;
    const completed = currentPageState(snapshot || {});
    if (!snapshot || !completed || completed.status !== 'complete' || !current) {
      state.status = 'needs_review';
      log('翻页', '当前页尚未通过完整性检查；请先重新检查本页。');
      render();
      return;
    }
    if (snapshot.paginationState.totalPages && current >= snapshot.paginationState.totalPages) {
      state.status = 'all_complete';
      log('完成', '已到最后一页，全部分页均已采集。');
      render();
      return;
    }
    const next = findNextControl(snapshot.pagination);
    const disabled = nextControlDisabled(next);
    if (disabled) {
      state.status = 'error';
      log('翻页', '未找到可用的原生下一页控件；已有数据已保留，可重试。');
      render();
      return;
    }
    const beforeIds = [...snapshot.table.querySelectorAll('tbody tr')].map((row) => Core.parseProductIdentity(textOf(row)).productId).filter(Boolean).join('|');
    const oldPage = current;
    state.status = 'paging';
    log('翻页', `按你的操作点击原生下一页，等待第 ${oldPage + 1} 页加载。`, { from_page: oldPage });
    render();
    next.click();
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      await wait(400);
      const latest = pageSnapshot();
      if (!latest || latest.scopeId !== snapshot.scopeId) continue;
      const ids = [...latest.table.querySelectorAll('tbody tr')].map((row) => Core.parseProductIdentity(textOf(row)).productId).filter(Boolean).join('|');
      if (Number(latest.paginationState.currentPage) === Number(oldPage) + 1 && ids && ids !== beforeIds) {
        state.status = 'idle';
        state.session.current_page = latest.paginationState.currentPage;
        log('翻页', `已确认切换到第 ${latest.paginationState.currentPage} 页，开始采集该页。`, { page: latest.paginationState.currentPage });
        render();
        await persist();
        void collectCurrentPage();
        return;
      }
    }
    state.status = 'error';
    log('翻页', '点击后未能确认页码和商品列表都已更新；保留已有数据，可稍后重试。', { from_page: oldPage });
    render();
    await persist();
  }

  function exportData() {
    if (!state.session) return;
    const pages = [...state.session.pages].sort((a, b) => a.page_number - b.page_number);
    const complete = Core.isEntireCollectionComplete(pages, state.session.total_pages);
    const payload = {
      schema_version: state.session.schema_version,
      export_status: complete ? 'complete' : 'partial',
      exported_at: new Date().toISOString(),
      collection: {
        scope_id: state.session.scope_id,
        source_page: state.session.scope,
        created_at: state.session.created_at,
        updated_at: state.session.updated_at,
        status: state.status,
        current_page: state.session.current_page,
        total_pages: state.session.total_pages,
        expected_total_products: state.session.total_rows,
        page_size: state.session.page_size,
        unique_product_count: Object.keys(state.session.products).length,
        completed: complete,
        pages,
      },
      products: Object.values(state.session.products),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `storesnapper-tiktok-products-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    log('导出', `已导出 ${payload.products.length} 条商品记录；状态：${complete ? '完整' : '部分数据'}。`, { count: payload.products.length, partial: !complete });
  }

  function button(label, action, id, className = '') {
    const element = document.createElement('button');
    element.type = 'button';
    element.textContent = label;
    element.dataset.action = id;
    element.className = className;
    element.addEventListener('click', action);
    return element;
  }

  function ensureUi() {
    if (state.host?.isConnected) return;
    state.host = document.createElement('div');
    state.host.id = 'storesnapper-tiktok-collector';
    state.host.style.cssText = 'all:initial;position:fixed;z-index:2147483000;right:20px;top:180px;';
    state.shadow = state.host.attachShadow({ mode: 'closed' });
    document.documentElement.append(state.host);
    render();
  }

  function render(progress = {}) {
    if (!state.shadow) return;
    const expanded = state.shadow.querySelector('.panel')?.classList.contains('expanded') || false;
    const minimized = state.shadow.querySelector('.panel')?.classList.contains('minimized') || false;
    const snapshot = pageSnapshot();
    const page = snapshot?.paginationState;
    const nativeNext = snapshot ? findNextControl(snapshot.pagination) : null;
    const nativeNextDisabled = nativeNext ? nextControlDisabled(nativeNext) : false;
    const products = state.session?.products || {};
    const scopeMismatch = Boolean(snapshot && state.session && snapshot.scopeId !== state.session.scope_id);
    const currentPage = page?.currentPage || (scopeMismatch ? null : state.session?.current_page) || '—';
    const activePage = scopeMismatch ? null : state.session?.pages?.find((item) => Number(item.page_number) === Number(currentPage));
    const pageCount = progress.pageCount ?? activePage?.unique_products ?? 0;
    const expected = progress.expected ?? activePage?.expected_products ?? page?.expectedRows;
    const cumulative = Object.keys(products).length;
    const statusLabels = {
      idle: '尚未开始', collecting: '采集中', checking: '检查中', paused: '已暂停', interrupted: '上次中断',
      needs_review: '待检查', page_complete: '本页完成', all_complete: '全部完成', paging: '正在翻页', error: '失败',
    };
    const stateOverrides = ['collecting', 'checking', 'paused', 'paging', 'error', 'needs_review', 'interrupted'];
    const effectiveStatus = stateOverrides.includes(state.status) ? state.status
      : activePage?.status === 'needs_review' ? 'needs_review'
        : activePage?.status === 'complete' ? (Core.isEntireCollectionComplete(state.session?.pages, page?.totalPages || state.session?.total_pages) ? 'all_complete' : 'page_complete')
          : !scopeMismatch && page?.currentPage && !activePage ? 'idle' : state.status;
    const statusLabel = page?.totalRows === 0 ? '当前筛选没有商品'
      : scopeMismatch ? '筛选范围已变化'
        : !page?.currentPage ? '无法确认当前页码'
          : (activePage || !state.session || !['idle', 'page_complete', 'all_complete'].includes(effectiveStatus)
            ? statusLabels[effectiveStatus]
            : '尚未采集当前页') || statusLabels.idle;
    const nextIsLast = !scopeMismatch && activePage?.status === 'complete'
      && (page?.totalPages ? page.currentPage >= page.totalPages : nativeNextDisabled);
    const canNext = !scopeMismatch && state.status !== 'paging' && activePage?.status === 'complete' && Boolean(nativeNext) && !nativeNextDisabled
      && page?.currentPage && (!page.totalPages || page.currentPage < page.totalPages) && !state.running;
    state.shadow.innerHTML = '';
    const style = document.createElement('style');
    style.textContent = `
      :host{all:initial;font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#24312e}
      *{box-sizing:border-box}button{font:inherit;cursor:pointer}button:disabled{cursor:not-allowed;opacity:.48}
      .launcher{border:0;border-radius:20px;background:#087e78;color:#fff;padding:10px 14px;box-shadow:0 4px 18px #172b2a33;font-weight:650}
      .panel{display:none;width:360px;max-height:min(680px,calc(100vh - 32px));background:#fff;border:1px solid #dce4e2;border-radius:12px;box-shadow:0 12px 36px #0b201d35;overflow:hidden}
      .panel.expanded{display:flex;flex-direction:column}.panel.expanded.minimized{max-height:none;overflow:visible}.panel.expanded.minimized .body{display:none}.head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid #edf0ef;background:#fbfcfc}
      .title{font-size:14px;font-weight:700}.sub{font-size:11px;color:#72807c;margin-top:2px}.head-actions{display:flex;gap:5px}.icon{border:1px solid #dce4e2;background:#fff;border-radius:7px;min-width:30px;height:30px;color:#52615d}
      .body{padding:12px 14px;overflow:auto}.summary{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px}.metric{border:1px solid #edf0ef;border-radius:8px;padding:8px 9px}.metric span{display:block;font-size:11px;color:#788580}.metric strong{font-size:15px}.status{margin:0 0 10px;padding:8px 10px;border-radius:8px;background:#f2f6f5;color:#41514d}.status[data-kind="needs_review"],.status[data-kind="error"]{background:#fff4e8;color:#865211}.status[data-kind="all_complete"],.status[data-kind="page_complete"]{background:#eaf6f0;color:#216b48}
      .actions{display:grid;grid-template-columns:1fr 1fr;gap:7px}.action{border:1px solid #d5e1de;background:#fff;color:#28544e;border-radius:8px;padding:8px}.primary{background:#087e78;border-color:#087e78;color:#fff}.wide{grid-column:1/-1}.hint{font-size:11px;color:#7a8581;margin:9px 0 0}
      details{margin-top:11px;border-top:1px solid #edf0ef;padding-top:8px}summary{cursor:pointer;font-weight:600;color:#53625d}.logbar{display:flex;gap:6px;margin:7px 0}.logbar button{border:1px solid #dce4e2;background:#fff;border-radius:6px;padding:4px 8px;font-size:11px}.logs{max-height:150px;overflow:auto;font:10px/1.45 ui-monospace,Consolas,monospace;color:#66736f;white-space:pre-wrap}
      @media(max-width:420px){.panel{width:min(360px,calc(100vw - 24px))}}
    `;
    state.shadow.append(style);
    const launcher = button('商品采集', () => { state.shadow.querySelector('.panel')?.classList.add('expanded'); render(); }, 'open', 'launcher');
    launcher.style.display = expanded ? 'none' : '';
    launcher.setAttribute('aria-label', '打开 TikTok 商品管理采集');
    state.shadow.append(launcher);
    const panel = document.createElement('section');
    panel.className = `panel${expanded ? ' expanded' : ''}${minimized ? ' minimized' : ''}`;
    panel.setAttribute('aria-label', 'TikTok 商品管理采集');
    const head = document.createElement('header');
    head.className = 'head';
    const heading = document.createElement('div');
    heading.innerHTML = '<div class="title">TikTok 商品管理采集</div><div class="sub">仅采集当前商品管理页</div>';
    const headActions = document.createElement('div');
    headActions.className = 'head-actions';
    const minimize = button(minimized ? '+' : '−', () => { state.shadow.querySelector('.panel')?.classList.toggle('minimized'); render(); }, 'collapse', 'icon');
    minimize.setAttribute('aria-label', minimized ? '展开采集面板' : '收起采集面板');
    headActions.append(minimize);
    headActions.append(button('×', () => { state.shadow.querySelector('.panel')?.classList.remove('expanded'); render(); }, 'close', 'icon'));
    head.append(heading, headActions);
    panel.append(head);
    const body = document.createElement('div');
    body.className = 'body';
    const status = document.createElement('div');
    status.className = 'status';
    status.dataset.kind = scopeMismatch ? 'needs_review' : effectiveStatus;
    status.textContent = `状态：${statusLabel}`;
    const summary = document.createElement('div');
    summary.className = 'summary';
    summary.innerHTML = `<div class="metric"><span>当前页 / 总页数</span><strong>${currentPage} / ${page?.totalPages ?? state.session?.total_pages ?? '—'}</strong></div><div class="metric"><span>本页 / 预计商品</span><strong>${pageCount} / ${expected ?? '—'}</strong></div><div class="metric"><span>已采集商品</span><strong>${cumulative}</strong></div><div class="metric"><span>筛选范围</span><strong>${snapshot?.filters?.length ? '已记录' : '当前列表'}</strong></div>`;
    const actions = document.createElement('div');
    actions.className = 'actions';
    const mainLabel = scopeMismatch ? '开始采集本页'
      : activePage || ['needs_review', 'interrupted', 'error'].includes(state.status) ? '重新检查本页' : '开始采集本页';
    const mainButton = button(mainLabel, () => void collectCurrentPage({ recheck: mainLabel === '重新检查本页' }), 'start', 'action primary');
    mainButton.disabled = state.running || state.status === 'paging' || !snapshot || !page?.currentPage || page?.totalRows === 0;
    actions.append(mainButton);
    const pause = button(state.paused ? '继续' : '暂停', () => {
      if (state.paused) {
        state.paused = false;
        for (const resume of state.pauseWaiters.splice(0)) resume();
        state.status = 'collecting';
        log('暂停', '继续采集当前页。');
      } else {
        state.paused = true;
        state.status = 'paused';
        log('暂停', '采集已暂停，已取得的记录已保存。');
      }
      render();
    }, 'pause', 'action');
    pause.disabled = !state.running && !state.paused;
    actions.append(pause);
    const nextButton = button(nextIsLast ? '已是最后一页' : nativeNext ? '采集下一页' : '下一页控件不可用', () => void goToNextPage(), 'next', 'action wide');
    nextButton.disabled = !canNext;
    actions.append(nextButton);
    const exportButton = button('导出 JSON', exportData, 'export', 'action wide');
    exportButton.disabled = cumulative === 0;
    actions.append(exportButton);
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = scopeMismatch
      ? '当前筛选与已保存数据不同；两组记录不会混合。点击“开始采集本页”切换到当前范围。'
      : page?.totalRows === 0
        ? '当前列表没有商品可采集。'
        : '数量或主图未核实完整时会标为“待检查”；导出会保留已有数据并标记部分状态。';
    body.append(status, summary, actions, hint);
    const details = document.createElement('details');
    details.innerHTML = '<summary>运行日志</summary><div class="logbar"></div><div class="logs"></div>';
    const logbar = details.querySelector('.logbar');
    logbar.append(button('复制脱敏日志', async () => {
      const lines = state.logs.map((item) => `${item.at} [${item.step}] ${item.message}`);
      try { await navigator.clipboard.writeText(lines.join('\n')); log('日志', '已复制脱敏日志。'); }
      catch { log('日志', '复制失败，可展开日志后手动选择。'); }
    }, 'copy-log'));
    const logContent = details.querySelector('.logs');
    logContent.textContent = state.logs.map((item) => `${item.at.slice(11, 19)} [${item.step}] ${item.message}`).join('\n') || '暂无记录';
    body.append(details);
    panel.append(body);
    state.shadow.append(panel);
  }

  function scheduleRecognition() {
    clearTimeout(state.mutationTimer);
    state.mutationTimer = setTimeout(async () => {
      if (!isTargetPage()) {
        if (state.host) state.host.remove();
        state.host = null;
        state.shadow = null;
        state.mode = '未识别';
        return;
      }
      state.mode = 'TikTok 商品管理采集';
      ensureUi();
      if (!state.restoreDone) await restore();
      else if (state.session && state.lastScope !== pageSnapshot()?.scopeId && !state.running) {
        state.status = 'needs_review';
        log('范围', '筛选条件可能已变化。此前数据已保留；请导出或在新范围重新开始。');
      }
      render();
    }, 350);
  }

  const observer = new MutationObserver(scheduleRecognition);
  observer.observe(document.documentElement, { subtree: true, childList: true });
  window.addEventListener('popstate', scheduleRecognition);
  window.addEventListener('pageshow', scheduleRecognition);
  scheduleRecognition();
})();
