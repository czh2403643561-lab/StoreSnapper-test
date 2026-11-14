(() => {
  if (!/^\/offer\/\d{8,}\.html$/i.test(location.pathname)) return;

  const IMAGE_HOST = 'cbu01.alicdn.com';
  const MAX_IMAGE_COUNT = 120;
  const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
  let offerId = getOfferId();
  let source;
  let panel;
  let view;
  let busy = false;
  let activeTaskId = '';
  let scanGeneration = 0;

  const root = document.createElement('div');
  root.id = 'storesnapper-1688-detail-collector';
  root.style.cssText = 'all:initial;position:fixed;z-index:2147483647;right:20px;bottom:20px;pointer-events:none;';
  const shadow = root.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>
      :host{all:initial;font-family:Arial,"Microsoft YaHei",sans-serif;color:#20332c}
      *{box-sizing:border-box}
      .panel{width:min(328px,calc(100vw - 32px));padding:16px;border:1px solid #dce8e1;border-radius:14px;background:#fff;box-shadow:0 8px 30px rgba(14,39,29,.2);pointer-events:auto}
      .head{display:flex;align-items:center;gap:9px;margin-bottom:13px}
      .brand{display:grid;place-items:center;width:30px;height:30px;border-radius:9px;background:#e8f4ed;color:#1f7655;font-size:16px;font-weight:700}
      .title{flex:1;font-size:15px;font-weight:700}
      button{font:inherit;cursor:pointer}
      .collapse{width:30px;height:30px;border:0;border-radius:8px;background:#f3f6f4;color:#52665d;font-size:19px;line-height:1}
      .status{display:flex;align-items:center;gap:8px;margin-bottom:9px;color:#397354;font-size:13px;font-weight:600}
      .dot{width:8px;height:8px;border-radius:50%;background:#46a16a;flex:none}
      .dot.warn{background:#d49b2f}.dot.error{background:#c44949}.dot.busy{background:#788a80;animation:pulse 1s infinite alternate}
      @keyframes pulse{to{opacity:.35}}
      .product{margin:0 0 13px;padding:10px;border-radius:9px;background:#f6f8f7}
      .product-title{display:-webkit-box;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:2;color:#34483f;font-size:12px;line-height:1.5;overflow-wrap:anywhere}
      .id{margin-top:4px;color:#85928b;font-size:11px}
      .counts{margin:0 0 12px;color:#687a70;font-size:11px}
      .progress{height:5px;margin:0 0 9px;overflow:hidden;border-radius:99px;background:#e8eeea}
      .bar{height:100%;width:0;background:#31835d;transition:width .18s ease}
      .message{min-height:17px;margin:0 0 11px;color:#718077;font-size:11px;line-height:1.5}
      .message.error{color:#a73737}.message.warn{color:#996e13}
      .primary{width:100%;height:39px;border:0;border-radius:9px;background:#247d58;color:#fff;font-size:13px;font-weight:700}
      .primary:hover:not(:disabled){background:#1b6848}.primary:disabled{cursor:wait;opacity:.55}
      .mini{position:fixed;right:20px;bottom:20px;display:grid;place-items:center;width:48px;height:48px;border:1px solid #cfe2d6;border-radius:50%;background:#fff;color:#1f7655;box-shadow:0 4px 18px rgba(14,39,29,.2);font-size:18px;font-weight:700;pointer-events:auto}
    </style>
    <section class="panel" role="region" aria-label="1688 商品采集">
      <header class="head"><span class="brand" aria-hidden="true">S</span><span class="title">1688 商品采集</span><button class="collapse" type="button" aria-label="收起面板" title="收起">−</button></header>
      <div class="status"><span class="dot busy"></span><span class="status-text">正在识别商品…</span></div>
      <div class="product"><div class="product-title"></div><div class="id"></div></div>
      <div class="counts"></div>
      <div class="progress" aria-hidden="true"><div class="bar"></div></div>
      <p class="message" aria-live="polite"></p>
      <button class="primary" type="button" disabled>正在识别…</button>
    </section>
    <button class="mini" type="button" aria-label="展开 1688 商品采集" title="展开" hidden>S</button>`;
  document.documentElement.append(root);
  panel = shadow.querySelector('.panel');
  view = {
    dot: shadow.querySelector('.dot'),
    status: shadow.querySelector('.status-text'),
    title: shadow.querySelector('.product-title'),
    id: shadow.querySelector('.id'),
    counts: shadow.querySelector('.counts'),
    bar: shadow.querySelector('.bar'),
    message: shadow.querySelector('.message'),
    button: shadow.querySelector('.primary'),
    mini: shadow.querySelector('.mini'),
  };
  shadow.querySelector('.collapse').addEventListener('click', () => setCollapsed(true));
  view.mini.addEventListener('click', () => setCollapsed(false));
  view.button.addEventListener('click', () => {
    if (busy) return;
    if (!source) void recognize();
    else void collectAndDownload();
  });
  void recognize();

  window.addEventListener('popstate', checkRoute);
  window.addEventListener('hashchange', checkRoute);
  let lastHref = location.href;
  window.setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      checkRoute();
    }
  }, 800);

  async function recognize() {
    const generation = ++scanGeneration;
    setUi({ phase: 'detecting', message: '', percent: 0 });
    for (let attempt = 0; attempt < 10 && generation === scanGeneration; attempt += 1) {
      const response = await chrome.runtime.sendMessage({ type: 'READ_1688_DETAIL_SOURCE', offerId }).catch(() => undefined);
      if (generation !== scanGeneration) return;
      if (response?.ok && response.result?.title) {
        source = response.result;
        setUi({ phase: 'ready', message: '', percent: 0 });
        return;
      }
      if (attempt < 9) await new Promise((resolve) => setTimeout(resolve, 700));
    }
    setUi({ phase: 'failed', message: '暂未读取到商品信息，可稍后重试。', percent: 0 });
  }

  async function collectAndDownload() {
    if (!source || busy || !offerId) return;
    busy = true;
    const taskId = crypto.randomUUID();
    activeTaskId = taskId;
    const taskOfferId = offerId;
    const warnings = [];
    const entries = [];
    const records = { gallery: [], sku: [], detail: [] };
    const seen = new Map();
    let totalBytes = 0;
    setUi({ phase: 'busy', message: '正在读取商品与详情…', percent: 10 });

    try {
      if (taskOfferId !== getOfferId()) throw new Error('页面商品已变化，请对当前商品重新采集。');
      const detailResult = await readDetailImageUrls(warnings);
      if (taskOfferId !== getOfferId()) throw new Error('页面商品已变化，请对当前商品重新采集。');
      const skuData = collectSkuData();
      records.detail.push(...detailResult.failures);
      if (!source.gallery?.length) warnings.push('页面未提供轮播图地址。');
      if (!skuData.images.length) warnings.push('当前可见 SKU 区未发现图片。');
      const sources = [
        ['gallery', (source.gallery || []).map((url) => ({ url }))],
        ['sku', skuData.images],
        ['detail', detailResult.images.map((url) => ({ url }))],
      ];
      const candidates = [];
      for (const [group, list] of sources) {
        let order = 0;
        for (const image of list) {
          const rawUrl = typeof image === 'string' ? image : image?.url;
          const skuLabel = group === 'sku' && image?.label ? image.label : '';
          const url = normalizeImageUrl(rawUrl);
          if (!url) {
            records[group].push({ original_url: String(rawUrl || '').slice(0, 500), path: null, order, status: 'failed', reason: '图片地址无效或域名不在范围内', ...(skuLabel ? { sku_label: skuLabel } : {}) });
            order += 1;
            continue;
          }
          candidates.push({ group, url, order, ...(skuLabel ? { skuLabel } : {}) });
          order += 1;
        }
      }
      const unique = [...new Map(candidates.map((item) => [item.url, item])).values()];
      if (unique.length > MAX_IMAGE_COUNT) warnings.push(`图片总数超过 ${MAX_IMAGE_COUNT} 张，超出部分已标记未采集。`);
      const bounded = unique.slice(0, MAX_IMAGE_COUNT);
      setUi({ phase: 'busy', message: `已解析 ${candidates.length} 个图片位置，去重后 ${bounded.length} 个文件。`, percent: 20 });

      const resultByUrl = new Map();
      for (let index = 0; index < candidates.length; index += 1) {
        if (taskOfferId !== getOfferId()) throw new Error('页面商品已变化，已停止旧商品采集。');
        const item = candidates[index];
        const group = records[item.group];
        const prior = resultByUrl.get(item.url);
        if (prior) {
          group.push({ original_url: item.url, path: prior.path, order: item.order, status: prior.status, ...(prior.reason ? { reason: prior.reason } : {}), ...(item.skuLabel ? { sku_label: item.skuLabel } : {}) });
          continue;
        }
        const uniqueIndex = bounded.findIndex((candidate) => candidate.url === item.url);
        if (uniqueIndex < 0) {
          const skipped = { path: null, status: 'failed', reason: '超过本次采集图片数量上限' };
          resultByUrl.set(item.url, skipped);
          group.push({ original_url: item.url, path: null, order: item.order, ...skipped, ...(item.skuLabel ? { sku_label: item.skuLabel } : {}) });
          continue;
        }
        if (totalBytes >= MAX_TOTAL_BYTES) {
          const skipped = { path: null, status: 'failed', reason: '超过本次采集总大小限制' };
          resultByUrl.set(item.url, skipped);
          group.push({ original_url: item.url, path: null, order: item.order, ...skipped, ...(item.skuLabel ? { sku_label: item.skuLabel } : {}) });
          continue;
        }
        setUi({ phase: 'busy', message: `正在下载图片 ${Math.min(index + 1, bounded.length)}/${bounded.length}…`, percent: 20 + Math.round(68 * (Math.min(index + 1, bounded.length) / Math.max(1, bounded.length))) });
        try {
          const response = await chrome.runtime.sendMessage({ type: 'FETCH_1688_DETAIL_FILE', url: item.url, kind: 'image', offerId: taskOfferId });
          if (taskOfferId !== getOfferId()) throw new Error('页面商品已变化，已停止写入当前商品。');
          if (!response?.ok) throw new Error(response?.error || '图片请求失败');
          const bytes = decodeBase64(response.result.base64);
          const format = sniffImage(bytes);
          if (!format) throw new Error('响应内容不是可识别的图片');
          if (totalBytes + bytes.byteLength > MAX_TOTAL_BYTES) throw new Error('超过本次采集总大小限制');
          totalBytes += bytes.byteLength;
          const path = `${item.group}/${String(group.filter((record) => record.status === 'downloaded').length + 1).padStart(3, '0')}.${format.ext}`;
          entries.push({ path, bytes });
          const saved = { path, status: 'downloaded', content_type: response.result.contentType, size_bytes: bytes.byteLength, format: format.ext };
          resultByUrl.set(item.url, saved);
          group.push({ original_url: item.url, path, order: item.order, ...saved, ...(item.skuLabel ? { sku_label: item.skuLabel } : {}) });
        } catch (error) {
          const failed = { path: null, status: 'failed', reason: error?.message || '下载失败' };
          resultByUrl.set(item.url, failed);
          group.push({ original_url: item.url, path: null, order: item.order, ...failed, ...(item.skuLabel ? { sku_label: item.skuLabel } : {}) });
        }
      }
      if (taskOfferId !== getOfferId()) throw new Error('页面商品已变化，请对当前商品重新采集。');
      const successes = entries.length;
      if (!successes) throw new Error('没有成功下载的商品图片，请检查页面或稍后重试。');
      const positionCount = Object.values(records).reduce((count, group) => count + group.length, 0);
      const failureCount = Object.values(records).flat().filter((record) => record.status === 'failed').length;
      const product = buildProductJson(source, skuData, records, warnings, successes, positionCount, entries);
      entries.push({ path: 'product.json', bytes: new TextEncoder().encode(JSON.stringify(product, null, 2)) });
      setUi({ phase: 'busy', message: '正在写入 ZIP…', percent: 90 });
      const zipFiles = Object.fromEntries(entries.map((entry) => [entry.path, entry.bytes]));
      const archive = globalThis.fflate?.zipSync(zipFiles, { level: 1 });
      if (!(archive instanceof Uint8Array) || !archive.length) throw new Error('ZIP 文件生成失败。');
      if (taskOfferId !== getOfferId()) throw new Error('页面商品已变化，未开始下载旧商品 ZIP。');
      triggerDownload(archive, `StoreSnapper-1688-${taskOfferId}-${formatTimestamp()}.zip`);
      if (taskOfferId !== getOfferId()) return;
      const incomplete = failureCount > 0 || warnings.length > 0;
      const detailWarning = warnings.length ? `；${warnings[0]}` : '';
      setUi({
        phase: incomplete ? 'partial' : 'done',
        message: `ZIP 已开始下载：${successes} 张成功${failureCount ? `，${failureCount} 个图片位置未采集` : ''}${detailWarning}。`,
        percent: 100,
        buttonText: '重新采集',
      });
    } catch (error) {
      if (taskOfferId === getOfferId()) setUi({ phase: 'failed', message: error?.message || '采集失败，请重试。', percent: 0, buttonText: '重试' });
    } finally {
      if (activeTaskId === taskId) {
        activeTaskId = '';
        busy = false;
      }
    }
  }

  async function readDetailImageUrls(warnings) {
    if (!source?.descriptionUrl) {
      const reason = '页面未提供详情内容地址。';
      warnings.push(reason);
      return { images: [], failures: [{ original_url: null, path: null, order: 0, status: 'failed', reason }] };
    }
    const detailUrl = normalizeDetailUrl(source.descriptionUrl);
    if (!detailUrl) {
      const reason = '详情内容地址无效或域名不在范围内。';
      warnings.push(reason);
      return { images: [], failures: [{ original_url: source.descriptionUrl, path: null, order: 0, status: 'failed', reason }] };
    }
    setUi({ phase: 'busy', message: '正在读取详情图片…', percent: 14 });
    const response = await chrome.runtime.sendMessage({ type: 'FETCH_1688_DETAIL_FILE', url: detailUrl, kind: 'detail', offerId: source.offerId }).catch(() => undefined);
    if (!response?.ok) {
      const reason = response?.error || '详情内容读取失败。';
      warnings.push(reason);
      return { images: [], failures: [{ original_url: detailUrl, path: null, order: 0, status: 'failed', reason }] };
    }
    let payload;
    try {
      const match = response.result.text.match(/^\s*var\s+offer_details\s*=\s*([\s\S]*?)\s*;\s*$/);
      if (!match) throw new Error('详情内容格式无法识别');
      payload = JSON.parse(match[1]);
    } catch (error) {
      const reason = error?.message || '详情内容解析失败。';
      warnings.push(reason);
      return { images: [], failures: [{ original_url: detailUrl, path: null, order: 0, status: 'failed', reason }] };
    }
    const html = typeof payload?.content === 'string' ? payload.content : '';
    if (!html) {
      const reason = '详情内容为空。';
      warnings.push(reason);
      return { images: [], failures: [{ original_url: detailUrl, path: null, order: 0, status: 'failed', reason }] };
    }
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const images = [...parsed.querySelectorAll('img')];
    const result = [];
    for (const image of images) {
      const raw = ['src', 'data-src', 'data-lazyload-src', 'data-original', 'data-img', 'lazy-src']
        .map((key) => image.getAttribute(key)).find(Boolean);
      if (raw) result.push(raw);
    }
    if (images.length !== result.length) warnings.push(`${images.length - result.length} 个详情图片标签没有可用地址。`);
    if (!result.length) {
      const reason = images.length ? '详情图片地址未能解析。' : '详情内容中没有图片标签。';
      warnings.push(reason);
      return { images: result, failures: [{ original_url: detailUrl, path: null, order: 0, status: 'failed', reason }] };
    }
    return { images: result, failures: [] };
  }

  function collectSkuData() {
    const images = [...document.querySelectorAll('#skuSelection .sku-filter-button img')]
      .map((image) => ({
        url: image.currentSrc || image.getAttribute('data-src') || image.getAttribute('src') || '',
        label: cleanText(image.getAttribute('alt') || image.getAttribute('title') || image.closest('.sku-filter-button')?.getAttribute('title') || ''),
      }))
      .filter((image) => image.url);
    const dimensions = [...document.querySelectorAll('#skuSelection [class*="sku-title"], #skuSelection [class*="sku-item-title"], #skuSelection [class*="sku-name"]')]
      .map((element) => cleanText(element.innerText || element.textContent)).filter(Boolean);
    const skus = [...document.querySelectorAll('#skuSelection tr')].map((row) => {
      const cells = [...row.querySelectorAll('th,td')].map((cell) => cleanText(cell.innerText || cell.textContent)).filter(Boolean);
      return cells.length ? { visible_values: cells } : null;
    }).filter(Boolean).slice(0, 200);
    const attributes = [...document.querySelectorAll('#productAttributes tr, #productAttributes li')].map((row) => {
      const cells = [...row.querySelectorAll('th,td')].map((cell) => cleanText(cell.innerText || cell.textContent)).filter(Boolean);
      if (cells.length >= 2) return { name: cells[0], value: cells.slice(1).join(' ') };
      const text = cleanText(row.innerText || row.textContent);
      const match = text.match(/^([^:：]{1,80})\s*[:：]\s*(.{1,300})$/);
      return match ? { name: match[1], value: match[2] } : null;
    }).filter(Boolean).slice(0, 200);
    return { images, dimensions: [...new Set(dimensions)], skus, attributes };
  }

  function buildProductJson(item, skuData, records, warnings, successfulFiles, positionCount, entries) {
    const failed = Object.values(records).flat().filter((record) => record.status === 'failed').length;
    return {
      schema_version: 1,
      source: '1688 detail page',
      source_url: item.sourceUrl,
      offer_id: item.offerId,
      collected_at: new Date().toISOString(),
      title: item.title || null,
      supplier_name: item.supplierName || null,
      sale_count: item.saleCount ?? null,
      price_tiers: Array.isArray(item.priceTiers) ? item.priceTiers : null,
      sku_dimensions: skuData.dimensions.length ? skuData.dimensions : null,
      skus: skuData.skus.length ? skuData.skus : null,
      attributes: skuData.attributes.length ? skuData.attributes : null,
      images: records,
      collection: { successful_files: successfulFiles, failed_positions: failed, image_positions: positionCount, total_bytes: entries.reduce((sum, entry) => sum + (entry.path === 'product.json' ? 0 : entry.bytes.byteLength), 0) },
      warnings: [...new Set(warnings)],
    };
  }

  function normalizeImageUrl(raw) {
    try {
      const url = new URL(raw, location.href);
      if (url.protocol !== 'https:' || url.hostname !== IMAGE_HOST || url.username || url.password || url.port) return '';
      return url.href;
    } catch { return ''; }
  }

  function normalizeDetailUrl(raw) {
    try {
      const url = new URL(raw);
      if (url.protocol !== 'https:' || url.hostname !== 'itemcdn.tmall.com' || url.username || url.password || url.port) return '';
      return url.href;
    } catch { return ''; }
  }

  function decodeBase64(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  function sniffImage(bytes) {
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: 'jpg' };
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return { ext: 'png' };
    if (bytes.length >= 6 && (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a')) return { ext: 'gif' };
    if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return { ext: 'webp' };
    if (bytes.length >= 12 && ascii(bytes, 4, 4) === 'ftyp' && /^(avif|avis)$/.test(ascii(bytes, 8, 4))) return { ext: 'avif' };
    return undefined;
  }

  function ascii(bytes, start, length) {
    return String.fromCharCode(...bytes.subarray(start, start + length));
  }

  function triggerDownload(bytes, filename) {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  function setUi({ phase, message, percent, buttonText }) {
    const labels = {
      detecting: ['正在识别商品…', '正在识别…', 'busy'],
      ready: ['已识别到商品，准备就绪', '采集并打包', ''],
      busy: ['正在采集商品', '采集中…', 'busy'],
      done: ['采集完成', buttonText || '重新采集', ''],
      partial: ['部分内容未采集', buttonText || '重新采集', 'warn'],
      failed: ['采集遇到问题', buttonText || '重试', 'error'],
    };
    const label = labels[phase] || labels.failed;
    view.dot.className = `dot ${label[2]}`.trim();
    view.status.textContent = label[0];
    view.title.textContent = source?.title || document.querySelector('#productTitle')?.innerText?.trim() || '正在读取商品标题…';
    view.id.textContent = offerId ? `商品 ID：${offerId}` : '';
    const galleryCount = source?.gallery?.length;
    const skuCount = document.querySelectorAll('#skuSelection .sku-filter-button img').length;
    view.counts.textContent = source ? `轮播 ${galleryCount ?? '待读取'} · SKU ${skuCount || '待读取'} · 详情待读取` : '';
    view.message.textContent = message || '';
    view.message.className = `message ${phase === 'failed' ? 'error' : phase === 'partial' ? 'warn' : ''}`.trim();
    view.bar.style.width = `${Math.max(0, Math.min(100, percent || 0))}%`;
    view.button.textContent = label[1];
    view.button.disabled = busy || phase === 'detecting' || phase === 'busy';
  }

  function setCollapsed(collapsed) {
    panel.hidden = collapsed;
    view.mini.hidden = !collapsed;
  }

  function checkRoute() {
    const nextOfferId = getOfferId();
    if (!nextOfferId) {
      if (offerId) {
        offerId = '';
        source = undefined;
        scanGeneration += 1;
        activeTaskId = '';
        busy = false;
        root.hidden = true;
      }
      return;
    }
    if (nextOfferId === offerId) return;
    offerId = nextOfferId;
    source = undefined;
    scanGeneration += 1;
    activeTaskId = '';
    busy = false;
    root.hidden = false;
    setUi({ phase: 'detecting', message: '', percent: 0 });
    void recognize();
  }

  function getOfferId() { return location.pathname.match(/^\/offer\/(\d{8,})\.html$/i)?.[1] || ''; }
  function cleanText(value) { return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 500); }
  function formatTimestamp() {
    const date = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
  }
})();
