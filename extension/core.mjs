const MTOP_APP_KEY = '12574478';
const IMAGE_UPLOAD_API = 'mtop.1688.imageService.putImage';
const IMAGE_UPLOAD_URL = 'https://h5api.m.1688.com/h5/mtop.1688.imageservice.putimage/1.0/';
const IMAGE_SEARCH_URL = 'https://search.1688.com/service/imageSearchOfferResultViewService';

export class SearchFailure extends Error {
  constructor(code, message, issue) {
    super(message);
    this.name = 'SearchFailure';
    this.code = code;
    this.issue = issue;
  }
}

export function md5(input) {
  const shifts = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const constants = Array.from({ length: 64 }, (_, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 0x1_0000_0000) >>> 0);
  const source = new TextEncoder().encode(input);
  const paddedLength = Math.ceil((source.length + 9) / 64) * 64;
  const bytes = new Uint8Array(paddedLength);
  bytes.set(source);
  bytes[source.length] = 0x80;
  const bitLength = BigInt(source.length) * 8n;
  for (let index = 0; index < 8; index += 1) bytes[paddedLength - 8 + index] = Number((bitLength >> BigInt(index * 8)) & 0xffn);

  const rotateLeft = (value, shift) => ((value << shift) | (value >>> (32 - shift))) >>> 0;
  const wordHex = (value) => [0, 8, 16, 24].map((shift) => ((value >>> shift) & 0xff).toString(16).padStart(2, '0')).join('');
  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let offset = 0; offset < bytes.length; offset += 64) {
    const words = new Uint32Array(16);
    for (let index = 0; index < 16; index += 1) {
      const start = offset + index * 4;
      words[index] = (bytes[start] | (bytes[start + 1] << 8) | (bytes[start + 2] << 16) | (bytes[start + 3] << 24)) >>> 0;
    }
    let a = a0; let b = b0; let c = c0; let d = d0;
    for (let index = 0; index < 64; index += 1) {
      let f; let wordIndex;
      if (index < 16) { f = (b & c) | (~b & d); wordIndex = index; }
      else if (index < 32) { f = (d & b) | (~d & c); wordIndex = (5 * index + 1) % 16; }
      else if (index < 48) { f = b ^ c ^ d; wordIndex = (3 * index + 5) % 16; }
      else { f = c ^ (b | ~d); wordIndex = (7 * index) % 16; }
      const previousD = d;
      d = c;
      c = b;
      b = (b + rotateLeft((a + f + constants[index] + words[wordIndex]) >>> 0, shifts[index])) >>> 0;
      a = previousD;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }
  return wordHex(a0) + wordHex(b0) + wordHex(c0) + wordHex(d0);
}

function cleanText(value) {
  return value === null || value === undefined || typeof value === 'object' ? '' : String(value).replace(/\s+/g, ' ').trim();
}

function objectValue(source, keys) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return undefined;
  for (const key of keys) {
    const actual = Object.keys(source).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
    if (actual && source[actual] !== undefined && source[actual] !== null && source[actual] !== '') return source[actual];
  }
  return undefined;
}

function pathValue(source, paths) {
  for (const path of paths) {
    let value = source;
    for (const part of path.split('.')) value = value && typeof value === 'object' ? objectValue(value, [part]) : undefined;
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function displayText(raw, keys = ['display', 'text', 'value', 'name', 'title', 'label'], depth = 0) {
  if (depth > 4 || raw === null || raw === undefined) return '';
  const primitive = cleanText(raw);
  if (primitive) return primitive;
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const text = displayText(item, keys, depth + 1);
      if (text) return text;
    }
    return '';
  }
  if (typeof raw !== 'object') return '';
  for (const key of keys) {
    const text = displayText(objectValue(raw, [key]), keys, depth + 1);
    if (text) return text;
  }
  return '';
}

function textFromPaths(source, paths, keys) {
  for (const path of paths) {
    const text = displayText(pathValue(source, [path]), keys);
    if (text) return text;
  }
  return '';
}

