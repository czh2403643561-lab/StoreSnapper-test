(() => {
  if (location.hostname !== 'seller.eu.tiktokshopglobalselling.com' || !/^\/product\/manage\/?$/.test(location.pathname)) return;
  const KEY = 'storesnapper_tiktok_select_v1';
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const state = { cache: null, targets: [], running: false, stopped: false, message: '', selected: [], missing: [] };
  const scope = () => `${location.origin}${location.pathname}?${new URLSearchParams(location.search).get('shop_region') || ''}:active:${[...document.querySelectorAll('main input:not([type="checkbox"]):not([type="radio"])')].map((input) => input.value).join('|')}`;
  const table = () => [...document.querySelectorAll('main table')].find((node) => node.querySelector('tbody [data-id="product.manage.table.columns.id"]'));
  const total = () => Number((document.querySelector('.core-pagination-total-text')?.textContent || '').match(/[\d,]+/)?.[0]?.replace(/,/g, '') || 0);
  const pageSize = () => Number((document.querySelector('.core-pagination-option')?.textContent || '').match(/\d+/)?.[0] || 0);
  const pageNumber = () => Number(document.querySelector('.core-pagination-item-active,[aria-current="page"]')?.textContent?.match(/\d+/)?.[0] || 1);
  const active = () => location.search.includes('tab=active') && [...document.querySelectorAll('[class*="tab-active"],[class*="header-title-active"]')].some((node) => /在售/.test(node.textContent || ''));
  const rows = () => [...(table()?.querySelectorAll('tbody tr') || [])].map((row) => {
    const id = row.querySelector('[data-id="product.manage.table.columns.id"]')?.textContent?.match(/ID\s*[:：]\s*(\d{8,})/)?.[1];
    const checkbox = row.querySelector('td.core-table-checkbox label.core-checkbox');
    return id && checkbox ? { id, row, checkbox } : null;
  }).filter(Boolean);
  const checked = (label) => Boolean(label.querySelector('input[type="checkbox"]')?.checked || label.classList.contains('core-checkbox-checked') || label.querySelector('.core-checkbox-checked') || label.getAttribute('aria-checked') === 'true');
  const cacheValid = () => Boolean(state.cache?.scope === scope() && state.cache?.total === total() && rows().every(({ id }) => state.cache.pages[id] === pageNumber()));
  const scrollTarget = () => { let node = table(); while (node && node !== document.body) { const style = getComputedStyle(node); if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 8) return node; node = node.parentElement; } return document.scrollingElement; };
  const metrics = (node) => node === document.scrollingElement ? { top: scrollY, height: node.scrollHeight, viewport: innerHeight } : { top: node.scrollTop, height: node.scrollHeight, viewport: node.clientHeight };
  const scrollTo = (node, top) => { if (node === document.scrollingElement) window.scrollTo(0, top); else node.scrollTop = top; };
  const publish = () => void chrome.runtime.sendMessage({ type: 'STOREPANEL_STATE', mode: 'tiktok-select', state: model() }).catch(() => undefined);
  const model = () => ({ recognized: active() && Boolean(table()), running: state.running, message: state.message, total: total(), indexed: state.cache?.ids?.length || 0, cacheValid: cacheValid(), targets: state.targets.length, selected: state.selected, missing: state.missing, page: pageNumber() });
  async function save() { await chrome.storage.local.set({ [KEY]: { cache: state.cache, targets: state.targets } }); publish(); }
  async function restore() { const saved = await chrome.storage.local.get(KEY); state.cache = saved[KEY]?.cache || null; state.targets = saved[KEY]?.targets || []; state.message = cacheValid() ? '索引快速核对通过；勾选前仍会核对本页全部 ID。' : '商品列表需要建立或更新索引。'; publish(); }
  async function scanCurrentPage(wanted) {
    const target = scrollTarget(); if (!target) throw new Error('找不到商品列表滚动区域。');
    const found = new Set(); scrollTo(target, 0); await wait(220);
    const expected = Math.min(pageSize() || 50, Math.max(0, total() - (pageNumber() - 1) * (pageSize() || 50)));
    for (let step = 0; step < 35 && !state.stopped; step += 1) {
      rows().forEach(({ id, checkbox }) => { found.add(id); if (wanted && !wanted.has(id) && checked(checkbox)) throw new Error('发现清单外商品已被勾选；请先核对页面。'); });
      const m = metrics(target); if (found.size >= expected && expected) break;
      if (m.top + m.viewport >= m.height - 3) { await wait(450); rows().forEach(({ id }) => found.add(id)); break; }
      scrollTo(target, Math.min(m.top + Math.max(300, m.viewport * .75), m.height - m.viewport)); await wait(280);
    }
    if (state.stopped) throw new Error('已停止。');
    if (expected && found.size < expected) throw new Error(`本页只识别 ${found.size}/${expected} 件；已停止，未执行勾选。`);
    return [...found];
  }
  function nextButton() { return [...document.querySelectorAll('.core-pagination button,.core-pagination li,.core-pagination [role="button"]')].find((node) => /next|下一页/i.test(`${node.className} ${node.getAttribute('aria-label') || ''} ${node.getAttribute('title') || ''} ${node.textContent || ''}`) && !/disabled/.test(node.className) && node.getAttribute('aria-disabled') !== 'true' && !node.hasAttribute('disabled')); }
  async function goPage(number) {
    const button = [...document.querySelectorAll('.core-pagination-list li,.core-pagination-list button')].find((node) => node.textContent?.trim() === String(number));
    if (!button) throw new Error(`无法定位第 ${number} 页。`);
    const before = rows().map(({ id }) => id).join('|');
    button.click();
    for (let attempt = 0; attempt < 30; attempt += 1) { await wait(200); if (pageNumber() === number && rows().length && rows().map(({ id }) => id).join('|') !== before) return; }
    throw new Error(`第 ${number} 页未加载。`);
  }
  async function indexAll() {
    if (!active()) throw new Error('请先切换到“在售”商品页。');
    if (rows().some(({ checkbox }) => checked(checkbox))) throw new Error('当前已有商品被勾选；请先处理本轮勾选，再更新索引。');
    const count = total(); if (!count) throw new Error('暂未读到在售商品总数。');
    const initialScope = scope();
    const pages = Math.ceil(count / (pageSize() || 50)); if (pages > 12) throw new Error('页数超过单次索引上限，请缩小筛选范围。');
    const originalPage = pageNumber(); if (originalPage !== 1) await goPage(1);
    const indexed = new Map();
    for (let step = 0; step < pages; step += 1) {
      if (scope() !== initialScope || total() !== count) throw new Error('筛选或商品数量变化，索引已停止。');
      const current = pageNumber(); const ids = await scanCurrentPage();
      ids.forEach((id) => indexed.set(id, current)); state.message = `已建立索引 ${indexed.size}/${count} 件`; publish();
      if (step === pages - 1) break;
      const next = nextButton(); if (!next) throw new Error('找不到下一页控件，索引未保存。');
      const before = ids.join('|'); next.click();
      let changed = false;
      for (let attempt = 0; attempt < 30; attempt += 1) { await wait(200); if (pageNumber() !== current && rows().map((r) => r.id).join('|') !== before) { changed = true; break; } }
      if (!changed) throw new Error('翻页后商品未变化，索引未保存。');
    }
    if (indexed.size !== count) throw new Error(`索引 ${indexed.size}/${count} 件不完整，未保存。`);
    state.cache = { scope: initialScope, total: count, ids: [...indexed.keys()], pages: Object.fromEntries(indexed), at: Date.now() };
    state.message = `索引完成：${count} 件。`; await save();
    if (originalPage !== pageNumber()) await goPage(originalPage);
  }
  async function selectPage(limit) {
    if (!active() || !cacheValid()) throw new Error('商品索引需更新。');
    if (!state.targets.length) throw new Error('请先导入商品 ID 清单。');
    const wanted = new Set(state.targets); const beforePage = pageNumber(), currentIds = await scanCurrentPage(wanted);
    const cachedIds = state.cache.ids.filter((id) => state.cache.pages[id] === beforePage);
    if (currentIds.length !== cachedIds.length || currentIds.some((id) => !cachedIds.includes(id))) throw new Error('本页商品与缓存不同，已停止勾选；请更新索引。');
    const matches = currentIds.filter((id) => wanted.has(id));
    if (!matches.length) { state.message = '当前页没有清单中的商品。'; state.missing = state.targets; publish(); return; }
    const target = scrollTarget(); scrollTo(target, 0); await wait(200);
    state.selected = []; const seen = new Set();
    for (let step = 0; step < 35 && state.selected.length < limit && !state.stopped; step += 1) {
      if (pageNumber() !== beforePage || !active() || total() !== state.cache.total) throw new Error('页面已变化，勾选已停止。');
      const present = rows();
      if (present.some(({ id, checkbox }) => !wanted.has(id) && checked(checkbox))) throw new Error('发现清单外商品已被勾选；请先核对页面。');
      for (const item of present) {
        if (!wanted.has(item.id) || seen.has(item.id)) continue;
        seen.add(item.id);
        item.row.scrollIntoView({ block: 'center' }); await wait(80);
        const live = rows().find(({ id }) => id === item.id);
        if (!live) throw new Error(`商品 ${item.id} 滚动后消失，已停止。`);
        if (!checked(live.checkbox)) { live.checkbox.click(); await wait(180); if (!checked(live.checkbox)) throw new Error(`商品 ${item.id} 的勾选状态未确认，已停止。`); }
        state.selected.push(item.id); state.message = `本轮已勾选 ${state.selected.length} 件`; publish();
        if (state.selected.length >= limit || state.stopped) break;
      }
      if (seen.size >= matches.length) break;
      const m = metrics(target); if (m.top + m.viewport >= m.height - 3) break;
      scrollTo(target, Math.min(m.top + Math.max(300, m.viewport * .75), m.height - m.viewport)); await wait(260);
    }
    state.missing = state.targets.filter((id) => !currentIds.includes(id));
    state.message = `本轮勾选 ${state.selected.length} 件；请在 TikTok 后台自行核对并下架。`; publish();
  }
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type !== 'TIKTOK_SELECT_ACTION') return false;
    if (message.action === 'stop') { state.stopped = true; respond({ ok: true, state: model() }); return false; }
    if (message.action === 'get') { void ready.then(() => respond({ ok: true, state: model() })); return true; }
    if (state.running) { respond({ ok: false, error: '当前任务正在运行。' }); return false; }
    void (async () => {
      if (message.action === 'import') { state.targets = [...new Set(message.ids.filter((id) => /^\d{16,22}$/.test(id)))]; state.message = `已导入 ${state.targets.length} 个商品 ID。`; await save(); }
      else if (message.action === 'index' || message.action === 'select') {
        state.running = true; state.stopped = false; publish();
        try { if (message.action === 'index') await indexAll(); else await selectPage(Math.min(50, Math.max(1, Number(message.limit) || 30))); }
        catch (error) { state.message = error.message || '任务中断。'; }
        finally { state.running = false; publish(); }
      }
      respond({ ok: true, state: model() });
    })().catch((error) => respond({ ok: false, error: error.message }));
    return true;
  });
  const ready = restore().catch(() => { state.message = '无法恢复上次的商品索引，请重新建立。'; });
})();
