(() => {
  if (!/^\/offer\/\d{8,}\.html$/i.test(location.pathname)) return;

  const IMAGE_HOST = 'cbu01.alicdn.com';
  const MAX_IMAGE_COUNT = 120;
  const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
  const PANEL_POSITION_KEY = 'storesnapper1688DetailPanelPosition';
  const PROVINCE_PREFIXES = ['内蒙古', '黑龙江', '广西', '宁夏', '新疆', '西藏', '北京', '天津', '上海', '重庆', '河北', '山西', '辽宁', '吉林', '江苏', '浙江', '安徽', '福建', '江西', '山东', '河南', '湖北', '湖南', '广东', '海南', '四川', '贵州', '云南', '陕西', '甘肃', '青海', '台湾', '香港', '澳门'];
  let offerId = getOfferId();
  let source;
  let panel;
  let view;
  let busy = false;
  let activeTaskId = '';
  let scanGeneration = 0;
  let dragState;
  let suppressMiniClick = false;

  const root = document.createElement('div');
  root.id = 'storesnapper-1688-detail-collector';
  root.style.cssText = 'all:initial;display:block;position:fixed;z-index:2147483647;right:20px;bottom:20px;width:min(328px,calc(100vw - 32px));pointer-events:none;';
  const shadow = root.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>
      :host{all:initial;display:block;font-family:Arial,"Microsoft YaHei",sans-serif;color:#20332c}
      *{box-sizing:border-box}
      .panel{width:100%;padding:16px;border:1px solid #dce8e1;border-radius:14px;background:#fff;box-shadow:0 8px 30px rgba(14,39,29,.2);pointer-events:auto}
      .panel[hidden],.mini[hidden]{display:none}
      .head{display:flex;align-items:center;gap:9px;margin-bottom:13px;cursor:move;touch-action:none;user-select:none}
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
      .mini{position:absolute;left:0;top:0;display:grid;place-items:center;width:48px;height:48px;border:1px solid #cfe2d6;border-radius:50%;background:#fff;color:#1f7655;box-shadow:0 4px 18px rgba(14,39,29,.2);font-size:18px;font-weight:700;pointer-events:auto;cursor:move;touch-action:none;user-select:none}
    </style>
    <section class="panel" role="region" aria-label="1688 商品采集">
      <header class="head" tabindex="0" aria-label="拖动移动面板，可使用方向键调整位置" title="拖动移动；方向键可微调"><span class="brand" aria-hidden="true">S</span><span class="title">1688 商品采集</span><button class="collapse" type="button" aria-label="收起面板" title="收起">−</button></header>
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
  view.mini.addEventListener('click', (event) => {
    if (suppressMiniClick) {
      event.preventDefault();
      event.stopPropagation();
      suppressMiniClick = false;
      return;
    }
    setCollapsed(false);
  });
  installPanelPosition();
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
    const groupFileCounts = { gallery: 0, sku: 0, detail: 0 };
    let totalBytes = 0;
    setUi({ phase: 'busy', message: '正在读取商品与详情…', percent: 10 });

    try {
      if (taskOfferId !== getOfferId()) throw new Error('页面商品已变化，请对当前商品重新采集。');
      const detailResult = await readDetailImageUrls(warnings);
      if (taskOfferId !== getOfferId()) throw new Error('页面商品已变化，请对当前商品重新采集。');
      setUi({ phase: 'busy', message: '正在读取 SKU 规格…', percent: 16 });
      const skuData = await collectSkuData(taskOfferId, warnings);
      skuData.skus = mergeSkuCatalogAndPackInfo(skuData.skus, skuData.dimensions, source.skuCatalog, source.skuPackInfo, warnings);
      records.detail.push(...detailResult.failures);
      if (!source.gallery?.length) addWarning(warnings, 'gallery_source_none', '页面未提供轮播图地址。');
      if (source.priceTiersSource && source.priceTiersSource !== 'mainPrice.priceRangeList' && hasConflictingPriceTiers(source.priceTiers)) {
        addWarning(warnings, 'price_tiers_source_ambiguous', '备用价格字段中存在相同起批量对应不同价格的记录，可能混入 SKU 单价，请人工核对。', { source_field: source.priceTiersSource });
      }
      const sources = [
        ['gallery', (source.gallery || []).map((url) => ({ url, sourceUrl: url }))],
        ['sku', skuData.images],
        ['detail', detailResult.images.map((url) => ({ url, sourceUrl: url }))],
      ];
      const candidates = [];
      for (const [group, list] of sources) {
        let order = 0;
        for (const image of list) {
          const rawUrl = typeof image === 'string' ? image : image?.url;
          const skuLabel = group === 'sku' && image?.label ? image.label : '';
          if (group === 'sku' && image?.sourceStatus) {
            records[group].push({ original_url: null, path: null, order, status: image.sourceStatus, reason: image.reason, ...(skuLabel ? { sku_label: skuLabel } : {}) });
            order += 1;
            continue;
          }
          const url = normalizeImageUrl(image?.requestUrl || rawUrl);
          const fallbackUrl = normalizeImageUrl(image?.fallbackUrl || '');
          if (!url) {
            const reason = '图片地址无效或域名不在范围内';
            records[group].push({ original_url: String(rawUrl || '').slice(0, 500) || null, path: null, order, status: 'failed', reason, ...(skuLabel ? { sku_label: skuLabel } : {}) });
            if (group === 'sku') addWarning(warnings, 'sku_image_download_failed', `SKU 图片「${skuLabel || '未命名规格'}」的地址无效或不受支持。`);
            order += 1;
            continue;
          }
          candidates.push({ group, url, sourceUrl: image?.sourceUrl || rawUrl, order, ...(fallbackUrl && fallbackUrl !== url ? { fallbackUrl } : {}), ...(skuLabel ? { skuLabel } : {}) });
          order += 1;
        }
      }
      const unique = [...new Map(candidates.map((item) => [item.url, item])).values()];
      if (unique.length > MAX_IMAGE_COUNT) addWarning(warnings, 'image_limit_reached', `图片总数超过 ${MAX_IMAGE_COUNT} 张，超出部分已标记未采集。`);
      const bounded = unique.slice(0, MAX_IMAGE_COUNT);
      setUi({ phase: 'busy', message: `已解析 ${candidates.length} 个图片位置，去重后 ${bounded.length} 个文件。`, percent: 20 });

      const resultByUrl = new Map();
      const resultByHash = new Map();
      for (let index = 0; index < candidates.length; index += 1) {
        if (taskOfferId !== getOfferId()) throw new Error('页面商品已变化，已停止旧商品采集。');
        const item = candidates[index];
        const group = records[item.group];
        const prior = resultByUrl.get(item.url);
        if (prior) {
          const originalPosition = prior.origin_position || prior.duplicate_of || null;
          resultByUrl.set(item.url, { ...prior, duplicate: true, duplicate_of: originalPosition, origin_position: originalPosition });
          group.push({ original_url: item.sourceUrl, download_url: prior.download_url || item.url, path: prior.path, order: item.order, status: prior.status, duplicate: true, duplicate_of: originalPosition, ...(prior.content_hash ? { content_hash: prior.content_hash } : {}), ...(prior.reason ? { reason: prior.reason } : {}), ...(item.skuLabel ? { sku_label: item.skuLabel } : {}) });
          if (item.group === 'sku' && prior.status === 'failed') addWarning(warnings, 'sku_image_download_failed', `SKU 图片「${item.skuLabel || '未命名规格'}」下载失败：${prior.reason || '请求失败'}`);
          continue;
        }
        const uniqueIndex = bounded.findIndex((candidate) => candidate.url === item.url);
        if (uniqueIndex < 0) {
          const skipped = { path: null, status: 'failed', reason: '超过本次采集图片数量上限', origin_position: { group: item.group, order: item.order } };
          resultByUrl.set(item.url, skipped);
          group.push({ original_url: item.sourceUrl, path: null, order: item.order, status: skipped.status, reason: skipped.reason, ...(item.skuLabel ? { sku_label: item.skuLabel } : {}) });
          continue;
        }
        setUi({ phase: 'busy', message: `正在下载图片 ${Math.min(index + 1, bounded.length)}/${bounded.length}…`, percent: 20 + Math.round(68 * (Math.min(index + 1, bounded.length) / Math.max(1, bounded.length))) });
        try {
          let downloadUrl = item.url;
          let asset;
          try {
            asset = await requestImage(item.url, taskOfferId);
          } catch (primaryError) {
            if (!item.fallbackUrl) throw primaryError;
            downloadUrl = item.fallbackUrl;
            try {
              asset = await requestImage(downloadUrl, taskOfferId);
            } catch (fallbackError) {
              throw new Error(`原图失败：${primaryError?.message || '请求失败'}；缩略图回退失败：${fallbackError?.message || '请求失败'}`);
            }
          }
          if (taskOfferId !== getOfferId()) throw new Error('页面商品已变化，已停止写入当前商品。');
          const bytes = decodeBase64(asset.base64);
          const format = sniffImage(bytes);
          if (!format) throw new Error('响应内容不是可识别的图片');
          const contentHash = /^[a-f0-9]{32}$/i.test(asset.contentHash || '') ? asset.contentHash.toLowerCase() : null;
          if (!contentHash) throw new Error('图片响应缺少有效的 MD5 内容哈希');
          const sameContent = resultByHash.get(contentHash);
          if (sameContent) {
            const originalPosition = sameContent.origin_position || sameContent.duplicate_of || null;
            const duplicate = { ...sameContent, download_url: downloadUrl, content_hash: contentHash, duplicate: true, duplicate_of: originalPosition, origin_position: originalPosition };
            resultByUrl.set(item.url, duplicate);
            group.push({ original_url: item.sourceUrl, path: sameContent.path, order: item.order, status: 'downloaded', duplicate: true, duplicate_of: originalPosition, download_url: downloadUrl, content_type: asset.contentType, size_bytes: bytes.byteLength, format: format.ext, content_hash: contentHash, ...(item.skuLabel ? { sku_label: item.skuLabel } : {}) });
            continue;
          }
          if (totalBytes + bytes.byteLength > MAX_TOTAL_BYTES) throw new Error('超过本次采集总大小限制');
          totalBytes += bytes.byteLength;
          groupFileCounts[item.group] += 1;
          const path = `${item.group}/${String(groupFileCounts[item.group]).padStart(3, '0')}.${format.ext}`;
          entries.push({ path, bytes, kind: 'image' });
          const saved = { path, download_url: downloadUrl, status: 'downloaded', content_type: asset.contentType, size_bytes: bytes.byteLength, format: format.ext, content_hash: contentHash, origin_position: { group: item.group, order: item.order } };
          resultByUrl.set(item.url, saved);
          resultByHash.set(contentHash, saved);
          const { origin_position: _originPosition, ...savedRecord } = saved;
          group.push({ original_url: item.sourceUrl, order: item.order, ...savedRecord, ...(item.skuLabel ? { sku_label: item.skuLabel } : {}) });
        } catch (error) {
          const failed = { path: null, status: 'failed', reason: error?.message || '下载失败', origin_position: { group: item.group, order: item.order } };
          resultByUrl.set(item.url, failed);
          group.push({ original_url: item.sourceUrl, path: null, order: item.order, status: failed.status, reason: failed.reason, ...(item.skuLabel ? { sku_label: item.skuLabel } : {}) });
          if (item.group === 'sku') addWarning(warnings, 'sku_image_download_failed', `SKU 图片「${item.skuLabel || '未命名规格'}」下载失败：${failed.reason}`);
        }
      }
      if (taskOfferId !== getOfferId()) throw new Error('页面商品已变化，请对当前商品重新采集。');
      for (const group of Object.values(records)) group.sort((left, right) => left.order - right.order);
      addCollectionWarnings(source, skuData, records, warnings);
      const imageOrder = buildImageOrderManifest(taskOfferId, records);
      entries.push({ path: 'image_order.json', bytes: new TextEncoder().encode(JSON.stringify(imageOrder, null, 2)), kind: 'manifest' });
      const successes = Object.values(groupFileCounts).reduce((sum, count) => sum + count, 0);
      const firstImageFailure = Object.values(records).flat().find((record) => record.status === 'failed' && record.reason)?.reason;
      if (!successes) throw new Error(firstImageFailure || '没有发现可下载的商品图片，请检查页面后重试。');
      const positionCount = Object.values(records).reduce((count, group) => count + group.length, 0);
      const failureCount = Object.values(records).flat().filter((record) => record.status === 'failed' || record.status === 'source_none' || record.status === 'not_rendered').length;
      const product = buildProductJson(source, skuData, records, warnings, successes, positionCount, entries);
      entries.push({ path: 'product.json', bytes: new TextEncoder().encode(JSON.stringify(product, null, 2)), kind: 'metadata' });
      setUi({ phase: 'busy', message: '正在写入 ZIP…', percent: 90 });
      const zipFiles = Object.fromEntries(entries.map((entry) => [entry.path, entry.bytes]));
      const archive = globalThis.fflate?.zipSync(zipFiles, { level: 1 });
      if (!(archive instanceof Uint8Array) || !archive.length) throw new Error('ZIP 文件生成失败。');
      if (taskOfferId !== getOfferId()) throw new Error('页面商品已变化，未开始下载旧商品 ZIP。');
      triggerDownload(archive, `StoreSnapper-1688-${taskOfferId}-${formatTimestamp()}.zip`);
      if (taskOfferId !== getOfferId()) return;
      const incomplete = failureCount > 0 || warnings.length > 0;
      const detailWarning = firstImageFailure ? `；${firstImageFailure}` : warnings.length ? `；${warnings[0].message}` : '';
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
      addWarning(warnings, 'detail_source_missing', reason);
      return { images: [], failures: [{ original_url: null, path: null, order: 0, status: 'failed', reason }] };
    }
    const detailUrl = normalizeDetailUrl(source.descriptionUrl);
    if (!detailUrl) {
      const reason = '详情内容地址无效或域名不在范围内。';
      addWarning(warnings, 'detail_url_invalid', reason);
      return { images: [], failures: [{ original_url: source.descriptionUrl, path: null, order: 0, status: 'failed', reason }] };
    }
    setUi({ phase: 'busy', message: '正在读取详情图片…', percent: 14 });
    const response = await chrome.runtime.sendMessage({ type: 'FETCH_1688_DETAIL_FILE', url: detailUrl, kind: 'detail', offerId: source.offerId }).catch(() => undefined);
    if (!response?.ok) {
      const reason = response?.error || '详情内容读取失败。';
      addWarning(warnings, 'detail_fetch_failed', reason);
      return { images: [], failures: [{ original_url: detailUrl, path: null, order: 0, status: 'failed', reason }] };
    }
    let payload;
    try {
      const match = response.result.text.match(/^\s*var\s+offer_details\s*=\s*([\s\S]*?)\s*;\s*$/);
      if (!match) throw new Error('详情内容格式无法识别');
      payload = JSON.parse(match[1]);
    } catch (error) {
      const reason = error?.message || '详情内容解析失败。';
      addWarning(warnings, 'detail_parse_failed', reason);
      return { images: [], failures: [{ original_url: detailUrl, path: null, order: 0, status: 'failed', reason }] };
    }
    const html = typeof payload?.content === 'string' ? payload.content : '';
    if (!html) {
      const reason = '详情内容为空。';
      addWarning(warnings, 'detail_content_empty', reason);
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
    if (images.length !== result.length) addWarning(warnings, 'detail_image_url_missing', `${images.length - result.length} 个详情图片标签没有可用地址。`);
    if (!result.length) {
      const reason = images.length ? '详情图片地址未能解析。' : '详情内容中没有图片标签。';
      addWarning(warnings, images.length ? 'detail_image_url_missing' : 'detail_images_source_none', reason);
      return { images: result, failures: [{ original_url: detailUrl, path: null, order: 0, status: 'failed', reason }] };
    }
    return { images: result, failures: [] };
  }

  async function collectSkuData(taskOfferId, warnings) {
    const container = document.querySelector('#skuSelection');
    const variantButtons = () => [...(container?.querySelectorAll('.sku-filter-button') || [])];
    const getRows = () => [...(container?.querySelectorAll('.expand-view-list-wrapper .expand-view-item') || [])];
    const dimensions = (source.skuDimensions?.length
      ? source.skuDimensions
      : [...(container?.querySelectorAll('.feature-item-label h3') || [])].map((element) => cleanText(element.innerText)).filter(Boolean))
      .map(cleanText).filter(Boolean);
    const packRows = Array.isArray(source.skuPackInfo) ? source.skuPackInfo : [];
    const dimensionKeys = makeDimensionKeys(dimensions, getPackDimensionCount(packRows));
    const skusByKey = new Map();
    const initialButtons = variantButtons();
    const originalIndex = initialButtons.findIndex((button) => button.classList.contains('active'));

    const valuesFor = (variantLabel, row, pack) => {
      const rowValues = row
        ? [...row.querySelectorAll('.item-label')].map((element) => cleanText(element.innerText || element.getAttribute('title'))).filter(Boolean)
        : [];
      const values = [...(variantLabel ? [cleanText(variantLabel)] : []), ...rowValues];
      const packValues = getPackDimensionValues(pack);
      for (let index = 0; index < Math.max(dimensions.length, packValues.length); index += 1) {
        if (!values[index] && packValues[index]) values[index] = packValues[index];
      }
      return values;
    };

    const findPack = (values) => findPackInfoRow(values, packRows);

    const upsertSku = (row, variantLabel) => {
      const values = [...row.querySelectorAll('.item-price-stock')].map((element) => cleanText(element.innerText || element.textContent));
      const rawValues = valuesFor(variantLabel, row, null);
      const pack = findPack(rawValues);
      const dimensionValues = valuesFor(variantLabel, row, pack);
      const skuValues = Object.fromEntries(dimensionKeys.flatMap((key, index) => dimensionValues[index] ? [[key, dimensionValues[index]]] : []));
      const variant = dimensions.map((_, index) => dimensionValues[index]).filter(Boolean).join(' / ') || dimensionValues.filter(Boolean).join(' / ') || null;
      if (!variant && !values.length && !pack) return null;
      const record = {
        variant,
        sku_values: skuValues,
        price: values[0] || null,
        stock: values[1] || null,
        sku_id: null,
        weight_g: pack?.weight ?? null,
      };
      const key = dimensionValues.some((value) => normalizeSkuValue(value))
        ? dimensionValues.map(normalizeSkuValue).join('\u0000')
        : `${record.price || ''}\u0000${record.stock || ''}`;
      const previous = skusByKey.get(key);
      skusByKey.set(key, previous ? {
        ...previous,
        ...record,
        price: record.price || previous.price,
        stock: record.stock || previous.stock,
        sku_id: hasSkuId(previous.sku_id) ? previous.sku_id : record.sku_id,
        weight_g: previous.weight_g ?? record.weight_g,
      } : record);
      return record;
    };

    const skuImages = collectFirstDimensionImages(container, warnings);

    const scanCurrentRows = (variantLabel) => {
      const rows = getRows();
      if (!rows.length && variantLabel) {
        const pack = findPack([variantLabel]);
        const dimensionValues = valuesFor(variantLabel, null, pack);
        const record = {
          variant: dimensions.map((_, index) => dimensionValues[index]).filter(Boolean).join(' / ') || dimensionValues.filter(Boolean).join(' / ') || null,
          sku_values: Object.fromEntries(dimensionKeys.flatMap((key, index) => dimensionValues[index] ? [[key, dimensionValues[index]]] : [])),
          price: null,
          stock: null,
          sku_id: null,
          weight_g: pack?.weight ?? null,
        };
        const key = dimensionValues.map(normalizeSkuValue).join('\u0000');
        if (key) skusByKey.set(key, { ...record, ...skusByKey.get(key), sku_id: skusByKey.get(key)?.sku_id ?? record.sku_id, weight_g: skusByKey.get(key)?.weight_g ?? record.weight_g });
        return;
      }
      for (const row of rows) upsertSku(row, variantLabel);
    };

    try {
      for (let index = 0; index < initialButtons.length; index += 1) {
        if (taskOfferId !== getOfferId()) throw new Error('页面商品已变化，已停止 SKU 读取。');
        let buttons = variantButtons();
        let button = buttons[index];
        if (!button) continue;
        const variantLabel = cleanText(button.querySelector('.label-name')?.innerText || button.innerText);
        let activeIndex = buttons.findIndex((item) => item.classList.contains('active'));
        if (activeIndex !== index) {
          await clickSkuOption(button, container);
          buttons = variantButtons();
          activeIndex = buttons.findIndex((item) => item.classList.contains('active'));
        }
        if (activeIndex !== index) {
          addWarning(warnings, 'sku_option_not_selected', `SKU 规格「${variantLabel}」未能切换，未记录其价格和库存。`, { sku_label: variantLabel });
          continue;
        }
        scanCurrentRows(variantLabel);
      }
      if (!initialButtons.length) scanCurrentRows('');
    } finally {
      if (taskOfferId === getOfferId() && originalIndex >= 0) {
        const buttons = variantButtons();
        const activeIndex = buttons.findIndex((item) => item.classList.contains('active'));
        if (activeIndex !== originalIndex && buttons[originalIndex]) await clickSkuOption(buttons[originalIndex], container);
      }
    }
    const attributes = [];
    for (const row of document.querySelectorAll('#productAttributes tr, #productAttributes li')) {
      const cells = [...row.querySelectorAll('th,td')].map((cell) => cleanText(cell.innerText || cell.textContent));
      if (cells.length >= 2) {
        if (cells.length % 2 !== 0) addWarning(warnings, 'attribute_pair_incomplete', '商品属性存在未配对的名称或值，已只保留完整的名称/值对。');
        for (let index = 0; index + 1 < cells.length; index += 2) {
          const name = cells[index];
          const value = cells[index + 1];
          if (name && value) attributes.push({ name, value });
          else addWarning(warnings, 'attribute_pair_empty', '商品属性存在空名称或空值，已跳过该项。');
        }
        continue;
      }
      const text = cleanText(row.innerText || row.textContent);
      const match = text.match(/^([^:：]{1,80})\s*[:：]\s*(.{1,300})$/);
      if (match) attributes.push({ name: match[1], value: match[2] });
      else if (cells.length || text) addWarning(warnings, 'attribute_row_unparsed', '存在无法按名称/值拆分的商品属性行，已跳过。');
    }
    return { images: skuImages, dimensions: [...new Set(dimensions)], skus: [...skusByKey.values()].slice(0, 240), attributes: attributes.slice(0, 200) };
  }

  function collectFirstDimensionImages(container, warnings) {
    const firstDimension = container && [...container.querySelectorAll('.module-od-sku-selection .feature-item')]
      .find((item) => item.querySelector('.transverse-filter .sku-filter-button'));
    const buttons = firstDimension ? [...firstDimension.querySelectorAll('.transverse-filter .sku-filter-button')] : [];
    const domOptions = buttons.map((button) => {
      const elements = [...button.querySelectorAll('img')];
      const url = elements.flatMap((image) => [
        image.currentSrc,
        ...['data-src', 'data-lazy-src', 'data-lazyload-src', 'data-original', 'data-original-src', 'data-ks-lazyload', 'src']
          .map((name) => image.getAttribute(name)),
      ]).find((value) => value && /^https?:\/\//i.test(value));
      return {
        label: cleanText(button.querySelector('.label-name')?.innerText || button.innerText),
        imageUrl: url || getBackgroundImageUrl(button),
        hasImageElement: elements.length > 0,
      };
    });
    const domByLabel = new Map(domOptions.map((option) => [normalizeSkuValue(option.label), option]));
    const sourceOptions = Array.isArray(source.skuFirstDimensionOptions) ? source.skuFirstDimensionOptions : [];
    const options = sourceOptions.length ? sourceOptions : domOptions;
    const images = [];
    for (const option of options) {
      const label = cleanText(option.label) || '规格一';
      const domOption = domByLabel.get(normalizeSkuValue(label));
      const rawUrl = option.imageUrl || domOption?.imageUrl || '';
      if (rawUrl) {
        const thumbnailUrl = rawUrl;
        const originalUrl = thumbnailUrl.replace(/_sum\.[a-z0-9]+(?=[?#]|$)/i, '');
        images.push({ url: thumbnailUrl, requestUrl: originalUrl, fallbackUrl: originalUrl !== thumbnailUrl ? thumbnailUrl : '', sourceUrl: thumbnailUrl, label });
        continue;
      }

      const status = domOption?.hasImageElement ? 'not_rendered' : 'source_none';
      const reason = status === 'source_none'
        ? `规格一「${label}」没有 SKU 图片元素。`
        : `规格一「${label}」有图片元素，但当前没有可读取的图片地址。`;
      addWarning(warnings, status === 'source_none' ? 'sku_image_source_none' : 'sku_image_not_rendered', reason, { sku_label: label });
      images.push({ sourceStatus: status, label, reason });
    }
    return images;
  }

  function makeDimensionKeys(labels, fallbackCount = 0) {
    const sourceLabels = labels.length ? labels : Array.from({ length: fallbackCount }, (_, index) => `dimension_${index + 1}`);
    const mappings = [
      [/颜色|色系|色彩|color/i, 'color'],
      [/尺码|尺寸|大小|size/i, 'size'],
      [/型号|机型|model/i, 'model'],
      [/款式|版型|style/i, 'style'],
      [/材质|面料|material|fabric/i, 'material'],
      [/包装|packaging|package/i, 'packaging'],
      [/规格|套餐|specification|spec/i, 'specification'],
      [/容量|capacity/i, 'capacity'],
      [/图案|pattern/i, 'pattern'],
      [/口味|flavor/i, 'flavor'],
      [/重量|weight/i, 'weight'],
      [/数量|件数|quantity|count/i, 'quantity'],
      [/成分|含量|composition/i, 'composition'],
    ];
    const used = new Map();
    return sourceLabels.map((label, index) => {
      const raw = cleanText(label) || `dimension_${index + 1}`;
      const key = mappings.find(([pattern]) => pattern.test(raw))?.[1]
        || raw.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
        || raw;
      const count = (used.get(key) || 0) + 1;
      used.set(key, count);
      return count === 1 ? key : `${key}_${count}`;
    });
  }

  function normalizeSkuValue(value) {
    return cleanText(value).replace(/\s+/g, ' ').toLocaleLowerCase();
  }

  function findPackInfoRow(values, rows) {
    if (!Array.isArray(rows) || !rows.length) return null;
    const observed = values.map(normalizeSkuValue);
    if (!observed.some(Boolean)) return rows.length === 1 ? rows[0] : null;
    const matches = rows.filter((row) => {
      const tuple = getPackDimensionValues(row).map(normalizeSkuValue);
      const knownPackAxes = tuple.map((value, index) => ({ value, index })).filter((item) => item.value);
      if (!knownPackAxes.length) return rows.length === 1;
      return knownPackAxes.every(({ value, index }) => Boolean(observed[index]) && observed[index] === value);
    });
    return matches.length === 1 ? matches[0] : null;
  }

  function getPackDimensionValues(pack) {
    if (!pack || typeof pack !== 'object') return [];
    const keys = Object.keys(pack).filter((key) => /^sku\d{1,2}$/.test(key) && Number(key.slice(3)) > 0 && Number(key.slice(3)) <= 12);
    const count = keys.reduce((max, key) => Math.max(max, Number(key.slice(3))), 0);
    return Array.from({ length: count }, (_, index) => cleanText(pack[`sku${index + 1}`]));
  }

  function getPackDimensionCount(rows) {
    return (Array.isArray(rows) ? rows : []).reduce((max, row) => Math.max(max, getPackDimensionValues(row).length), 0);
  }

  function mergeSkuCatalogAndPackInfo(skus, dimensions, skuCatalog, packRows, warnings) {
    if (!Array.isArray(skus)) return [];
    const rows = Array.isArray(packRows) ? packRows : [];
    const labels = Array.isArray(dimensions) ? dimensions : [];
    const catalog = Array.isArray(skuCatalog) ? skuCatalog.filter((entry) => Array.isArray(entry?.values) && entry.values.length) : [];
    const catalogDimensionCount = catalog.reduce((max, entry) => Math.max(max, entry.values.length), 0);
    const keys = makeDimensionKeys(labels, Math.max(getPackDimensionCount(rows), catalogDimensionCount));
    const usedPacks = new Set();
    let unmatchedSkuCount = 0;
    const mainSkuByTuple = new Map();
    for (const entry of catalog) {
      if (entry.values.length !== keys.length) continue;
      const key = skuTupleKey(entry.values);
      if (!mainSkuByTuple.has(key)) mainSkuByTuple.set(key, entry);
    }

    const merged = [];
    const existingByTuple = new Map();
    for (const sku of skus) {
      const skuValues = { ...(sku.sku_values || {}) };
      const values = keys.map((key) => skuValues[key] || '');
      const tupleKey = skuTupleKey(values);
      const hasAllValues = values.length > 0 && values.every(Boolean);
      const mainSku = hasAllValues ? mainSkuByTuple.get(tupleKey) : null;
      if (!hasAllValues && mainSkuByTuple.size) continue;
      if (hasAllValues && existingByTuple.has(tupleKey)) {
        const previous = existingByTuple.get(tupleKey);
        previous.price ||= sku.price || null;
        previous.stock ||= sku.stock || null;
        continue;
      }
      const pack = findPackInfoRow(values, rows);
      if (!pack) {
        unmatchedSkuCount += 1;
        const record = { ...sku, sku_values: skuValues, sku_id: hasSkuId(mainSku?.skuId) ? mainSku.skuId : null, weight_g: sku.weight_g ?? null };
        merged.push(record);
        if (hasAllValues) existingByTuple.set(tupleKey, record);
        continue;
      }
      usedPacks.add(pack);
      const packValues = getPackDimensionValues(pack);
      keys.forEach((key, index) => {
        if (!skuValues[key] && packValues[index]) skuValues[key] = packValues[index];
      });
      const variant = keys.map((key) => skuValues[key]).filter(Boolean).join(' / ');
      const record = {
        ...sku,
        variant: variant || sku.variant || null,
        sku_values: skuValues,
        sku_id: hasSkuId(mainSku?.skuId) ? mainSku.skuId : null,
        weight_g: sku.weight_g !== null && sku.weight_g !== undefined && Number(sku.weight_g) > 0 ? sku.weight_g : pack.weight ?? null,
      };
      merged.push(record);
      if (hasAllValues) existingByTuple.set(tupleKey, record);
    }

    for (const entry of catalog) {
      if (entry.values.length !== keys.length || !entry.values.every(Boolean)) continue;
      const tupleKey = skuTupleKey(entry.values);
      if (existingByTuple.has(tupleKey)) continue;
      const skuValues = Object.fromEntries(keys.map((key, index) => [key, cleanText(entry.values[index])]));
      const pack = findPackInfoRow(entry.values, rows);
      if (pack) usedPacks.add(pack);
      merged.push({
        variant: entry.values.map(cleanText).join(' / '),
        sku_values: skuValues,
        price: null,
        stock: null,
        sku_id: hasSkuId(entry.skuId) ? entry.skuId : null,
        weight_g: pack?.weight ?? null,
      });
      existingByTuple.set(tupleKey, merged[merged.length - 1]);
    }

    if (unmatchedSkuCount && rows.length) addWarning(warnings, 'sku_pack_unmatched', `${unmatchedSkuCount} 条 SKU 未能与包装信息可靠匹配。`, { count: unmatchedSkuCount });
    const unmatchedPackCount = rows.filter((row) => !usedPacks.has(row)).length;
    if (unmatchedPackCount && merged.length) addWarning(warnings, 'sku_pack_unmatched', `${unmatchedPackCount} 条包装信息未能与页面 SKU 可靠匹配。`, { count: unmatchedPackCount });
    return merged;
  }

  function skuTupleKey(values) {
    return values.map(normalizeSkuValue).join('\u0000');
  }

  function getBackgroundImageUrl(element) {
    const nodes = [element, ...element.querySelectorAll('*')];
    for (const node of nodes) {
      const background = getComputedStyle(node).backgroundImage;
      const match = background.match(/url\(["']?(.*?)["']?\)/i);
      if (match?.[1]) return match[1];
    }
    return '';
  }

  function hasConflictingPriceTiers(priceTiers) {
    if (!Array.isArray(priceTiers)) return false;
    const priceByAmount = new Map();
    for (const tier of priceTiers) {
      const amount = cleanText(tier?.beginAmount);
      const price = cleanText(tier?.price);
      if (!amount || !price) continue;
      if (priceByAmount.has(amount) && priceByAmount.get(amount) !== price) return true;
      priceByAmount.set(amount, price);
    }
    return false;
  }

  function clickSkuOption(button, container) {
    return new Promise((resolve) => {
      let quietTimer;
      let hardTimer;
      const observer = new MutationObserver(() => {
        clearTimeout(quietTimer);
        quietTimer = setTimeout(finish, 280);
      });
      const finish = () => {
        clearTimeout(quietTimer);
        clearTimeout(hardTimer);
        observer.disconnect();
        resolve();
      };
      observer.observe(container || document.body, { attributes: true, childList: true, characterData: true, subtree: true });
      button.click();
      quietTimer = setTimeout(finish, 320);
      hardTimer = setTimeout(finish, 2500);
    });
  }

  function buildProductJson(item, skuData, records, warnings, successfulFiles, positionCount, entries) {
    const failed = Object.values(records).flat().filter((record) => record.status === 'failed').length;
    return {
      schema_version: 4,
      source: '1688 detail page',
      source_url: item.sourceUrl,
      offer_id: item.offerId,
      collected_at: new Date().toISOString(),
      content_hash_algorithm: 'MD5',
      title: item.title || null,
      supplier_name: item.supplierName || null,
      shipping_origin: parseShippingOrigin(item.shippingOrigin),
      sale_count: item.saleCount ?? null,
      price_tiers: Array.isArray(item.priceTiers) ? item.priceTiers : null,
      price_tiers_source: item.priceTiersSource || null,
      sku_images_scope: 'first_dimension',
      sku_dimensions: skuData.dimensions.length ? skuData.dimensions : null,
      skus: skuData.skus.length ? skuData.skus : null,
      sku_pack_info: normalizePackInfo(item.skuPackInfo),
      attributes: skuData.attributes.length ? skuData.attributes : null,
      images: records,
      collection: {
        successful_files: successfulFiles,
        failed_positions: failed,
        unavailable_positions: Object.values(records).flat().filter((record) => record.status !== 'downloaded').length,
        image_positions: positionCount,
        total_bytes: entries.reduce((sum, entry) => sum + (entry.kind === 'image' ? entry.bytes.byteLength : 0), 0),
      },
      warnings: dedupeWarnings(warnings),
    };
  }

  function addWarning(warnings, code, message, details) {
    if (warnings.some((warning) => warning.code === code && warning.message === message)) return;
    warnings.push({ code, message, ...(details && typeof details === 'object' ? details : {}) });
  }

  function dedupeWarnings(warnings) {
    const unique = new Map();
    for (const warning of warnings) {
      if (warning && typeof warning === 'object' && warning.code && warning.message) unique.set(`${warning.code}\u0000${warning.message}`, warning);
    }
    return [...unique.values()];
  }

  function hasSkuId(value) {
    return value !== null && value !== undefined && String(value).trim() !== '' && String(value).trim() !== '0';
  }

  function normalizePackInfo(rows) {
    if (!Array.isArray(rows)) return null;
    return rows.map((row) => {
      const { skuId: _skuId, ...value } = row || {};
      for (const key of ['length', 'width', 'height']) {
        const numeric = value[key] === null || value[key] === undefined || value[key] === '' ? NaN : Number(value[key]);
        value[key] = Number.isFinite(numeric) && numeric > 0 ? value[key] : null;
      }
      return value;
    });
  }

  function parseShippingOrigin(raw) {
    const text = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 100);
    const province = PROVINCE_PREFIXES.find((prefix) => text.startsWith(prefix)) || null;
    return {
      source_text: text || null,
      province,
      eligibility: province ? (province === '广东' || province === '浙江' ? 'eligible' : 'not_eligible') : 'unknown',
    };
  }

  function addCollectionWarnings(item, skuData, records, warnings) {
    if (!item.supplierName?.trim()) addWarning(warnings, 'supplier_missing', '未读取到供应商名称，需人工核对。');
    const shipping = parseShippingOrigin(item.shippingOrigin);
    if (shipping.eligibility === 'unknown') addWarning(warnings, 'shipping_origin_unknown', '未读取到明确发货地，无法确认是否符合广东/浙江要求。');
    else if (shipping.eligibility === 'not_eligible') addWarning(warnings, 'shipping_origin_outside_allowed_provinces', `发货地「${shipping.source_text}」不在广东/浙江范围内。`);

    const skus = Array.isArray(skuData.skus) ? skuData.skus : [];
    const packRows = Array.isArray(item.skuPackInfo) ? item.skuPackInfo : [];
    if (!skus.length) addWarning(warnings, 'sku_rows_missing', '未读取到 SKU 组合，无法核对 SKU 完整性。');
    const incompleteValueRows = skus.filter((sku) => Object.keys(sku.sku_values || {}).length < skuData.dimensions.length).length;
    if (incompleteValueRows) addWarning(warnings, 'sku_dimension_value_missing', `${incompleteValueRows} 条 SKU 的规格值未能完整映射到页面维度。`, { count: incompleteValueRows });
    const missingSkuIds = skus.filter((sku) => !hasSkuId(sku.sku_id)).length;
    if (missingSkuIds) addWarning(warnings, 'sku_id_missing', `${missingSkuIds} 条 SKU 缺少 sku_id。`, { count: missingSkuIds });
    const skuIds = skus.map((sku) => sku.sku_id).filter(hasSkuId).map(String);
    if (new Set(skuIds).size !== skuIds.length) addWarning(warnings, 'sku_id_duplicate', '检测到重复的 sku_id，请人工核对 SKU 映射。');
    const genericPackRow = packRows.length === 1 && getPackDimensionValues(packRows[0]).every((value) => !value);
    if (skus.length !== packRows.length && !genericPackRow) addWarning(warnings, 'sku_pack_count_mismatch', `SKU 组合 ${skus.length} 条，与包装信息 ${packRows.length} 条数量不一致。`, { sku_count: skus.length, pack_count: packRows.length });
    const invalidDimensionRows = packRows.filter((row) => ['length', 'width', 'height'].some((key) => {
      const numeric = row?.[key] === null || row?.[key] === undefined || row?.[key] === '' ? NaN : Number(row[key]);
      return !Number.isFinite(numeric) || numeric <= 0;
    })).length;
    if (invalidDimensionRows) addWarning(warnings, 'sku_pack_dimensions_missing', `${invalidDimensionRows} 条包装信息的长宽高缺失或为 0。`, { count: invalidDimensionRows });
    const sharedImages = new Map();
    for (const record of records.sku) {
      if (record.status !== 'downloaded' || !record.path || !record.sku_label) continue;
      if (!sharedImages.has(record.path)) sharedImages.set(record.path, new Set());
      sharedImages.get(record.path).add(record.sku_label);
    }
    const sharedLabelCount = [...sharedImages.values()].filter((labels) => labels.size > 1).length;
    if (sharedLabelCount) addWarning(warnings, 'sku_image_shared', `${sharedLabelCount} 张 SKU 图片被多个不同规格标签共用。`, { shared_image_count: sharedLabelCount });
    const failedNonSkuImages = Object.entries(records).filter(([group]) => group !== 'sku').flatMap(([, group]) => group).filter((record) => record.status === 'failed').length;
    if (failedNonSkuImages) addWarning(warnings, 'image_download_failed', `${failedNonSkuImages} 个非 SKU 图片位置未能下载，请查看 image_order.json。`, { count: failedNonSkuImages });
  }

  function buildImageOrderManifest(offerId, records) {
    const groups = ['gallery', 'sku', 'detail'];
    return {
      schema_version: 2,
      offer_id: offerId,
      content_hash_algorithm: 'MD5',
      group_order: groups,
      positions: groups.flatMap((group) => records[group].map((record) => ({
        group,
        order: record.order,
        source_url: record.original_url || null,
        archive_path: record.path || null,
        status: record.status,
        duplicate: Boolean(record.duplicate),
        ...(record.content_hash ? { content_hash: record.content_hash } : {}),
        ...(record.duplicate_of ? { duplicate_of: record.duplicate_of } : {}),
        ...(record.reason ? { reason: record.reason } : {}),
      }))),
    };
  }

  function normalizeImageUrl(raw) {
    try {
      const url = new URL(raw, location.href);
      if (url.protocol !== 'https:' || url.hostname !== IMAGE_HOST || url.username || url.password || url.port) return '';
      return url.href;
    } catch { return ''; }
  }

  async function requestImage(url, taskOfferId) {
    let response;
    try {
      response = await chrome.runtime.sendMessage({ type: 'FETCH_1688_DETAIL_FILE', url, kind: 'image', offerId: taskOfferId });
    } catch {
      throw new Error('扩展后台没有返回图片响应。');
    }
    if (!response?.ok) throw new Error(response?.error || '图片请求失败。');
    return response.result;
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
    view.counts.textContent = source ? `轮播 ${galleryCount ?? 0} · SKU ${skuCount}` : '';
    view.message.textContent = message || '';
    view.message.className = `message ${phase === 'failed' ? 'error' : phase === 'partial' ? 'warn' : ''}`.trim();
    view.bar.style.width = `${Math.max(0, Math.min(100, percent || 0))}%`;
    view.button.textContent = label[1];
    view.button.disabled = busy || phase === 'detecting' || phase === 'busy';
  }

  function setCollapsed(collapsed) {
    panel.hidden = collapsed;
    view.mini.hidden = !collapsed;
    root.classList.toggle('is-collapsed', collapsed);
    root.style.width = collapsed ? '48px' : 'min(328px,calc(100vw - 32px))';
    root.style.height = collapsed ? '48px' : 'auto';
    if (!collapsed && root.style.left !== 'auto' && root.style.left !== '') {
      const rect = root.getBoundingClientRect();
      applyPanelPosition(rect.left, rect.top);
    }
  }

  function installPanelPosition() {
    const head = shadow.querySelector('.head');
    for (const handle of [head, view.mini]) {
      handle.addEventListener('pointerdown', beginPanelDrag);
      handle.addEventListener('pointermove', movePanelDrag);
      handle.addEventListener('pointerup', finishPanelDrag);
      handle.addEventListener('pointercancel', finishPanelDrag);
    }
    head.addEventListener('keydown', movePanelWithKeyboard);
    view.mini.addEventListener('keydown', movePanelWithKeyboard);
    window.addEventListener('resize', () => {
      if (root.style.left === 'auto' || root.style.left === '') return;
      const rect = root.getBoundingClientRect();
      applyPanelPosition(rect.left, rect.top);
    });
    chrome.storage.local.get(PANEL_POSITION_KEY, (saved) => {
      if (chrome.runtime.lastError) return;
      const position = saved?.[PANEL_POSITION_KEY];
      if (Number.isFinite(position?.left) && Number.isFinite(position?.top)) applyPanelPosition(position.left, position.top);
    });
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !Object.hasOwn(changes, PANEL_POSITION_KEY)) return;
      const position = changes[PANEL_POSITION_KEY].newValue;
      if (Number.isFinite(position?.left) && Number.isFinite(position?.top)) applyPanelPosition(position.left, position.top);
    });
  }

  function beginPanelDrag(event) {
    if (event.button !== 0 || event.target.closest('button')) return;
    const rect = root.getBoundingClientRect();
    dragState = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, left: rect.left, top: rect.top, handle: event.currentTarget, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function movePanelDrag(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    const deltaX = event.clientX - dragState.startX;
    const deltaY = event.clientY - dragState.startY;
    if (!dragState.moved && Math.hypot(deltaX, deltaY) < 3) return;
    dragState.moved = true;
    if (dragState.handle === view.mini) suppressMiniClick = true;
    applyPanelPosition(dragState.left + deltaX, dragState.top + deltaY);
  }

  function finishPanelDrag(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    const moved = dragState.moved;
    dragState = undefined;
    if (!moved) return;
    const rect = root.getBoundingClientRect();
    savePanelPosition(rect.left, rect.top);
    if (suppressMiniClick) setTimeout(() => { suppressMiniClick = false; }, 0);
  }

  function movePanelWithKeyboard(event) {
    const offsets = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const offset = offsets[event.key];
    if (!offset) return;
    event.preventDefault();
    const rect = root.getBoundingClientRect();
    const step = event.shiftKey ? 30 : 10;
    applyPanelPosition(rect.left + offset[0] * step, rect.top + offset[1] * step);
    const next = root.getBoundingClientRect();
    savePanelPosition(next.left, next.top);
  }

  function applyPanelPosition(left, top) {
    const rect = root.getBoundingClientRect();
    const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
    const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
    root.style.left = `${Math.max(8, Math.min(maxLeft, left))}px`;
    root.style.top = `${Math.max(8, Math.min(maxTop, top))}px`;
    root.style.right = 'auto';
    root.style.bottom = 'auto';
  }

  function savePanelPosition(left, top) {
    try {
      const write = chrome.storage.local.set({ [PANEL_POSITION_KEY]: { left, top } });
      if (write && typeof write.catch === 'function') void write.catch(() => {});
    } catch { /* The panel remains usable if extension storage is temporarily unavailable. */ }
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