function imageUrlFrom(raw, depth = 0) {
  if (depth > 4 || raw === null || raw === undefined) return '';
  const direct = cleanText(raw);
  if (/^(?:https?:)?\/\//i.test(direct)) return direct.startsWith('//') ? `https:${direct}` : direct;
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const value = imageUrlFrom(item, depth + 1);
      if (value) return value;
    }
    return '';
  }
  if (typeof raw !== 'object') return '';
  for (const key of ['url', 'imageUrl', 'image_url', 'src', 'originUrl', 'original', 'originalUrl', 'bigImage', 'mainImage', 'productImage', 'picUrl']) {
    const value = imageUrlFrom(objectValue(raw, [key]), depth + 1);
    if (value) return value;
  }
  return '';
}

function numericValue(raw) {
  const text = displayText(raw, ['display', 'value', 'count', 'num', 'amount', 'text']).replace(/,/g, '');
  const match = text.match(/(\d+(?:\.\d+)?)\s*([万千KkMm])?/);
  if (!match) return undefined;
  const multiplier = match[2] === '万' ? 10000 : match[2] === '千' || match[2]?.toLowerCase() === 'k' ? 1000 : match[2]?.toLowerCase() === 'm' ? 1_000_000 : 1;
  const value = Number(match[1]) * multiplier;
  return Number.isFinite(value) ? value : undefined;
}

function formatPrice(raw) {
  const text = displayText(raw, ['display', 'price', 'value', 'minPrice', 'min', 'text']);
  const values = [...text.matchAll(/\d+(?:\.\d+)?/g)].map((match) => Number(match[0])).filter(Number.isFinite);
  if (!values.length) return undefined;
  const min = Math.min(...values); const max = Math.max(...values);
  const money = (value) => `¥${value.toFixed(2).replace(/\.00$/, '')}`;
  return { display: min === max ? money(min) : `${money(min)}–${money(max)}`, min, max, kind: 'page-quote' };
}

function normalizedDisplay(raw, suffix = '') {
  const text = displayText(raw, ['display', 'value', 'text', 'count', 'num', 'amount', 'name', 'title']);
  return text ? `${text}${suffix && !text.includes(suffix) ? suffix : ''}` : undefined;
}

function percentDisplay(raw) {
  const text = displayText(raw, ['display', 'value', 'rate', 'ratio', 'text']);
  const numeric = numericValue(raw);
  if (!text || numeric === undefined) return {};
  const value = numeric > 0 && numeric <= 1 && !text.includes('%') ? numeric * 100 : numeric;
  return { display: `${Number(value.toFixed(2))}%`, value };
}

function offerId(offer) {
  const direct = cleanText(pathValue(offer, ['id', 'offerId', 'offer_id', 'productId', 'product_id', 'sku_id', 'skuId', 'itemId', 'information.id']));
  if (/^\d{8,}$/.test(direct)) return direct;
  const link = cleanText(pathValue(offer, ['href', 'real_url', 'realUrl', 'detailUrl', 'productUrl', 'url', 'information.productUrl']));
  return link.match(/(?:offer\/|offerId=|[?&](?:id|offer_id)=)(\d{8,})/i)?.[1] ?? '';
}

