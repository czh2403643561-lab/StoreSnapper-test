(() => {
  if (!/^\/offer\/\d{8,}\.html$/i.test(location.pathname)) return;

  const IMAGE_HOST = 'cbu01.alicdn.com';
  const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
  const PANEL_POSITION_KEY = 'storesnapper1688DetailPanelPosition';
  const ATTRIBUTE_WHITELIST = new Set(['筒高', '图案', '适用性别', '适合季节', '包装形式', '产品类别']);
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
      const detailResult = await readDetailImageUrls();
      if (taskOfferId !== getOfferId()) throw new Error('页面商品已变化，请对当前商品重新采集。');
      setUi({ phase: 'busy', message: '正在读取 SKU 规格…', percent: 16 });
      const skuData = await collectSkuData(taskOfferId);
      skuData.skus = mergeSkuVariants(skuData.skus, skuData.dimensions, source.skuVariants);
      records.detail.push(...detailResult.failures);
      const sources = [
        ['gallery', (source.gallery || []).map((url) => ({ url, sourceUrl: url }))],
        ['sku', skuData.images],
        ['detail', detailResult.images.map((image) => typeof image === 'string' ? { url: image, sourceUrl: image } : image)],
      ];
      const candidates = [];
      for (const [group, list] of sources) {
        let order = 0;
        for (const image of list) {
          const rawUrl = typeof image === 'string' ? image : image?.url;
          const skuLabel = group === 'sku' && image?.label ? image.label : '';
          if (image?.sourceStatus) {
            records[group].push({ original_url: image.sourceUrl || null, path: null, order, status: image.sourceStatus, reason: image.reason, ...(skuLabel ? { sku_label: skuLabel } : {}) });
            order += 1;
            continue;
          }
          const url = normalizeImageUrl(image?.requestUrl || rawUrl);
          const fallbackUrl = normalizeImageUrl(image?.fallbackUrl || '');
          if (!url) {
            const reason = '图片地址无效或域名不在范围内';
            records[group].push({ original_url: String(rawUrl || '').slice(0, 500) || null, path: null, order, status: 'failed', reason, ...(skuLabel ? { sku_label: skuLabel } : {}) });
            order += 1;
            continue;
          }
          candidates.push({ group, url, sourceUrl: image?.sourceUrl || rawUrl, order, ...(fallbackUrl && fallbackUrl !== url ? { fallbackUrl } : {}), ...(skuLabel ? { skuLabel } : {}) });
          order += 1;
        }
      }
      const uniqueCount = new Set(candidates.map((item) => item.url)).size;
      setUi({ phase: 'busy', message: `已解析 ${candidates.length} 个图片位置，去重后 ${uniqueCount} 个文件。`, percent: 20 });

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
          continue;
        }
        setUi({ phase: 'busy', message: `正在下载图片 ${index + 1}/${candidates.length}…`, percent: 20 + Math.round(68 * ((index + 1) / Math.max(1, candidates.length))) });
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
        }
      }
      if (taskOfferId !== getOfferId()) throw new Error('页面商品已变化，请对当前商品重新采集。');
      for (const group of Object.values(records)) group.sort((left, right) => left.order - right.order);
      const packageInfo = summarizePackage(source.skuPackInfo, skuData.skus);
      addCollectionWarnings(skuData, records, packageInfo, warnings);
      const imageOrder = buildImageOrderManifest(taskOfferId, records);
      entries.push({ path: 'image_order.json', bytes: new TextEncoder().encode(JSON.stringify(imageOrder, null, 2)), kind: 'manifest' });
      const successes = Object.values(groupFileCounts).reduce((sum, count) => sum + count, 0);
      const firstImageFailure = Object.values(records).flat().find((record) => record.status === 'failed' && record.reason)?.reason;
      if (!successes) throw new Error(firstImageFailure || '没有发现可下载的商品图片，请检查页面后重试。');
      const positionCount = Object.values(records).reduce((count, group) => count + group.length, 0);
      const failureCount = Object.values(records).flat().filter((record) => record.status === 'failed' || record.status === 'source_none' || record.status === 'not_rendered').length;
      const product = buildProductJson(source, skuData, packageInfo, records, warnings, successes, positionCount);
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

  async function readDetailImageUrls() {
    if (!source?.descriptionUrl) {
      const reason = '页面未提供详情内容地址。';
      return { images: [], failures: [{ original_url: null, path: null, order: 0, status: 'failed', reason }] };
    }
    const detailUrl = normalizeDetailUrl(source.descriptionUrl);
    if (!detailUrl) {
      const reason = '详情内容地址无效或域名不在范围内。';
      return { images: [], failures: [{ original_url: source.descriptionUrl, path: null, order: 0, status: 'failed', reason }] };
    }
    setUi({ phase: 'busy', message: '正在读取详情图片…', percent: 14 });
    const response = await chrome.runtime.sendMessage({ type: 'FETCH_1688_DETAIL_FILE', url: detailUrl, kind: 'detail', offerId: source.offerId }).catch(() => undefined);
    if (!response?.ok) {
      const reason = response?.error || '详情内容读取失败。';
      return { images: [], failures: [{ original_url: detailUrl, path: null, order: 0, status: 'failed', reason }] };
    }
    let payload;
    try {
      const match = response.result.text.match(/^\s*var\s+offer_details\s*=\s*([\s\S]*?)\s*;\s*$/);
      if (!match) throw new Error('详情内容格式无法识别');
      payload = JSON.parse(match[1]);
    } catch (error) {
      const reason = error?.message || '详情内容解析失败。';
      return { images: [], failures: [{ original_url: detailUrl, path: null, order: 0, status: 'failed', reason }] };
    }
    const html = typeof payload?.content === 'string' ? payload.content : '';
    if (!html) {
      const reason = '详情内容为空。';
      return { images: [], failures: [{ original_url: detailUrl, path: null, order: 0, status: 'failed', reason }] };
    }
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const images = [...parsed.querySelectorAll('img')];
    const result = [];
    for (const image of images) {
      const raw = ['src', 'data-src', 'data-lazyload-src', 'data-original', 'data-img', 'lazy-src']
        .map((key) => image.getAttribute(key)).find(Boolean);
      result.push(raw ? raw : { sourceStatus: 'failed', sourceUrl: detailUrl, reason: '详情图标签没有可用的图片地址。' });
    }
    if (!images.length) {
      const reason = images.length ? '详情图片地址未能解析。' : '详情内容中没有图片标签。';
      return { images: result, failures: [{ original_url: detailUrl, path: null, order: 0, status: 'failed', reason }] };
    }
    return { images: result, failures: [] };
  }

  async function collectSkuData(taskOfferId) {
    const container = document.querySelector('#skuSelection');
    const variantButtons = () => [...(container?.querySelectorAll('.sku-filter-button') || [])];
    const getRows = () => [...(container?.querySelectorAll('.expand-view-list-wrapper .expand-view-item') || [])];
    const dimensions = (source.skuDimensions?.length
      ? source.skuDimensions
      : [...(container?.querySelectorAll('.feature-item-label h3') || [])].map((element) => cleanText(element.innerText)).filter(Boolean))
      .map(cleanText).filter(Boolean);
    const dimensionKeys = makeDimensionKeys(dimensions);
    const skusByKey = new Map();
    const initialButtons = variantButtons();
    const originalIndex = initialButtons.findIndex((button) => button.classList.contains('active'));

    const valuesFor = (variantLabel, row) => {
      const rowValues = row
        ? [...row.querySelectorAll('.item-label')].map((element) => cleanText(element.innerText || element.getAttribute('title'))).filter(Boolean)
        : [];
      return [...(variantLabel ? [cleanText(variantLabel)] : []), ...rowValues];
    };

    const upsertSku = (row, variantLabel) => {
      const priceValues = [...row.querySelectorAll('.item-price-stock')].map((element) => cleanText(element.innerText || element.textContent));
      const dimensionValues = valuesFor(variantLabel, row);
      const skuValues = Object.fromEntries(dimensionKeys.flatMap((key, index) => dimensionValues[index] ? [[key, dimensionValues[index]]] : []));
      const variant = dimensions.map((_, index) => dimensionValues[index]).filter(Boolean).join(' / ') || dimensionValues.filter(Boolean).join(' / ') || null;
      if (!variant && !priceValues.length) return null;
      const record = {
        variant,
        sku_values: skuValues,
        price: priceValues[0] || null,
        weight_g: null,
      };
      const key = dimensionValues.some((value) => normalizeSkuValue(value))
        ? dimensionValues.map(normalizeSkuValue).join('\u0000')
        : `${record.price || ''}`;
      const previous = skusByKey.get(key);
      skusByKey.set(key, previous ? {
        ...previous,
        ...record,
        price: record.price || previous.price,
        weight_g: previous.weight_g ?? record.weight_g,
      } : record);
      return record;
    };

    const skuImages = collectFirstDimensionImages(container);

    const scanCurrentRows = (variantLabel) => {
      const rows = getRows();
      if (!rows.length && variantLabel) {
        const dimensionValues = valuesFor(variantLabel, null);
        const record = {
          variant: dimensions.map((_, index) => dimensionValues[index]).filter(Boolean).join(' / ') || dimensionValues.filter(Boolean).join(' / ') || null,
          sku_values: Object.fromEntries(dimensionKeys.flatMap((key, index) => dimensionValues[index] ? [[key, dimensionValues[index]]] : [])),
          price: null,
          weight_g: null,
        };
        const key = dimensionValues.map(normalizeSkuValue).join('\u0000');
        if (key) skusByKey.set(key, { ...record, ...skusByKey.get(key), weight_g: skusByKey.get(key)?.weight_g ?? record.weight_g });
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
        if (activeIndex !== index) continue;
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
        for (let index = 0; index + 1 < cells.length; index += 2) {
          const name = cells[index];
          const value = cells[index + 1];
          if (ATTRIBUTE_WHITELIST.has(name) && value) attributes.push({ name, value });
        }
        continue;
      }
      const text = cleanText(row.innerText || row.textContent);
      const match = text.match(/^([^:：]{1,80})\s*[:：]\s*(.{1,300})$/);
      if (match && ATTRIBUTE_WHITELIST.has(match[1])) attributes.push({ name: match[1], value: match[2] });
    }
    return {
      images: skuImages,
      firstDimensionLabels: [...new Set(skuImages.map((image) => image.label).filter(Boolean))],
      dimensions,
      skus: [...skusByKey.values()],
      attributes,
    };
  }

  function collectFirstDimensionImages(container) {
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

  function mergeSkuVariants(skus, dimensions, sourceVariants) {
    const variants = Array.isArray(sourceVariants) ? sourceVariants.filter((entry) => Array.isArray(entry?.values) && entry.values.length) : [];
    const dimensionCount = dimensions.length || variants.reduce((max, entry) => Math.max(max, entry.values.length), 0);
    const keys = makeDimensionKeys(dimensions, dimensionCount);
    const catalog = variants.filter((entry) => entry.values.length === dimensionCount && entry.values.every(Boolean));
    if (!catalog.length) return skus;

    const catalogByTuple = new Map(catalog.map((entry) => [skuTupleKey(entry.values), entry]));
    const merged = new Map();
    for (const sku of skus) {
      const values = keys.map((key) => sku.sku_values?.[key] || '');
      if (values.length !== dimensionCount || values.some((value) => !value)) continue;
      const tupleKey = skuTupleKey(values);
      const sourceVariant = catalogByTuple.get(tupleKey);
      const normalizedValues = sourceVariant?.values || values;
      merged.set(tupleKey, {
        ...sku,
        variant: normalizedValues.map(cleanText).join(' / '),
        sku_values: Object.fromEntries(keys.map((key, index) => [key, cleanText(normalizedValues[index])])),
      });
    }
    for (const entry of catalog) {
      const tupleKey = skuTupleKey(entry.values);
      if (merged.has(tupleKey)) continue;
      merged.set(tupleKey, {
        variant: entry.values.map(cleanText).join(' / '),
        sku_values: Object.fromEntries(keys.map((key, index) => [key, cleanText(entry.values[index])])),
        price: null,
        weight_g: null,
      });
    }
    return [...merged.values()];
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

  function buildProductJson(item, skuData, packageInfo, records, warnings, successfulFiles, positionCount) {
    const skus = skuData.skus.map((sku) => ({
      variant: sku.variant || null,
      sku_values: sku.sku_values || {},
      price: sku.price ?? null,
      weight_g: positiveNumber(sku.weight_g),
    }));
    const hasSkuPrices = skus.some((sku) => sku.price !== null && String(sku.price).trim() !== '');
    const compactImages = Object.fromEntries(['gallery', 'sku', 'detail'].map((group) => [group, records[group].map((record) => ({
      order: record.order,
      path: record.path || null,
      status: record.status,
      duplicate: Boolean(record.duplicate),
      ...(record.duplicate_of ? { duplicate_of: record.duplicate_of } : {}),
      ...(record.content_hash ? { content_hash: record.content_hash } : {}),
      ...(record.sku_label ? { sku_label: record.sku_label } : {}),
      ...(record.reason ? { reason: record.reason } : {}),
    }))]));
    const product = {
      schema_version: 5,
      offer_id: item.offerId,
      source_url: item.sourceUrl,
      title: item.title || null,
      ...(item.shippingOrigin?.trim() ? { shipping_origin: item.shippingOrigin.trim() } : {}),
      sku_images_scope: 'first_dimension',
      sku_dimensions: skuData.dimensions,
      skus,
      package: packageInfo,
      attributes: skuData.attributes,
      images: compactImages,
      collection: {
        successful_files: successfulFiles,
        failed_positions: Object.values(records).flat().filter((record) => record.status === 'failed').length,
        image_positions: positionCount,
      },
      warnings: dedupeWarnings(warnings),
    };
    if (!hasSkuPrices && Array.isArray(item.priceTiers) && item.priceTiers.length) product.price_fallback = item.priceTiers;
    return product;
  }

  function addWarning(warnings, code, message, details) {
    if (!['image_download_failed', 'sku_image_missing', 'package_dimensions_missing'].includes(code)) return;
    if (warnings.some((warning) => warning.code === code)) return;
    warnings.push({ code, message, ...(details && typeof details === 'object' ? details : {}) });
  }

  function dedupeWarnings(warnings) {
    const unique = new Map();
    for (const warning of warnings) {
      if (warning && typeof warning === 'object' && warning.code && warning.message) unique.set(warning.code, warning);
    }
    return [...unique.values()];
  }

  function positiveNumber(value) {
    const number = value === null || value === undefined || value === '' ? NaN : Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  function commonPositiveNumber(values) {
    const numbers = values.map(positiveNumber);
    if (!numbers.length || numbers.some((value) => value === null)) return null;
    const unique = [...new Set(numbers)];
    return unique.length === 1 ? unique[0] : null;
  }

  function summarizePackage(packRows, skus) {
    const rows = Array.isArray(packRows) ? packRows : [];
    const skuWeight = commonPositiveNumber(skus.map((sku) => sku.weight_g));
    const packWeight = commonPositiveNumber(rows.map((row) => row?.weight));
    const packageInfo = {
      length: commonPositiveNumber(rows.map((row) => row?.length)),
      width: commonPositiveNumber(rows.map((row) => row?.width)),
      height: commonPositiveNumber(rows.map((row) => row?.height)),
      weight_g: skuWeight ?? packWeight,
    };
    const fallbackSkuWeight = skuWeight ?? packWeight;
    for (const sku of skus) sku.weight_g = positiveNumber(sku.weight_g) ?? fallbackSkuWeight;
    return packageInfo;
  }

  function addCollectionWarnings(skuData, records, packageInfo, warnings) {
    const failedPositions = Object.values(records).flat().filter((record) => record.status === 'failed').length;
    if (failedPositions) addWarning(warnings, 'image_download_failed', `${failedPositions} 个图片位置下载失败或不可用，请查看 image_order.json。`, { failed_positions: failedPositions });

    const firstDimensionKey = makeDimensionKeys(skuData.dimensions)[0];
    const skuLabels = skuData.firstDimensionLabels.length
      ? skuData.firstDimensionLabels
      : [...new Set(skuData.skus.map((sku) => sku.sku_values?.[firstDimensionKey]).filter(Boolean))];
    const downloadedLabels = new Set(records.sku
      .filter((record) => record.status === 'downloaded' && record.path && record.sku_label)
      .map((record) => normalizeSkuValue(record.sku_label)));
    const missingLabels = skuLabels.filter((label) => !downloadedLabels.has(normalizeSkuValue(label)));
    if (missingLabels.length) {
      addWarning(warnings, 'sku_image_missing', `${missingLabels.length} 个规格标签没有可用 SKU 图片。`, { sku_labels: missingLabels });
    }

    const missingDimensions = ['length', 'width', 'height', 'weight_g'].filter((key) => packageInfo[key] === null);
    if (missingDimensions.length) {
      addWarning(warnings, 'package_dimensions_missing', '商品级包裹尺寸或重量不完整，缺失项已留空。', { missing_fields: missingDimensions });
    }
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
        ...(record.sku_label ? { sku_label: record.sku_label } : {}),
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
