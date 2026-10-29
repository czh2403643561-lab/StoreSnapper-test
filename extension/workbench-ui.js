(() => {
  const PREF_KEY = 'storesnapper_workbench_prefs_v1';
  const PAGE_IDS = ['home', 'temu', 'tiktok', 'exports', 'logs', 'settings'];
  const LABELS = {
    home: '工作台', temu: 'Temu 找货', tiktok: 'TikTok 采集',
    exports: '导出中心', logs: '运行日志', settings: '设置',
  };
  const ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V21h13V9.5M9 21v-7h6v7"/>',
    temu: '<path d="M4 7h16l-1.5 14h-13L4 7Z"/><path d="M8 7a4 4 0 0 1 8 0M9 12v4m6-4v4"/>',
    tiktok: '<path d="M14 3v11.5a4.5 4.5 0 1 1-4-4.47"/><path d="M14 3c.7 3.2 2.7 5 6 5"/>',
    exports: '<path d="M12 3v12m-5-5 5 5 5-5"/><path d="M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
    logs: '<path d="M7 3h8l4 4v14H7z"/><path d="M15 3v5h4M10 12h6m-6 4h6"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="m19 13.5 1.2 1-.9 1.6-1.5-.4a7 7 0 0 1-1.4.8l-.3 1.6h-2l-.5-1.5a7 7 0 0 1-1.6 0l-.7 1.4-1.8-.7.1-1.6a7 7 0 0 1-1.1-1.1l-1.6.1-.7-1.8 1.4-.8a7 7 0 0 1 0-1.6l-1.4-.7.6-1.9 1.6.1a7 7 0 0 1 1.2-1.1l-.1-1.6 1.8-.7.8 1.4a7 7 0 0 1 1.6-.1l.6-1.5 1.9.6-.1 1.6a7 7 0 0 1 1.1 1.2l1.6-.1.7 1.8-1.4.8a7 7 0 0 1 0 1.6Z"/>',
  };

  function mount(shadow, options = {}) {
    if (!shadow || shadow.querySelector('[data-storesnapper-workbench]')) return shadow?.__storeSnapperWorkbench;
    const state = {
      activeMode: options.activeMode || 'unknown',
      activePage: options.activeMode === 'temu' || options.activeMode === 'tiktok' ? options.activeMode : 'home',
      expanded: options.expanded !== false,
      prefsLoaded: false,
      userNavigated: false,
      compact: false,
      rememberLastView: true,
      logs: [],
      summary: { status: '待命', detail: '选择一个工作模式开始使用。' },
      pages: new Map(),
      onClose: options.onClose || (() => {}),
      getLogs: options.getLogs || (() => []),
      getSummary: options.getSummary || (() => state.summary),
    };
    const frame = document.createElement('div');
    frame.dataset.storesnapperWorkbench = 'true';
    frame.innerHTML = `
      <style>
        :host{all:initial}*{box-sizing:border-box}button{font:inherit}
        .workbench{position:fixed;z-index:2147483001;right:12px;top:12px;bottom:12px;display:flex;align-items:stretch;gap:8px;width:min(500px,calc(100vw - 24px));pointer-events:none;color:#20312f;font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif}
        .main{display:flex;min-width:0;flex:1;flex-direction:column;overflow:hidden;border:1px solid #dce6e3;border-radius:16px;background:#fff;box-shadow:0 12px 40px #0b282530;pointer-events:auto;transition:width .16s ease,opacity .16s ease}
        .workbench.closed .main,.workbench.minimized .main{display:none}
        .brand{display:flex;align-items:center;gap:10px;min-height:62px;padding:10px 12px;border-bottom:1px solid #e9efed;background:#fff}
        .brand img{width:34px;height:34px;object-fit:contain;border-radius:9px}.brand-copy{min-width:0;flex:1}.brand-name{font-size:15px;font-weight:750;letter-spacing:-.2px}.brand-tagline{font-size:11px;color:#81908b}
        .head-actions{display:flex;gap:6px}.head-actions button,.launcher{width:32px;height:32px;border:1px solid #dce5e2;border-radius:8px;background:#fff;color:#53635e;cursor:pointer;font-size:17px}.head-actions button:hover,.launcher:hover{background:#f1f7f5}
        .page-content{min-height:0;flex:1;overflow:auto;overscroll-behavior:contain}.wb-page{display:none;min-height:100%;padding:14px}.wb-page.active{display:block}.wb-page[data-slot]{height:100%;padding:0;overflow:hidden}.wb-title{margin:0 0 4px;font-size:17px;font-weight:720}.wb-subtitle{margin:0 0 14px;color:#778580;font-size:11px}
        .rail{display:flex;width:66px;flex:0 0 66px;flex-direction:column;align-items:stretch;gap:3px;padding:8px 5px;border:1px solid #dce6e3;border-radius:15px;background:#fff;box-shadow:0 8px 28px #0b28251c;pointer-events:auto}
        .workbench.closed .rail{display:none}.rail-brand{display:grid;place-items:center;height:45px;margin-bottom:4px}.rail-brand img{width:35px;height:35px;object-fit:contain;border-radius:10px}
        .nav{display:grid;gap:4px}.nav button{display:grid;justify-items:center;align-content:center;gap:3px;min-height:54px;padding:4px 1px;border:0;border-radius:9px;background:transparent;color:#61716c;cursor:pointer;font-size:10px}.nav svg{width:21px;height:21px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}.nav button:hover{background:#f2f7f6}.nav button[aria-current="page"]{color:#087e78;background:#ddf4f0;font-weight:700}.rail-bottom{margin-top:auto}.launcher{display:none;position:fixed;z-index:2147483002;right:16px;top:20px;width:auto;height:auto;padding:8px 12px;border:0;border-radius:22px;background:#087e78;color:#fff;box-shadow:0 4px 18px #102c2933;font-size:12px;font-weight:700;pointer-events:auto}.workbench.closed~.launcher{display:block}
        .cards{display:grid;grid-template-columns:1fr 1fr;gap:9px}.tile,.session{padding:12px;border:1px solid #e5edeb;border-radius:11px;background:#fff}.tile strong{display:block;margin-top:5px;font-size:15px}.tile span,.muted{color:#7b8985;font-size:11px}.quick{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.wb-button{min-height:34px;padding:7px 10px;border:1px solid #cdded9;border-radius:8px;background:#fff;color:#14645b;cursor:pointer;font-weight:650}.wb-button:hover{background:#f1f8f6}.wb-button.primary{border-color:#07867d;background:#07867d;color:#fff}.wb-button:disabled{opacity:.5;cursor:not-allowed}.session-list,.log-list{display:grid;gap:8px}.session-head{display:flex;align-items:center;justify-content:space-between;gap:8px}.session strong{font-size:12px}.session p{margin:5px 0;color:#778580;font-size:11px}.log-list{max-height:calc(100vh - 180px);overflow:auto}.log-entry{padding:8px 9px;border:1px solid #e8eeec;border-radius:8px;color:#586864;font:11px/1.45 ui-monospace,Consolas,monospace;overflow-wrap:anywhere}.log-entry time{display:block;color:#97a29f;font:10px sans-serif;margin-bottom:3px}.setting{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:12px 0;border-bottom:1px solid #edf1f0}.setting strong{display:block}.setting input{width:17px;height:17px;accent-color:#07867d}.notice{padding:11px;border-radius:9px;background:#f1f6f5;color:#5c6c67}.error{background:#fff5e9;color:#885c21}.compact .wb-page{padding:10px}.compact .nav button{min-height:48px}.inactive{display:grid;gap:8px;padding:14px;border:1px dashed #cbd8d4;border-radius:10px;color:#5e6c68}.inactive a{color:#087e78;font-weight:650}
        @media(max-width:520px){.workbench{right:6px;top:6px;bottom:6px;width:calc(100vw - 12px);gap:5px}.rail{width:60px;flex-basis:60px}.rail button{font-size:9px}}
      </style>
      <section class="workbench" aria-label="StoreSnapper 工作台">
        <main class="main"><header class="brand"><img alt=""/><div class="brand-copy"><div class="brand-name">StoreSnapper</div><div class="brand-tagline">让跨境选品与采集更简单</div></div><div class="head-actions"><button type="button" data-action="minimize" aria-label="收起工作台" title="收起">−</button><button type="button" data-action="close" aria-label="关闭工作台" title="关闭">×</button></div></header><div class="page-content"></div></main>
        <aside class="rail" aria-label="工作台导航"><div class="rail-brand"><img alt="StoreSnapper"/></div><nav class="nav"></nav></aside>
      </section><button class="launcher" type="button">StoreSnapper</button>`;
    shadow.append(frame);
    const shell = frame.querySelector('.workbench');
    const pageContent = frame.querySelector('.page-content');
    const nav = frame.querySelector('.nav');
    const logo = chrome.runtime.getURL('assets/storesnapper-48.png');
    frame.querySelectorAll('img').forEach((img) => { img.src = logo; });
    const pageNames = { home: '工作台', temu: 'Temu 找货', tiktok: 'TikTok 采集', exports: '导出中心', logs: '运行日志', settings: '设置' };
    for (const id of PAGE_IDS) {
      const button = document.createElement('button');
      button.type = 'button'; button.dataset.page = id; button.title = pageNames[id]; button.setAttribute('aria-label', pageNames[id]);
      button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[id]}</svg><span>${pageNames[id]}</span>`;
      button.addEventListener('click', () => { api.setPage(id); api.setExpanded(true); });
      nav.append(button);
    }
    for (const id of PAGE_IDS) {
      const page = document.createElement('section'); page.className = 'wb-page'; page.dataset.page = id;
      pageContent.append(page); state.pages.set(id, page);
    }
    const home = state.pages.get('home');
    home.innerHTML = '<h1 class="wb-title">工作台</h1><p class="wb-subtitle">当前页面可用的 StoreSnapper 工具</p><div class="cards summary-cards"></div><div class="quick"></div><p class="notice home-note"></p>';
    const quick = home.querySelector('.quick');
    for (const id of ['temu', 'tiktok', 'exports']) {
      const button = document.createElement('button'); button.className = 'wb-button'; button.type = 'button'; button.textContent = pageNames[id]; button.addEventListener('click', () => api.setPage(id)); quick.append(button);
    }
    const exports = state.pages.get('exports');
    exports.innerHTML = '<h1 class="wb-title">导出中心</h1><p class="wb-subtitle">仅展示本机扩展存储中已有的采集记录</p><div class="session-list"></div>';
    const logs = state.pages.get('logs');
    logs.innerHTML = '<h1 class="wb-title">运行日志</h1><p class="wb-subtitle">仅显示已有的实际操作记录</p><div class="quick"><button class="wb-button" data-copy-logs type="button">复制脱敏日志</button></div><div class="log-list"></div>';
    const settings = state.pages.get('settings');
    settings.innerHTML = '<h1 class="wb-title">设置</h1><p class="wb-subtitle">设置保存在本机 Chrome 扩展存储中</p><label class="setting"><span><strong>记住上次打开的页面</strong><span class="muted">重新打开工作台时恢复导航页面</span></span><input type="checkbox" data-pref="rememberLastView"/></label><label class="setting"><span><strong>紧凑显示</strong><span class="muted">减少导航与内容留白</span></span><input type="checkbox" data-pref="compactMode"/></label><p class="notice settings-note">仅影响本机工作台显示，不会改变采集或搜图行为。</p>';
    frame.querySelector('[data-action="minimize"]').addEventListener('click', () => { shell.classList.toggle('minimized'); });
    frame.querySelector('[data-action="close"]').addEventListener('click', () => { state.onClose(); shell.classList.add('closed'); });
    frame.querySelector('.launcher').addEventListener('click', () => { shell.classList.remove('closed', 'minimized'); });
    settings.querySelectorAll('input').forEach((input) => input.addEventListener('change', () => {
      state[input.dataset.pref] = input.checked;
      shell.classList.toggle('compact', state.compactMode);
      persistPrefs();
    }));
    frame.querySelector('[data-copy-logs]').addEventListener('click', async () => {
      const lines = collectLogs().map((item) => `${item.at || ''} [${item.step || item.source || '运行'}] ${item.message || ''}`);
      const button = frame.querySelector('[data-copy-logs]');
      try { await navigator.clipboard.writeText(lines.join('\n')); button.textContent = '已复制'; }
      catch { button.textContent = '复制失败'; }
    });

    function persistPrefs() {
      if (!chrome?.storage?.local || !state.prefsLoaded) return;
      const prefs = { rememberLastView: state.rememberLastView, compactMode: Boolean(state.compactMode), lastPage: state.activePage };
      void chrome.storage.local.set({ [PREF_KEY]: prefs });
    }
    function collectLogs() {
      const provided = state.getLogs?.() || [];
      return [...state.logs, ...provided].sort((a, b) => String(a.at || '').localeCompare(String(b.at || ''))).slice(-160);
    }
    function renderHome() {
      const summary = state.getSummary?.() || state.summary;
      const cards = home.querySelector('.summary-cards'); cards.replaceChildren();
      for (const [label, value] of [['当前模式', summary.mode || '待命'], ['状态', summary.status || '待命'], ['信息', summary.detail || '']]) {
        const tile = document.createElement('div'); tile.className = 'tile'; const name = document.createElement('span'); name.textContent = label; const strong = document.createElement('strong'); strong.textContent = value; tile.append(name, strong); cards.append(tile);
      }
      home.querySelector('.home-note').textContent = summary.note || '采集下一页需由你手动点击；工作台不会自动翻页。';
    }
    function renderLogs() {
      const list = logs.querySelector('.log-list'); list.replaceChildren();
      const entries = collectLogs();
      if (!entries.length) { const empty = document.createElement('p'); empty.className = 'notice'; empty.textContent = '暂无运行记录。'; list.append(empty); return; }
      for (const item of entries.slice().reverse()) {
        const row = document.createElement('div'); row.className = 'log-entry';
        const date = item.at ? new Date(item.at) : null;
        const time = document.createElement('time'); time.textContent = date && Number.isFinite(date.getTime()) ? date.toLocaleString() : '时间未记录';
        const text = document.createElement('span'); text.textContent = `[${item.step || item.source || '运行'}] ${item.message || ''}`;
        row.append(time, text); list.append(row);
      }
    }
    async function renderExports() {
      const list = exports.querySelector('.session-list'); list.replaceChildren();
      const empty = document.createElement('p'); empty.className = 'notice'; empty.textContent = '正在读取本机采集记录…'; list.append(empty);
      if (!chrome?.storage?.local) return;
      try {
        const all = await chrome.storage.local.get(null);
        const sessions = Object.entries(all).filter(([key, value]) => key.startsWith('storesnapper_tiktok_scope_') && value && Array.isArray(value.pages) && value.products && (value.pages.length || Object.keys(value.products).length)).map(([key, value]) => ({ key, value }));
        list.replaceChildren();
        if (!sessions.length) { empty.textContent = '暂无可导出的 TikTok 采集记录。开始采集后，记录会出现在这里。'; list.append(empty); return; }
        sessions.sort((a, b) => String(b.value.updated_at || '').localeCompare(String(a.value.updated_at || '')));
        for (const { value } of sessions) {
          const card = document.createElement('article'); card.className = 'session';
          const head = document.createElement('div'); head.className = 'session-head'; const title = document.createElement('strong'); title.textContent = `筛选范围：${value.scope_id || '未命名'}`; head.append(title);
          const products = Object.values(value.products || {}); const meta = document.createElement('p'); meta.textContent = `${products.length} 个商品 · ${value.pages.length} 页记录 · 状态：${value.status || '未知'} · 更新于 ${value.updated_at ? new Date(value.updated_at).toLocaleString() : '未知'}`;
          const action = document.createElement('button'); action.type = 'button'; action.className = 'wb-button'; action.textContent = '导出 JSON'; action.disabled = !products.length;
          action.addEventListener('click', () => exportSession(value)); card.append(head, meta, action); list.append(card);
        }
      } catch { list.replaceChildren(); const error = document.createElement('p'); error.className = 'notice error'; error.textContent = '无法读取扩展本机记录。请在扩展管理页检查存储权限后重试。'; list.append(error); }
    }
    function exportSession(session) {
      const pages = [...session.pages].sort((a, b) => a.page_number - b.page_number);
      const complete = Boolean(window.StoreSnapperTikTokCore?.isEntireCollectionComplete(pages, session.total_pages));
      const payload = {
        schema_version: session.schema_version,
        export_status: complete ? 'complete' : 'partial',
        exported_at: new Date().toISOString(),
        collection: {
          scope_id: session.scope_id, source_page: session.scope,
          created_at: session.created_at, updated_at: session.updated_at,
          status: session.status, current_page: session.current_page, total_pages: session.total_pages,
          expected_total_products: session.total_rows, page_size: session.page_size,
          unique_product_count: Object.keys(session.products || {}).length, completed: complete, pages,
        },
        products: Object.values(session.products || {}),
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `storesnapper-tiktok-products-${new Date().toISOString().replace(/[:.]/g, '-')}.json`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      state.logs.push({ at: new Date().toISOString(), step: '导出', message: `从导出中心导出 ${payload.products.length} 条记录；${complete ? '完整' : '部分数据'}` });
    }
    function activate(id, fromUser = false) {
      if (fromUser) state.userNavigated = true;
      const pageId = PAGE_IDS.includes(id) ? id : 'home';
      state.activePage = pageId;
      for (const page of state.pages.values()) page.classList.toggle('active', page.dataset.page === pageId);
      for (const button of nav.querySelectorAll('button')) button.setAttribute('aria-current', button.dataset.page === pageId ? 'page' : 'false');
      if (pageId === 'home') renderHome();
      if (pageId === 'logs') renderLogs();
      if (pageId === 'exports') void renderExports();
      if (state.prefsLoaded && state.rememberLastView) persistPrefs();
    }
    const api = {
      page(id) {
        if (!state.pages.has(id)) return null;
        state.pages.get(id).dataset.slot = 'true';
        return state.pages.get(id);
      },
      setPage(id) { activate(id, true); },
      setExpanded(value) { shell.classList.toggle('minimized', !value); shell.classList.remove('closed'); },
      isExpanded() { return !shell.classList.contains('minimized') && !shell.classList.contains('closed'); },
      setSummary(summary) { state.summary = { ...state.summary, ...summary }; if (state.activePage === 'home') renderHome(); },
      addLog(step, message) { state.logs.push({ at: new Date().toISOString(), step, message: String(message).replace(/https?:\/\/\S+/g, '[链接]') }); state.logs = state.logs.slice(-80); if (state.activePage === 'logs') renderLogs(); },
      setLogsProvider(fn) { state.getLogs = fn; if (state.activePage === 'logs') renderLogs(); },
      setSummaryProvider(fn) { state.getSummary = fn; renderHome(); },
      refreshSummary() { if (state.activePage === 'home') renderHome(); },
      refreshLogs() { if (state.activePage === 'logs') renderLogs(); },
      getActivePage() { return state.activePage; },
    };
    shadow.__storeSnapperWorkbench = api;
    if (!state.expanded) shell.classList.add('minimized');
    frame.querySelector('[data-pref="rememberLastView"]').checked = state.rememberLastView;
    frame.querySelector('[data-pref="compactMode"]').checked = state.compactMode;
    activate(state.activePage);
    if (chrome?.storage?.local) void chrome.storage.local.get(PREF_KEY).then((data) => {
      const prefs = data[PREF_KEY] || {};
      state.rememberLastView = prefs.rememberLastView !== false;
      state.compactMode = Boolean(prefs.compactMode);
      state.prefsLoaded = true;
      frame.querySelector('[data-pref="rememberLastView"]').checked = state.rememberLastView;
      frame.querySelector('[data-pref="compactMode"]').checked = state.compactMode;
      shell.classList.toggle('compact', state.compactMode);
      if (!state.userNavigated && state.rememberLastView && PAGE_IDS.includes(prefs.lastPage)) activate(prefs.lastPage);
    }).catch(() => { state.prefsLoaded = true; });
    return api;
  }

  window.StoreSnapperWorkbenchUI = { mount };
})();