export function normalizeOfficialOffer(offer) {
  const id = offerId(offer);
  if (!id) return undefined;
  const imageRaw = pathValue(offer, ['picture', 'imageUrl', 'mainImage', 'picUrl', 'imgUrl', 'offerPicUrl', 'image.productImage', 'image.url', 'image', 'pictures', 'media']);
  const image = imageUrlFrom(imageRaw);
  const price = formatPrice(pathValue(offer, ['price', 'priceDisplay', 'tradePrice.price', 'priceInfo.price', 'showPrice', 'discountPrice', 'priceInfo', 'tradePrice']));
  const salesRaw = pathValue(offer, ['yearSales', 'yearSale', 'annualSales', 'monthSold', 'monthSales', 'saleQuantity', 'sold', 'soldCount', 'salesCount', 'tradeQuantity', 'bookedCount', 'sales']);
  const repurchase = percentDisplay(pathValue(offer, ['repurchaseRate', 'repurchaseRatio', 'repeatPurchaseRate', 'repeatPurchaseRatio', 'returnRate']));
  const minimumRaw = pathValue(offer, ['minOrderQuantity', 'minOrder', 'tradePrice.minOrder', 'quantityBegin', 'beginAmount', 'moq']);
  const years = normalizedDisplay(pathValue(offer, ['shops.opened_year', 'shops.tpyear', 'shops.tpYear', 'supplier.supplierYear', 'supplier.tpYear', 'supplierYear', 'tpYear', 'companyYear', 'shopInfo.tpYear', 'companyInfo.tpYear']));
  const title = textFromPaths(offer, ['title', 'subject', 'offerTitle', 'information.title', 'productInfo'], ['display', 'text', 'value', 'name', 'title', 'label']);
  const supplier = textFromPaths(offer, ['shops.shop_name', 'shops.company_name', 'supplier.supplierName', 'supplier.companyName', 'supplierName', 'companyName', 'shopName', 'sellerName', 'shopInfo.shopName', 'companyInfo.companyName'], ['shop_name', 'company_name', 'supplierName', 'shopName', 'name', 'companyName', 'display', 'text', 'value']);
  const badgesRaw = pathValue(offer, ['badges', 'tags', 'offerIdentities', 'sellerIdentities', 'serviceTags', 'tagList']);
  const badges = Array.isArray(badgesRaw) ? badgesRaw.map((item) => displayText(item, ['text', 'name', 'label', 'title', 'value'])).filter(Boolean).slice(0, 4) : [];
  const safeImage = (() => {
    try { const url = new URL(image); return url.protocol === 'https:' ? url.href : ''; } catch { return ''; }
  })();
  return {
    offer_id: id,
    title,
    image_url: safeImage,
    detail_url: `https://detail.1688.com/offer/${id}.html`,
    price,
    sales: normalizedDisplay(salesRaw),
    sales_value: numericValue(salesRaw),
    minimum_order: normalizedDisplay(minimumRaw, '件起批'),
    repurchase_rate: repurchase.display,
    repurchase_rate_value: repurchase.value,
    shipping_time: normalizedDisplay(pathValue(offer, ['shippingTimeGuarantee', 'shipSpeed', 'shipTime', 'deliveryTime', 'fahuoTime', 'shipWithinHours', 'deliveryPromise', 'shippingInfo'])),
    supplier_years: years ? (/年/.test(years) ? years : `入驻${years}年`) : undefined,
    listed_at: normalizedDisplay(pathValue(offer, ['createDate', 'publishTime', 'listedAt', 'onlineTime', 'addTime', 'offerCreateTime'])),
    supplier_name: supplier,
    badges,
  };
}

export function parseResponseText(text) {
  const trimmed = String(text || '').trim();
  const sample = trimmed.slice(0, 250_000);
  if (/_____tmd_____|(?:\/|\b)punish(?:\/|\b)|["']action["']\s*:\s*["']captcha|x5secdata|验证码|安全验证/i.test(sample)) {
    throw new SearchFailure('auth', '1688暂时要求完成安全验证，请在 1688 页面处理后重试。', 'challenge');
  }
  if (/<(?:html|script)\b/i.test(sample) && /login\.1688\.com|member\/signin|请登录|登录后继续/i.test(sample)) {
    throw new SearchFailure('auth', '请先在 1688 登录，再重新搜索。', 'login');
  }
  try { return JSON.parse(trimmed); } catch { /* JSONP fallback */ }
  const start = trimmed.indexOf('(');
  const end = trimmed.lastIndexOf(')');
  if (start >= 0 && end > start) {
    try { return JSON.parse(trimmed.slice(start + 1, end)); } catch { /* handled below */ }
  }
  throw new SearchFailure('failed', '1688返回了无法识别的数据格式。');
}

function responseError(data) {
  const values = Array.isArray(data?.ret) ? data.ret : [data?.ret, data?.msg, data?.message];
  return values.filter(Boolean).map(String).join('；');
}

