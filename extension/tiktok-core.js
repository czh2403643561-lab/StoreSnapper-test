((root) => {
  const cleanText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
  const parseCount = (value) => {
    const match = cleanText(value).match(/\d[\d,]*/);
    return match ? Number(match[0].replace(/,/g, '')) : null;
  };

  function parseProductIdentity(value) {
    const text = cleanText(value);
    const match = text.match(/\bID\s*[:：]\s*(\d{8,})\b/i);
    return {
      productId: match?.[1] || null,
      title: match ? cleanText(text.slice(0, match.index)) : text,
    };
  }

  function money(rawValue) {
    const raw = cleanText(rawValue);
    const match = raw.match(/([£$€¥￥])\s*([\d,]+(?:\.\d+)?)(?:\s*(?:-|–|—|~|至)\s*([£$€¥￥])?\s*([\d,]+(?:\.\d+)?))?/);
    if (!match) return { raw: raw || null, currency: null, minimum: null, maximum: null };
    const currency = ({ '£': 'GBP', '$': 'USD', '€': 'EUR', '¥': 'CNY', '￥': 'CNY' })[match[1]];
    const first = match[2].replace(/,/g, '');
    const last = match[4]?.replace(/,/g, '') || first;
    return { raw: match[0].trim(), currency, minimum: first, maximum: last };
  }

  function parsePrices(value) {
    const raw = cleanText(value);
    const promotionMatch = raw.match(/(?:促销价|优惠价|活动价)\s*[:：]?\s*(.+)$/i);
    const retailRaw = promotionMatch ? raw.slice(0, promotionMatch.index).trim() : raw;
    const promotionRaw = promotionMatch ? promotionMatch[1].trim() : '';
    return {
      raw: raw || null,
      retail: money(retailRaw),
      promotion: money(promotionRaw),
    };
  }

  function parsePerformance(value) {
    const raw = cleanText(value);
    const soldMatch = raw.match(/已售出\s*([\d,]+)\s*件?/);
    const viewsMatch = raw.match(/浏览次数\s*[：:]?\s*([\d,]+)/);
    const salesMatch = raw.match(/销售额\s*[：:]?\s*(.+?)(?=\s+分析\b|$)/);
    return {
      raw: raw || null,
      sold: { raw: soldMatch?.[0] || null, value: soldMatch ? parseCount(soldMatch[1]) : null },
      views: { raw: viewsMatch?.[0] || null, value: viewsMatch ? parseCount(viewsMatch[1]) : null },
      sales: salesMatch ? money(salesMatch[1]) : { raw: null, currency: null, minimum: null, maximum: null },
    };
  }

  function parsePagination({ totalText, pageSizeText, activePageText, activePageLabel } = {}) {
    const pageLabel = cleanText(activePageLabel);
    const pageMatch = pageLabel.match(/第\s*(\d+)\s*页/) || cleanText(activePageText).match(/^\d+$/);
    const currentPage = pageMatch ? Number(pageMatch[1]) : null;
    const totalRows = parseCount(totalText);
    const pageSize = parseCount(pageSizeText);
    const totalPages = totalRows !== null && pageSize ? Math.ceil(totalRows / pageSize) : null;
    const expectedRows = totalRows !== null && pageSize && currentPage
      ? Math.max(0, Math.min(pageSize, totalRows - ((currentPage - 1) * pageSize)))
      : null;
    return { currentPage, totalRows, pageSize, totalPages, expectedRows };
  }

  function buildProductRecord(input = {}) {
    const productId = cleanText(input.productId) || null;
    const title = cleanText(input.title) || null;
    const imageUrl = cleanText(input.imageUrl) || null;
    const imageStatus = input.imageStatus || (imageUrl ? 'loading' : 'missing');
    const statusRaw = cleanText(input.statusRaw) || null;
    const price = parsePrices(input.priceRaw);
    const performance = parsePerformance(input.performanceRaw);
    const inventoryRaw = cleanText(input.inventoryRaw) || null;
    const skuRaw = cleanText(input.skuRaw) || null;
    const skuMatch = skuRaw?.match(/([\d,]+)\s*个?\s*SKU/i);
    const skuCount = skuMatch ? parseCount(skuMatch[1]) : null;
    const missingFields = [];
    if (!productId) missingFields.push('product_id');
    if (!title) missingFields.push('title');
    if (!imageUrl) missingFields.push('main_image_url');
    if (imageUrl && imageStatus !== 'loaded') missingFields.push('main_image_loaded');
    if (!price.retail.minimum) missingFields.push('retail_price');
    if (!inventoryRaw) missingFields.push('inventory');
    if (performance.sold.value === null) missingFields.push('sold_count');
    if (performance.views.value === null) missingFields.push('views');
    if (!performance.sales.minimum) missingFields.push('sales_amount');
    if (skuCount === null) missingFields.push('sku_count');
    if (!statusRaw) missingFields.push('status');

    return {
      product_id: productId,
      title,
      main_image: { url: imageUrl, load_status: imageStatus },
      status: { raw: statusRaw },
      retail_price: price.retail,
      promotional_price: price.promotion,
      price_raw: price.raw,
      inventory: { raw: inventoryRaw, value: inventoryRaw ? parseCount(inventoryRaw) : null },
      sold_count: performance.sold,
      views: performance.views,
      sales_amount: performance.sales,
      sku_count: { raw: skuRaw, value: skuCount },
      source: input.source || {},
      captured_at: input.capturedAt || new Date().toISOString(),
      missing_fields: missingFields,
    };
  }

  function evaluatePage({
    expectedRows,
    productIds = [],
    atBottom = false,
    stablePasses = 0,
    pendingImages = 0,
    failedImages = 0,
    missingCriticalRecords = 0,
    unidentifiedRows = 0,
    timedOut = false,
  } = {}) {
    const uniqueCount = new Set(productIds.filter(Boolean).map(String)).size;
    const reasons = [];
    if (timedOut) reasons.push('采集等待超时');
    if (!atBottom) reasons.push('尚未确认滚动到本页底部');
    if (stablePasses < 2) reasons.push('页面内容尚未稳定');
    if (expectedRows === null || expectedRows === undefined) reasons.push('无法读取本页可靠的预计商品数量');
    else if (uniqueCount !== expectedRows) reasons.push(`本页预计 ${expectedRows} 条，当前识别 ${uniqueCount} 条`);
    if (pendingImages) reasons.push(`${pendingImages} 张商品主图仍在加载`);
    if (failedImages) reasons.push(`${failedImages} 张商品主图加载失败`);
    if (missingCriticalRecords) reasons.push(`${missingCriticalRecords} 条商品缺少 ID、标题、主图、售价或库存`);
    if (unidentifiedRows) reasons.push(`${unidentifiedRows} 条疑似商品行缺少商品 ID`);
    return { status: reasons.length ? 'needs_review' : 'complete', uniqueCount, reasons };
  }

  function countIncompleteProducts(products = []) {
    const critical = ['product_id', 'title', 'main_image_url', 'retail_price', 'inventory'];
    return products.filter((product) => critical.some((field) => product.missing_fields?.includes(field))).length;
  }

  function isEntireCollectionComplete(pages, totalPages) {
    if (!Array.isArray(pages) || !Number.isInteger(totalPages) || totalPages < 1) return false;
    const byNumber = new Map(pages.map((page) => [Number(page.page_number), page]));
    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
      if (byNumber.get(pageNumber)?.status !== 'complete') return false;
    }
    return true;
  }

  function stableScopeFingerprint({ pathname, search, filters = [] } = {}) {
    const params = new URLSearchParams(search || '');
    for (const key of [...params.keys()]) {
      if (/^(?:page|p|page_no|page_num|page_number|offset|cursor)$/i.test(key)) params.delete(key);
    }
    const filterText = filters.map(cleanText).filter(Boolean).sort().join('|');
    const source = `${cleanText(pathname)}?${[...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('&')}|${filterText}`;
    let hash = 2166136261;
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  const api = {
    buildProductRecord,
    countIncompleteProducts,
    evaluatePage,
    isEntireCollectionComplete,
    parseCount,
    parsePagination,
    parsePerformance,
    parsePrices,
    parseProductIdentity,
    stableScopeFingerprint,
  };
  root.StoreSnapperTikTokCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