function authFailure(data) {
  const message = responseError(data);
  if (/TOKEN|SESSION_EXPIRED|NOT_LOGIN|登录/i.test(message)) return new SearchFailure('auth', '1688登录状态已失效，请重新登录后重试。', 'session');
  if (/FAIL_SYS_USER_VALIDATE|RGV587|CAPTCHA|安全|验证|PUNISH|X5SECDATA/i.test(message)) return new SearchFailure('auth', '1688暂时要求完成安全验证，请在 1688 页面处理后重试。', 'challenge');
  return undefined;
}

export function findImageSession(value, depth = 0) {
  if (!value || depth > 8) return undefined;
  if (Array.isArray(value)) {
    for (const item of value) { const found = findImageSession(item, depth + 1); if (found) return found; }
    return undefined;
  }
  if (typeof value !== 'object') return undefined;
  const imageId = cleanText(value.imageId ?? value.image_id ?? value.result);
  if (imageId.length >= 8) {
    return { image_id: imageId, request_id: cleanText(value.requestId) || undefined, session_id: cleanText(value.sessionId) || undefined };
  }
  for (const child of Object.values(value)) { const found = findImageSession(child, depth + 1); if (found) return found; }
  return undefined;
}

export function parseImageSessionResponse(data) {
  const session = findImageSession(data);
  if (session) return session;
  const auth = authFailure(data);
  if (auth) throw auth;
  throw new SearchFailure('failed', responseError(data) || '1688没有返回图片识别编号。');
}

export function findOfferPayload(value, depth = 0) {
  if (!value || depth > 8) return undefined;
  if (typeof value === 'object' && !Array.isArray(value)) {
    const offers = value.offerList ?? value.offers;
    if (Array.isArray(offers)) return { offers, pageCount: Number(value.pageCount) || undefined, requestId: cleanText(value.requestId), sessionId: cleanText(value.sessionId) };
    for (const child of Object.values(value)) { const found = findOfferPayload(child, depth + 1); if (found) return found; }
  }
  if (Array.isArray(value)) {
    for (const child of value) { const found = findOfferPayload(child, depth + 1); if (found) return found; }
  }
  return undefined;
}

export function parseSearchResponseText(text, session, pageSize = 20) {
  const data = parseResponseText(text);
  const auth = authFailure(data);
  if (auth) throw auth;
  const payload = findOfferPayload(data);
  if (!payload) throw new SearchFailure('failed', responseError(data) || '1688图搜结果结构暂时无法识别。');
  const results = payload.offers.map(normalizeOfficialOffer).filter(Boolean);
  if (payload.offers.length && !results.length) throw new SearchFailure('failed', '1688返回了候选货源，但暂时无法识别商品编号。');
  return {
    results,
    session: { image_id: session.image_id, request_id: payload.requestId || session.request_id, session_id: payload.sessionId || session.session_id },
    has_more: payload.pageCount ? 1 < payload.pageCount : payload.offers.length >= pageSize,
    raw_offer_count: payload.offers.length,
  };
}

export function buildSearchUrl(session, page = 1, pageSize = 20) {
  const url = new URL(IMAGE_SEARCH_URL);
  const params = {
    tab: 'imageSearch', imageId: session.image_id, imageIdList: session.image_id,
    filt: 'y', beginPage: String(page), pageSize: String(pageSize), pageName: 'image',
  };
  if (session.request_id) params.requestId = session.request_id;
  if (session.session_id) params.sessionId = session.session_id;
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url.href;
}

export function officialSearchPageUrl(session) {
  const url = new URL('https://air.1688.com/kapp/1688-search/pc-image-search/?tab=imageSearch');
  url.searchParams.set('imageId', session.image_id);
  url.searchParams.set('imageIdList', session.image_id);
  if (session.request_id) url.searchParams.set('requestId', session.request_id);
  if (session.session_id) url.searchParams.set('sessionId', session.session_id);
  return url.href;
}

export function mergeOfficialResults(apiResults, officialResults) {
  const apiById = new Map(apiResults.map((item) => [item.offer_id, item]));
  const officialIds = new Set(officialResults.map((item) => item.offer_id));
  const merged = officialResults.map((item) => {
    const api = apiById.get(item.offer_id);
    if (!api) return item;
    return {
      ...api,
      ...item,
      title: item.title || api.title,
      image_url: item.image_url || api.image_url,
      price: item.price || api.price,
      sales: item.sales || api.sales,
      sales_value: item.sales_value ?? api.sales_value,
      minimum_order: item.minimum_order || api.minimum_order,
      repurchase_rate: item.repurchase_rate || api.repurchase_rate,
      repurchase_rate_value: item.repurchase_rate_value ?? api.repurchase_rate_value,
      shipping_time: item.shipping_time || api.shipping_time,
      supplier_years: item.supplier_years || api.supplier_years,
      listed_at: item.listed_at || api.listed_at,
      supplier_name: item.supplier_name || api.supplier_name,
      badges: item.badges?.length ? item.badges : api.badges,
    };
  });
  return merged.concat(apiResults.filter((item) => !officialIds.has(item.offer_id)));
}

export function sniffImageFormat(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || []);
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'JPEG';
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'PNG';
  if (bytes.length >= 6 && [0x47, 0x49, 0x46, 0x38].every((byte, index) => bytes[index] === byte)) return 'GIF';
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'WebP';
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(4, 8)) === 'ftyp') {
    const brands = String.fromCharCode(...bytes.slice(8, 12));
    if (/^(?:avif|avis)$/.test(brands)) return 'AVIF';
    if (/^(?:heic|heix|hevc|hevx|mif1|msf1)$/.test(brands)) return 'HEIF';
  }
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return 'BMP';
  const prefix = String.fromCharCode(...bytes.slice(0, 256)).replace(/^\uFEFF?\s*/, '').toLowerCase();
  if (prefix.startsWith('<svg') || (prefix.startsWith('<?xml') && prefix.includes('<svg'))) return 'SVG';
  return 'unknown';
}

export function classifyImageProbe({ status, contentType = '', signature = 'unknown' }) {
  const mime = String(contentType).split(';', 1)[0].trim().toLowerCase();
  if (status === 401) return { state: 'unauthorized', message: '图片服务返回 401，要求身份验证或访问凭证。' };
  if (status === 403) return { state: 'forbidden', message: '图片服务返回 403，拒绝了图片请求；可能是防盗链或临时访问限制。' };
  if (status === 404) return { state: 'not_found', message: '图片服务返回 404，图片地址已失效或资源不存在。' };
  if (status === 429) return { state: 'rate_limited', message: '图片服务返回 429，当前请求触发频率限制。' };
  if (!Number.isFinite(status) || status < 200 || status >= 300) return { state: 'http_error', message: `图片服务返回 HTTP ${Number.isFinite(status) ? status : '未知错误'}。` };
  if (!mime.startsWith('image/')) return { state: 'not_image', message: `HTTP 请求成功，但返回类型是 ${mime || '未知'}，内容不是图片。常见原因是防盗链、登录页或错误页。` };
  if (signature === 'unknown') return { state: 'image_unverified', message: 'HTTP 请求成功且声明为图片，但暂未识别文件格式头；需要结合浏览器解码结果判断。' };
  const expected = {
    'image/jpeg': ['JPEG'], 'image/jpg': ['JPEG'], 'image/png': ['PNG'], 'image/gif': ['GIF'],
    'image/webp': ['WebP'], 'image/avif': ['AVIF'], 'image/heic': ['HEIF'], 'image/heif': ['HEIF'],
    'image/svg+xml': ['SVG'], 'image/bmp': ['BMP'],
  }[mime];
  if (expected && !expected.includes(signature)) return { state: 'type_mismatch', message: `响应声明为 ${mime}，文件格式头却是 ${signature}，类型不匹配。` };
  return { state: 'image_accessible', message: `图片服务返回 HTTP ${status} 和 ${signature} 图片数据；浏览器页面仍加载失败时，应重点检查页面侧策略或图片解码。` };
}

export const IMAGE_SEARCH_ENDPOINTS = Object.freeze({ upload: IMAGE_UPLOAD_URL, uploadApi: IMAGE_UPLOAD_API, appKey: MTOP_APP_KEY });
