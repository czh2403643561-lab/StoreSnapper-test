import {
  SearchFailure,
  buildSearchUrl,
  classifyImageProbe,
  md5,
  mergeOfficialResults,
  normalizeOfficialOffer,
  officialSearchPageUrl,
  parseImageSessionResponse,
  parseResponseText,
  parseSearchResponseText,
  sniffImageFormat,
} from './core.mjs';

const jobsByTab = new Map();
const IMAGE_HOSTS = new Set(['img.kwcdn.com', 'img-eu.kwcdn.com', 'aimg.kwcdn.com', 'cbu01.alicdn.com']);
const DIAGNOSTIC_IMAGE_HOSTS = new Set(['cbu01.alicdn.com']);
const MAX_DIAGNOSTIC_IMAGE_BYTES = 256 * 1024;
const LOGIN_URL = 'https://login.1688.com/member/signin.htm?Done=https%3A%2F%2Fwww.1688.com%2F';
const MTOP_TOKEN_LOOKUP_TIMEOUT_MS = 10_000;
const MTOP_TOKEN_LOOKUP_STEP_TIMEOUT_MS = 2_000;
const AUTH_FLOW_KEY = 'storesnapper_1688_auth_flow';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return false;
  if (message.type === 'READ_1688_DETAIL_SOURCE') {
    void read1688DetailSource(sender, message.offerId)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || '无法读取 1688 商品信息。' }));
    return true;
  }
  if (message.type === 'FETCH_1688_DETAIL_FILE') {
    void fetch1688DetailFile(sender, message.url, message.kind, message.offerId)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || '图片下载失败。' }));
    return true;
  }
  if (message.type === 'OPEN_STORE_SIDEPANEL') {
    const tabId = sender.tab?.id;
    if (tabId === undefined || !chrome.sidePanel?.open) {
      sendResponse({ ok: false, error: '当前 Chrome 版本不支持右侧功能面板。' });
      return false;
    }
    void chrome.sidePanel.open({ tabId })
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false, error: '无法打开右侧功能面板，请点击工具栏图标重试。' }));
    return true;
  }
  if (message.type === 'DIAGNOSE_1688_IMAGE') {
    void diagnose1688Image(message.imageUrl)
      .then((result) => sendResponse({ ok: true, result }))
      .catch(() => sendResponse({ ok: false, error: '无法完成货源图片诊断。' }));
    return true;
  }
  if (message.type === 'SEARCH_IMAGE') {
    if (sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL('batch.html')) {
      const tabId = Number(message.tabId);
      if (!Number.isInteger(tabId)) {
        sendResponse({ ok: false, error: '批量页标签不可用，请重新打开。' });
        return false;
      }
      void chrome.tabs.get(tabId).then((tab) => {
        if (tab.url !== chrome.runtime.getURL('batch.html')) {
          sendResponse({ ok: false, error: '批量页标签已变化，请重新打开。' });
          return;
        }
        const job = startJob(tabId, message, sendResponse, true);
        if (!job) sendResponse({ ok: false, error: '图片链接无效或图片域名未获授权，请检查 image 列。' });
      }).catch(() => sendResponse({ ok: false, error: '批量页标签不可用，请重新打开。' }));
      return true;
    }
    const tabId = sender.tab?.id;
    if (tabId === undefined) {
      sendResponse({ ok: false, error: '请从 Temu 商品图片启动搜图。' });
      return false;
    }
    const job = startJob(tabId, message, sendResponse);
    if (!job) {
      sendResponse({ ok: false, error: '商品图片信息无效，请重试。' });
      return false;
    }
    return true;
  }
  if (message.type === 'CANCEL_SEARCH') {
    void cancelJob(sender.tab?.id, message.requestId);
    sendResponse({ ok: true });
    return false;
  }
  if (message.type === 'OPEN_1688_LOGIN') {
    void open1688Login(sender.tab?.id)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false, error: '无法打开 1688 登录页。' }));
    return true;
  }
  if (message.type === 'CHECK_1688_TOKEN') {
    void getMtopToken(undefined, () => {})
      .then((token) => sendResponse({ ok: Boolean(token) }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === 'OPEN_1688_OFFER') {
    const id = String(message.offerId || '');
    if (!/^\d{8,}$/.test(id)) {
      sendResponse({ ok: false, error: '1688 商品编号无效。' });
      return false;
    }
    void chrome.tabs.create({ url: `https://detail.1688.com/offer/${id}.html`, active: true })
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false, error: '无法打开 1688 商品页。' }));
    return true;
  }
  return false;
});

async function read1688DetailSource(sender, requestedOfferId) {
  const offerId = String(requestedOfferId || '');
  const tab = sender.tab;
  if (!tab?.id || !/^\d{8,}$/.test(offerId) || !is1688OfferUrl(sender.url, offerId) || !is1688OfferUrl(tab.url, offerId)) {
    throw new Error('商品页面已变化，请刷新后重试。');
  }
  const [injected] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',
    func: read1688PageData,
  });
  const source = injected?.result;
  if (!source || source.offerId !== offerId) throw new Error('页面尚未识别到商品信息，请稍后重试。');
  return source;
}

function read1688PageData() {
  const offerId = location.pathname.match(/\/offer\/(\d{8,})\.html/i)?.[1] || '';
  const data = window.context?.result?.data;
  const galleryData = data?.gallery?.fields || data?.gallery || {};
  const descriptionData = data?.description?.fields || data?.description || {};
  const titleData = data?.productTitle?.fields || data?.productTitle || {};
  const mainPriceData = data?.mainPrice?.fields || data?.mainPrice || {};
  const packData = data?.productPackInfo?.fields || data?.productPackInfo || {};
  const packScale = packData?.pieceWeightScale || {};
  const toImageUrl = (entry) => {
    if (typeof entry === 'string') return entry;
    if (!entry || typeof entry !== 'object') return '';
    for (const key of ['originalImageUrl', 'bigImageUrl', 'imageUrl', 'imgUrl', 'url', 'src', 'image']) {
      if (typeof entry[key] === 'string') return entry[key];
    }
    return '';
  };
  const galleryItems = galleryData.offerImgList;
  const gallery = Array.isArray(galleryItems) ? galleryItems.slice(0, 80).map(toImageUrl).filter(Boolean) : [];
  const title = galleryData.subject || titleData.title || document.querySelector('#productTitle')?.innerText?.split('\n')[0]?.trim() || '';
  const supplierName = document.querySelector('.shop-company-name, #shopName, [class*="shopName"], [class*="shop-name"]')?.innerText?.trim()
    || data?.supplier?.name || data?.supplierName || '';
  const shippingOrigin = document.querySelector('.module-od-shipping-services .location')?.innerText?.trim() || '';
  const descriptionUrl = descriptionData.detailUrl || '';
  const ladderPriceList = Array.isArray(mainPriceData.priceRangeList) && mainPriceData.priceRangeList.length
    ? mainPriceData.priceRangeList
    : null;
  const currentPriceList = Array.isArray(mainPriceData.priceModel?.currentPrices) && mainPriceData.priceModel.currentPrices.length
    ? mainPriceData.priceModel.currentPrices
    : null;
  const rawPriceTiers = ladderPriceList || currentPriceList;
  const priceTiersSource = ladderPriceList ? 'mainPrice.priceRangeList' : currentPriceList ? 'mainPrice.priceModel.currentPrices' : null;
  const priceTiers = Array.isArray(rawPriceTiers) ? rawPriceTiers.slice(0, 100).map((entry) => {
    if (typeof entry === 'string' || typeof entry === 'number') return String(entry).slice(0, 120);
    if (!entry || typeof entry !== 'object') return null;
    const value = {};
    for (const key of ['price', 'priceText', 'beginAmount', 'minOrderQuantity', 'startAmount', 'quantity']) {
      const field = entry[key];
      if (typeof field === 'string' || typeof field === 'number') value[key] = String(field).slice(0, 120);
    }
    return Object.keys(value).length ? value : null;
  }).filter(Boolean) : null;
  const saleCount = titleData.saleNum ?? data?.trade?.fields?.saleCount ?? data?.saleCount ?? null;
  const dimensionCount = Number.isInteger(packScale.skuDimensionCount) ? packScale.skuDimensionCount : 12;
  const skuDimensions = Array.isArray(packScale.columnList)
    ? packScale.columnList.filter((item) => item && typeof item.label === 'string').slice(0, Math.min(dimensionCount, 12)).map((item) => item.label)
    : [];
  const skuPackInfo = Array.isArray(packScale.pieceWeightScaleInfo) ? packScale.pieceWeightScaleInfo.slice(0, 120).map((entry) => {
    if (!entry || typeof entry !== 'object') return null;
    const value = {};
    const skuKeys = Object.keys(entry).filter((key) => /^sku\d{1,2}$/.test(key) && Number(key.slice(3)) > 0 && Number(key.slice(3)) <= 12);
    for (const key of [...skuKeys, 'length', 'width', 'height', 'weight', 'volume']) {
      const field = entry[key];
      if (/^sku\d{1,2}$/.test(key)) {
        value[key] = typeof field === 'string' || typeof field === 'number' ? field : null;
        continue;
      }
      if (key === 'length' || key === 'width' || key === 'height' || key === 'weight' || key === 'volume') {
        const numeric = field === null || field === undefined || field === '' ? NaN : Number(field);
        value[key] = Number.isFinite(numeric) && numeric > 0 ? field : null;
      }
    }
    const skuId = entry.skuId;
    value.skuId = (typeof skuId === 'string' || typeof skuId === 'number') && String(skuId).trim() !== '' && String(skuId).trim() !== '0' ? skuId : null;
    return Object.keys(value).length ? value : null;
  }).filter(Boolean) : null;
  return {
    offerId,
    sourceUrl: `${location.origin}${location.pathname}`,
    title: String(title).slice(0, 500),
    supplierName: String(supplierName).slice(0, 200),
    shippingOrigin: String(shippingOrigin).slice(0, 100),
    gallery,
    descriptionUrl: typeof descriptionUrl === 'string' ? descriptionUrl : '',
    priceTiers: Array.isArray(priceTiers) ? priceTiers.slice(0, 100) : null,
    priceTiersSource,
    saleCount: typeof saleCount === 'string' || typeof saleCount === 'number' ? saleCount : null,
    skuDimensions,
    skuPackInfo,
  };
}

async function fetch1688DetailFile(sender, rawUrl, kind, requestedOfferId) {
  const tab = sender.tab;
  const offerId = String(requestedOfferId || '');
  if (!tab?.id || !/^\d{8,}$/.test(offerId) || !is1688OfferUrl(sender.url, offerId) || !is1688OfferUrl(tab.url, offerId)) throw new Error('商品页面已变化，请刷新后重试。');
  if (typeof rawUrl !== 'string' || rawUrl.length > 4096) throw new Error('文件地址无效。');
  let url;
  try { url = new URL(rawUrl); } catch { throw new Error('文件地址无效。'); }
  const allowed = kind === 'detail'
    ? url.hostname === 'itemcdn.tmall.com'
    : kind === 'image' && url.hostname === 'cbu01.alicdn.com';
  if (!allowed || url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('文件域名未获授权。');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), kind === 'detail' ? 12000 : 18000);
  try {
    const response = await fetch(url.href, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      redirect: 'manual',
      signal: controller.signal,
    });
    if (!response.ok || response.redirected || (response.status >= 300 && response.status < 400)) {
      throw new Error(`文件请求失败（HTTP ${response.status}）。`);
    }
  const limit = kind === 'detail' ? 4 * 1024 * 1024 : 5 * 1024 * 1024;
    const length = Number(response.headers.get('content-length'));
    if (Number.isFinite(length) && length > limit) throw new Error('文件超过单文件大小限制。');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > limit) throw new Error('文件为空或超过单文件大小限制。');
    if (kind === 'detail') {
      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      if (!/javascript|ecmascript|text\//.test(contentType)) throw new Error('详情内容响应格式不是文本。');
      return { text: new TextDecoder('utf-8').decode(bytes) };
    }
    return {
      base64: encodeBase64(bytes),
      contentType: (response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase(),
      size: bytes.byteLength,
      contentHash: md5(bytes),
    };
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('文件请求超时。');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function encodeBase64(bytes) {
  const parts = [];
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    parts.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)));
  }
  return btoa(parts.join(''));
}

function is1688OfferUrl(rawUrl, expectedOfferId) {
  try {
    const url = new URL(rawUrl);
    const offerId = url.pathname.match(/^\/offer\/(\d{8,})\.html$/i)?.[1];
    return url.protocol === 'https:' && url.hostname === 'detail.1688.com'
      && Boolean(offerId) && (!expectedOfferId || offerId === expectedOfferId);
  } catch {
    return false;
  }
}

async function open1688Login(originTabId) {
  if (originTabId === undefined) throw new Error('Missing Temu tab');
  const originTab = await chrome.tabs.get(originTabId);
  const tab = await chrome.tabs.create({ windowId: originTab.windowId, url: LOGIN_URL, active: false });
  if (tab.id === undefined) throw new Error('Missing 1688 tab');
  await chrome.storage.session.set({ [AUTH_FLOW_KEY]: { originTabId, authTabId: tab.id } });
  await chrome.tabs.update(tab.id, { active: true });
}

async function diagnose1688Image(imageUrl) {
  let url;
  try {
    if (typeof imageUrl !== 'string' || imageUrl.length > 4096) throw new TypeError('Invalid image URL');
    url = new URL(imageUrl);
  } catch {
    return { state: 'invalid_url', message: '图片地址格式无效。' };
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !DIAGNOSTIC_IMAGE_HOSTS.has(url.hostname)) {
    return { state: 'not_probed', message: '此图片域名暂未开放自动探测；已记录域名和路径，未向其发送诊断请求。' };
  }

  const request = { host: url.hostname, path: url.pathname };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url.href, {
      method: 'GET',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      redirect: 'manual',
      signal: controller.signal,
    });
    const contentType = response.headers.get('content-type') || '';
    const normalizedContentType = contentType.split(';', 1)[0].trim().toLowerCase();
    const contentLength = response.headers.get('content-length') || 'unknown';
    const finalUrl = response.url ? new URL(response.url) : url;
    const base = {
      checkedAt: new Date().toISOString(),
      request,
      status: response.status,
      contentType: normalizedContentType || 'unknown',
      contentLength,
      contentRange: response.headers.get('content-range') || 'unknown',
      redirected: response.redirected || (response.status >= 300 && response.status < 400),
      finalUrl: { host: finalUrl.hostname, path: finalUrl.pathname },
    };
    const reader = response.body?.getReader();
    const chunks = [];
    const prefixChunks = [];
    let totalBytes = 0;
    let prefixLength = 0;
    let completed = false;
    const addPrefix = (chunk) => {
      if (prefixLength >= 512) return;
      const slice = chunk.subarray(0, 512 - prefixLength);
      prefixChunks.push(slice);
      prefixLength += slice.length;
    };
    const collectPrefix = () => {
      const prefix = new Uint8Array(prefixLength);
      let offset = 0;
      for (const chunk of prefixChunks) { prefix.set(chunk, offset); offset += chunk.length; }
      return prefix;
    };
    const bodyMarkerFor = (prefix) => {
      if (!normalizedContentType.includes('text/') && !normalizedContentType.includes('html')) return undefined;
      const bodyText = new TextDecoder().decode(prefix).toLowerCase();
      if (/captcha|verify|security|challenge|安全验证|访问受限/.test(bodyText)) return 'security_challenge_or_verification_page';
      if (/access denied|forbidden|hotlink|referer/.test(bodyText)) return 'access_or_hotlink_error_page';
      return undefined;
    };
    const resultFor = (extra = {}) => {
      const prefix = collectPrefix();
      const signature = sniffImageFormat(prefix);
      const diagnosis = classifyImageProbe({ status: response.status, contentType, signature });
      return {
        ...diagnosis,
        ...base,
        capturedBytes: prefix.length,
        receivedBytes: totalBytes,
        signature,
        bodyMarker: bodyMarkerFor(prefix),
        ...extra,
      };
    };

    try {
      if (!response.ok || !normalizedContentType.startsWith('image/')) {
        if (reader) {
          const chunk = await reader.read();
          if (chunk.value) {
            totalBytes = chunk.value.length;
            addPrefix(chunk.value);
          }
        }
        return resultFor();
      }
      const declaredLength = Number(contentLength);
      if (Number.isFinite(declaredLength) && declaredLength > MAX_DIAGNOSTIC_IMAGE_BYTES) {
        return {
          ...resultFor(),
          state: 'image_too_large',
          message: `图片超过 ${MAX_DIAGNOSTIC_IMAGE_BYTES / 1024} KB，未读取或绘制以控制内存占用。`,
        };
      }
      if (!reader) return { ...resultFor(), state: 'empty_image', message: '图片响应没有可读取的内容。' };
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) { completed = true; break; }
        if (!chunk.value) continue;
        if (totalBytes + chunk.value.length > MAX_DIAGNOSTIC_IMAGE_BYTES) {
          addPrefix(chunk.value);
          totalBytes += chunk.value.length;
          return {
            ...resultFor(),
            state: 'image_too_large',
            message: `图片超过 ${MAX_DIAGNOSTIC_IMAGE_BYTES / 1024} KB，已停止读取以控制内存占用。`,
          };
        }
        chunks.push(chunk.value);
        totalBytes += chunk.value.length;
        addPrefix(chunk.value);
      }
    } finally {
      if (reader) {
        if (!completed) await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
    }

    const prefix = collectPrefix();
    const signature = sniffImageFormat(prefix);
    const diagnosis = classifyImageProbe({ status: response.status, contentType, signature });
    if (totalBytes === 0 || !chunks.length) return { ...resultFor(), state: 'empty_image', message: '图片响应没有可读取的内容。' };
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const imageMimeType = ({ JPEG: 'image/jpeg', PNG: 'image/png', GIF: 'image/gif', WebP: 'image/webp', AVIF: 'image/avif', HEIF: 'image/heif', BMP: 'image/bmp' })[signature] || normalizedContentType;
    return {
      ...diagnosis,
      ...base,
      capturedBytes: prefix.length,
      receivedBytes: totalBytes,
      signature,
      bodyMarker: bodyMarkerFor(prefix),
      imageMimeType,
      imageDataBase64: bytesToBase64(bytes),
    };
  } catch (error) {
    return {
      state: error?.name === 'AbortError' ? 'timeout' : 'network_error',
      message: error?.name === 'AbortError'
        ? '图片诊断请求超时（8 秒）；可能是网络连接或图片服务无响应。'
        : '图片诊断请求未收到 HTTP 响应；可能是网络、浏览器策略或图片服务连接失败。',
      checkedAt: new Date().toISOString(),
      request,
      errorName: error?.name || 'Error',
    };
  } finally {
    clearTimeout(timeout);
  }
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

chrome.tabs.onRemoved.addListener((tabId) => {
  const sourceJob = jobsByTab.get(tabId);
  if (sourceJob) void cancelJob(tabId, sourceJob.requestId);
  for (const job of jobsByTab.values()) {
    if (job.officialTabId === tabId) {
      job.officialTabId = undefined;
      job.officialTabClosed = true;
    }
  }
});

function startJob(tabId, message, respond, batch = false) {
  const requestId = String(message.requestId || '');
  const imageUrl = String(message.imageUrl || '');
  let parsed;
  try { parsed = new URL(imageUrl); } catch { return undefined; }
  if (parsed.protocol !== 'https:' || !(IMAGE_HOSTS.has(parsed.hostname) || batch && parsed.hostname.endsWith('.tiktokcdn-eu.com')) || !requestId) return undefined;

  const previous = jobsByTab.get(tabId);
  if (previous) {
    previous.controller.abort();
    finishResponse(previous, { ok: false, cancelled: true });
    void closeOfficialTab(previous);
  }
  const job = {
    tabId,
    requestId,
    imageUrl: parsed.href,
    title: String(message.title || '').slice(0, 220),
    controller: new AbortController(),
    respond,
    batch,
    state: 'preparing',
    results: [],
    similarTotal: 0,
    officialTabId: undefined,
    officialTabClosed: false,
    keepOfficialTab: false,
    uploadDiagnostic: undefined,
  };
  jobsByTab.set(tabId, job);
  void runSearch(job);
  return job;
}

async function runSearch(job) {
  try {
    publish(job, 'preparing', { message: '正在准备商品图片…' });
    const imageData = await prepareImage(job.imageUrl, job.controller.signal);
    assertCurrent(job);
    const updateUploadDiagnostic = (diagnostic) => {
      job.uploadDiagnostic = diagnostic;
      const readingToken = diagnostic.stage.startsWith('token_');
      publish(job, 'uploading', {
        message: readingToken ? '正在准备 1688 搜图凭据…' : '正在提交图片到 1688…',
        diagnostic,
      });
    };
    const session = await uploadImage(imageData, job.controller.signal, updateUploadDiagnostic);
    assertCurrent(job);
    publish(job, 'searching', { message: '正在搜索相似货源…' });
    const page = await searchOffers(session, job.controller.signal);
    assertCurrent(job);
    job.similarTotal = page.results.length;

    if (!page.results.length) {
      publish(job, 'empty', { results: [], message: '1688 本次没有返回相似货源。可以换一张主图后重试。' });
      return;
    }

    publish(job, 'enriching', {
      results: page.results,
      message: '已找到相似货源，正在读取 1688 官方卡片信息…',
      disclaimer: '以下是图片相似结果，需自行核实款式、价格和库存。',
    });

    let finalResults = page.results;
    let enrichment = 'partial';
    let enrichmentMessage = '已保留接口返回的相似货源；部分官方卡片信息暂不可用。';
    try {
      const official = await readOfficialResults(job, page.session, job.controller.signal);
      assertCurrent(job);
      if (official.issue === 'challenge') {
        if (job.batch) throw new SearchFailure('auth', '1688 要求安全验证；请本人完成后继续。', 'challenge');
        enrichmentMessage = '1688 官方结果页要求安全验证；已保留接口返回的相似货源。';
      } else if (official.issue === 'login') {
        if (job.batch) throw new SearchFailure('auth', '1688 登录状态失效；请本人登录后继续。', 'session');
        enrichmentMessage = '1688 官方结果页需要登录；已保留接口返回的相似货源。';
      } else if (official.results.length) {
        const merged = mergeOfficialResults(page.results, official.results);
        finalResults = job.batch
          ? page.results.map((item) => merged.find((candidate) => candidate.offer_id === item.offer_id) || item)
          : merged;
        enrichment = 'complete';
        enrichmentMessage = '已显示 1688 返回的相似货源。';
      }
    } catch (error) {
      if (job.controller.signal.aborted) throw error;
      if (job.batch && error instanceof SearchFailure && error.code === 'auth') throw error;
      enrichmentMessage = '已保留接口返回的相似货源；官方卡片补全暂不可用。';
    }
    assertCurrent(job);
    publish(job, 'ready', {
      results: finalResults,
      similarTotal: job.similarTotal,
      enrichment,
      message: enrichmentMessage,
      disclaimer: '图片搜索结果仅供参考；请在 1688 核实商品、价格、起批量和库存。',
    });
  } catch (error) {
    if (job.controller.signal.aborted || !isCurrent(job)) return;
    const failure = error instanceof SearchFailure ? error : new SearchFailure('failed', error?.message || '1688 图片搜索失败，请重试。');
    publish(job, failure.code === 'auth' ? 'needs-auth' : 'failed', {
      issue: failure.issue,
      results: [],
      message: failure.message,
      diagnostic: job.uploadDiagnostic,
    });
  } finally {
    if (!job.keepOfficialTab) await closeOfficialTab(job);
    finishResponse(job, job.batch
      ? { ok: true, requestId: job.requestId, state: job.state, results: job.results, similarTotal: job.similarTotal, message: job.message, issue: job.issue }
      : { ok: true, requestId: job.requestId, state: job.state });
  }
}

async function prepareImage(imageUrl, signal) {
  const { response, blob: source } = await requestBlob(imageUrl, {
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.5' },
  }, 20_000, signal, '商品图片加载超时，请重试。');
  if (!response.ok) throw new SearchFailure('failed', `商品图片加载失败（HTTP ${response.status}）。`);
  if (!source.type.startsWith('image/')) throw new SearchFailure('failed', '下载内容不是有效图片，请换一张主图重试。');
  if (source.size > 15 * 1024 * 1024) throw new SearchFailure('failed', '商品图片文件过大，请换一张主图重试。');

  try {
    const bitmap = await createImageBitmap(source);
    if (bitmap.width < 100 || bitmap.height < 100) {
      bitmap.close();
      throw new SearchFailure('failed', '商品主图分辨率太低，请换一张图片重试。');
    }
    const scale = Math.min(1, 900 / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(100, Math.round(bitmap.width * scale));
    const height = Math.max(100, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) throw new SearchFailure('failed', '无法处理商品图片，请重试。');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const jpeg = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.88 });
    return await blobToDataUrl(jpeg);
  } catch (error) {
    if (error instanceof SearchFailure) throw error;
    if (/image\/(?:jpeg|png)/i.test(source.type)) return blobToDataUrl(source);
    throw new SearchFailure('failed', '图片格式转换失败，请换一张商品主图重试。');
  }
}

async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  return `data:${blob.type || 'image/jpeg'};base64,${btoa(binary)}`;
}

async function getMtopToken(signal, reportDiagnostic = () => {}, waitAfterBootstrap = false) {
  const lookupStep = async (stage, operation, hasCredential = () => false, timeout = MTOP_TOKEN_LOOKUP_STEP_TIMEOUT_MS) => {
    throwIfAborted(signal);
    const startedAt = Date.now();
    reportDiagnostic({ stage, duration_ms: 0 });
    try {
      const value = await awaitPromiseWithTimeout(
        operation,
        timeout,
        signal,
        '读取 1688 搜图凭据步骤超时。',
      );
      const found = Boolean(hasCredential(value));
      reportDiagnostic({ stage, duration_ms: Date.now() - startedAt, credential_found: found, outcome: found ? 'found' : 'empty' });
      return value;
    } catch (error) {
      if (signal?.aborted) throw error;
      reportDiagnostic({ stage, duration_ms: Date.now() - startedAt, credential_found: false, outcome: /超时/.test(error?.message || '') ? 'timeout' : 'error' });
      return undefined;
    }
  };

  const byUrl = await lookupStep(
    'token_cookie_url',
    () => chrome.cookies.getAll({ url: 'https://h5api.m.1688.com/', name: '_m_h5_tk' }),
    (items) => items?.some((item) => Boolean(tokenFromCookie(item.value || ''))),
  );
  const fromUrl = tokenFromCookie(byUrl?.find((item) => item.value)?.value || '');
  if (fromUrl) return fromUrl;

  const byDomain = await lookupStep(
    'token_cookie_domain',
    () => chrome.cookies.getAll({ domain: '1688.com', name: '_m_h5_tk' }),
    (items) => items?.some((item) => Boolean(tokenFromCookie(item.value || ''))),
  );
  const fromDomain = tokenFromCookie(byDomain?.find((item) => item.value)?.value || '');
  if (fromDomain) return fromDomain;
  // Keep the original fallback: this Chrome session exposes the token to 1688's
  // page while chrome.cookies.getAll() returns no matching cookie.
  const fromPage = await lookupStep(
    'token_page_cookie',
    async () => {
      const tabs = await chrome.tabs.query({ url: [
        'https://www.1688.com/*', 'https://search.1688.com/*',
        'https://air.1688.com/*', 'https://detail.1688.com/*',
      ] });
      for (const tab of tabs) {
        if (tab.id === undefined) continue;
        const injected = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'ISOLATED',
          func: () => document.cookie.split(';').map((item) => item.trim())
            .find((item) => item.startsWith('_m_h5_tk='))?.slice('_m_h5_tk='.length) || '',
        }).catch(() => []);
        const token = tokenFromCookie(injected[0]?.result || '');
        if (token) return token;
      }
      return '';
    },
    Boolean,
  );
  if (fromPage) return fromPage;
  if (waitAfterBootstrap) {
    const afterBootstrap = await lookupStep(
      'token_cookie_after_bootstrap',
      (lookupSignal) => waitForMtopCookie(lookupSignal),
      (items) => items?.some((item) => Boolean(tokenFromCookie(item.value || ''))),
    );
    return tokenFromCookie(afterBootstrap?.find((item) => item.value)?.value || '');
  }
  return '';
}

async function waitForMtopCookie(signal) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    throwIfAborted(signal);
    const items = await chrome.cookies.getAll({ url: 'https://h5api.m.1688.com/', name: '_m_h5_tk' });
    if (items.some((item) => tokenFromCookie(item.value || ''))) return items;
    await delay(150, signal);
  }
  return [];
}

function tokenFromCookie(value) {
  try { return decodeURIComponent(value).split('_')[0].trim(); } catch { return ''; }
}

async function uploadImage(dataUrl, signal, reportDiagnostic = () => {}) {
  const base64 = dataUrl.replace(/^data:image\/[^;]+;base64,/i, '');
  if (base64.length < 100) throw new SearchFailure('failed', '待搜索图片内容无效。');
  const body = JSON.stringify({ imageBase64: base64, appName: 'searchImageUpload', appKey: 'pvvljh1grxcmaay2vgpe9nb68gg9ueg2' });
  const readToken = async (stage) => {
    const startedAt = Date.now();
    let lastStage = stage;
    const updateDiagnostic = (diagnostic) => {
      if (diagnostic.stage) lastStage = diagnostic.stage;
      reportDiagnostic(diagnostic);
    };
    updateDiagnostic({ stage, duration_ms: 0 });
    try {
      const token = await awaitPromiseWithTimeout(
        (lookupSignal) => getMtopToken(lookupSignal, updateDiagnostic, stage === 'token_after_bootstrap'),
        MTOP_TOKEN_LOOKUP_TIMEOUT_MS,
        signal,
        '暂时无法取得 1688 搜图凭据。请在 1688 页面确认登录后返回重新检查。',
      );
      updateDiagnostic({ stage, duration_ms: Date.now() - startedAt, credential_found: Boolean(token) });
      return token;
    } catch (error) {
      updateDiagnostic({ stage: lastStage, duration_ms: Date.now() - startedAt, credential_found: false });
      throw error;
    }
  };
  const sendImage = async (stage, token) => {
    const startedAt = Date.now();
    reportDiagnostic({ stage, duration_ms: 0, credential_found: true });
    try {
      const data = await uploadRequest(body, token, signal);
      reportDiagnostic({ stage, duration_ms: Date.now() - startedAt, credential_found: true });
      return data;
    } catch (error) {
      reportDiagnostic({ stage, duration_ms: Date.now() - startedAt, credential_found: true });
      throw error;
    }
  };

  let token = await readToken('token_lookup');
  if (!token) {
    const startedAt = Date.now();
    let cookieChanged = false;
    const onCookieChanged = (change) => {
      if (!change.removed && change.cookie?.name === '_m_h5_tk' && /(^|\.)1688\.com$/i.test(change.cookie.domain || '')) cookieChanged = true;
    };
    reportDiagnostic({ stage: 'token_first_party_bootstrap', duration_ms: 0 });
    chrome.cookies.onChanged.addListener(onCookieChanged);
    let outcome = 'request_failed';
    try {
      outcome = await bootstrapTokenFrom1688Page(body, signal);
      if (outcome === 'sent') token = await readToken('token_after_bootstrap');
    } finally {
      chrome.cookies.onChanged.removeListener(onCookieChanged);
      reportDiagnostic({ stage: 'token_first_party_bootstrap', duration_ms: Date.now() - startedAt, cookie_changed: cookieChanged, credential_found: Boolean(token), outcome });
    }
  }
  if (!token) throw new SearchFailure('auth', '暂时未取得 1688 搜图凭据。请打开 1688 页面确认登录；已登录则返回此处重新检查。', 'login');

  let data = await sendImage('image_upload', token);
  let auth = authFromData(data);
  if (auth?.issue === 'session') {
    token = await readToken('token_refresh');
    if (token) {
      data = await sendImage('image_upload_retry', token);
      auth = authFromData(data);
    }
  }
  if (auth) throw auth;
  return parseImageSessionResponse(data);
}

async function bootstrapTokenFrom1688Page(body, signal) {
  throwIfAborted(signal);
  const tabs = await chrome.tabs.query({ url: ['https://*.1688.com/*'] }).catch(() => []);
  const tab = tabs.find((item) => item.id !== undefined && item.status === 'complete' && /^https:\/\/(?:www|search|air|detail)\.1688\.com\//i.test(item.url || ''));
  if (!tab) return 'no_page';
  const time = Date.now().toString();
  const url = new URL('https://h5api.m.1688.com/h5/mtop.1688.imageservice.putimage/1.0/');
  for (const [key, value] of Object.entries({
    jsv: '2.7.2', appKey: '12574478', t: time, sign: '',
    api: 'mtop.1688.imageService.putImage', ecode: '0', v: '1.0', type: 'originaljson', dataType: 'jsonp',
  })) url.searchParams.set(key, value);
  try {
    const results = await awaitPromiseWithTimeout(
      () => chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'ISOLATED',
        func: async (requestUrl, requestBody) => {
          try {
            await fetch(requestUrl, {
              method: 'POST', mode: 'no-cors', credentials: 'include',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: `data=${encodeURIComponent(requestBody)}`,
            });
            return 'sent';
          } catch { return 'request_failed'; }
        },
        args: [url.href, body],
      }),
      8_000,
      signal,
      '1688 页面请求超时。',
    );
    return results[0]?.result === 'sent' ? 'sent' : 'request_failed';
  } catch (error) {
    if (signal.aborted) throw error;
    return /超时/.test(error?.message || '') ? 'timeout' : 'request_failed';
  }
}

async function uploadRequest(body, token, signal) {
  const time = Date.now().toString();
  const url = new URL('https://h5api.m.1688.com/h5/mtop.1688.imageservice.putimage/1.0/');
  const params = {
    jsv: '2.7.2', appKey: '12574478', t: time,
    sign: token ? md5(`${token}&${time}&12574478&${body}`) : '',
    api: 'mtop.1688.imageService.putImage', ecode: '0', v: '1.0', type: 'originaljson', dataType: 'jsonp',
  };
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const { response, text } = await requestText(url.href, {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(body)}`,
  }, 30_000, signal, '等待 1688 图片上传超时，请重试。');
  if (!response.ok) {
    try { return parseResponseText(text); } catch (error) { if (error instanceof SearchFailure) throw error; }
    throw new SearchFailure('failed', `1688 图片上传失败（HTTP ${response.status}）。`);
  }
  return parseResponseText(text);
}

async function searchOffers(session, signal) {
  const { response, text } = await requestText(buildSearchUrl(session, 1, 20), {
    credentials: 'include',
    headers: { Accept: 'application/json, text/plain, */*' },
  }, 25_000, signal, '等待 1688 搜索结果超时，请重试。');
  if (!response.ok) {
    try { return parseSearchResponseText(text, session); } catch (error) { if (error instanceof SearchFailure && error.code === 'auth') throw error; }
    throw new SearchFailure('failed', `1688 图搜请求失败（HTTP ${response.status}）。`);
  }
  return parseSearchResponseText(text, session);
}

async function readOfficialResults(job, session, signal) {
  if (job.officialTabClosed) return { results: [], issue: undefined };
  const tab = await chrome.tabs.create({ url: officialSearchPageUrl(session), active: false });
  if (tab.id === undefined) throw new SearchFailure('failed', '无法打开 1688 官方结果页。');
  job.officialTabId = tab.id;
  const holdForVerification = async (issue) => {
    if (!job.batch) return { results: [], issue };
    job.keepOfficialTab = true;
    await chrome.tabs.update(tab.id, { active: true }).catch(() => undefined);
    return { results: [], issue };
  };
  try {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await delay(900, signal);
      assertCurrent(job);
      if (job.officialTabClosed) return { results: [] };
      const currentTab = await chrome.tabs.get(tab.id).catch(() => undefined);
      if (!currentTab) return { results: [] };
      if (/login\.1688\.com|member\/signin/i.test(currentTab.url || '')) return holdForVerification('login');
      const injected = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: readOfficialImageSearchCards,
      }).catch(() => []);
      const data = injected[0]?.result;
      if (data?.issue) return holdForVerification(data.issue);
      if (Array.isArray(data?.offers) && data.offers.length) {
        return { results: data.offers.map(normalizeOfficialOffer).filter(Boolean) };
      }
    }
    return { results: [] };
  } finally {
    if (!job.keepOfficialTab) await closeOfficialTab(job);
  }
}

function readOfficialImageSearchCards() {
  const bodyText = (document.body?.innerText || '').slice(0, 12_000);
  const currentUrl = location.href;
  if (/login\.1688\.com|member\/signin/i.test(currentUrl) || /请登录|登录后继续/i.test(bodyText)) return { issue: 'login', offers: [] };
  if (/_____tmd_____|punish|captcha|验证码|安全验证|FAIL_SYS_USER_VALIDATE/i.test(bodyText)) return { issue: 'challenge', offers: [] };

  const cards = [...document.querySelectorAll('[class*="searchOfferWrapper"]')];
  const seen = new Set();
  const textOf = (element) => (element?.textContent || '').replace(/\s+/g, ' ').trim();
  const offers = cards.flatMap((card) => {
    const links = [...card.querySelectorAll('a[href*="detail.1688.com/offer/"], a[href*="offerId="]')];
    const href = links.find((link) => /(?:\/offer\/|[?&]offerId=)\d{8,}/i.test(link.href))?.href || '';
    const id = href.match(/(?:\/offer\/|[?&]offerId=)(\d{8,})/i)?.[1] || '';
    if (!id || seen.has(id)) return [];
    seen.add(id);
    const desc = [...card.querySelectorAll('[class*="descText"]')]
      .map((item) => (item.innerText || item.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
    const sales = desc.find((item) => /^(?:\d+(?:\.\d+)?(?:万|千|[Kk])?\+?)件$/.test(item));
    const minimum = desc.find((item) => /^\d+件起批$/.test(item));
    const supplierRow = textOf(card.querySelector('[class*="offerShopRow"]'));
    const years = supplierRow.match(/入驻\s*(\d+)\s*年/)?.[1];
    const supplier = supplierRow.replace(/^入驻\s*\d+\s*年\s*/, '').replace(/旺旺在线.*$/u, '').trim();
    const title = textOf(card.querySelector('[class*="titleText"], [class*="offerTitle"], [class*="subject"]'));
    const image = card.querySelector('img.mainImg, img[class*="mainImg"], img[src]');
    const priceCandidates = [...card.querySelectorAll('[class*="priceItem"], [class*="price-item"], [class*="priceValue"], [class*="offerPrice"]')]
      .filter((element) => !element.querySelector('[class*="descText"], [class*="offerDesc"]'))
      .sort((left, right) => left.querySelectorAll('*').length - right.querySelectorAll('*').length);
    const priceText = (priceCandidates[0]?.textContent || card.textContent || '').replace(/\s+/g, ' ')
      .replace(/(\d)\s*\.\s*(\d)/g, '$1.$2').replace(/([¥￥])\s+/g, '$1');
    const priceMatch = priceText.match(/(?:¥|￥)\s*(\d+(?:\.\d+)?)(?:\s*[-–~至]\s*(?:¥|￥)?\s*(\d+(?:\.\d+)?))?/);
    const price = priceMatch ? (priceMatch[2] ? `${priceMatch[1]}-${priceMatch[2]}` : priceMatch[1]) : undefined;
    const repurchase = desc.find((item) => /^回头率\s*\d+(?:\.\d+)?%$/.test(item));
    const shipping = desc.find((item) => /(?:\d+H发|\d+小时发|\d+天达|后天达)/i.test(item));
    return [{
      offer_id: id,
      href,
      title,
      picture: image?.currentSrc || image?.src || '',
      price,
      sales,
      minOrderQuantity: minimum,
      repurchaseRate: repurchase,
      shippingTimeGuarantee: shipping,
      shops: { opened_year: years, shop_name: supplier },
    }];
  });
  return { offers };
}

async function requestText(url, options, timeout, parentSignal, timeoutMessage) {
  return withTimeout(async (signal) => {
    const response = await fetch(url, { ...options, signal });
    return { response, text: await response.text() };
  }, timeout, parentSignal, timeoutMessage);
}

async function requestBlob(url, options, timeout, parentSignal, timeoutMessage) {
  return withTimeout(async (signal) => {
    const response = await fetch(url, { ...options, signal });
    return { response, blob: await response.blob() };
  }, timeout, parentSignal, timeoutMessage);
}

async function withTimeout(operation, timeout, parentSignal, timeoutMessage) {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromParent = () => controller.abort(parentSignal.reason);
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener('abort', abortFromParent, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
  try {
    return await operation(controller.signal);
  } catch (error) {
    if (parentSignal?.aborted) throw parentSignal.reason || error;
    if (timedOut) throw new SearchFailure('failed', timeoutMessage);
    throw error;
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', abortFromParent);
  }
}

function awaitPromiseWithTimeout(operation, timeout, parentSignal, timeoutMessage) {
  const controller = new AbortController();
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', abortFromParent);
      callback(value);
    };
    const abortFromParent = () => {
      const reason = parentSignal.reason || new DOMException('Search cancelled', 'AbortError');
      controller.abort(reason);
      finish(reject, reason);
    };
    if (parentSignal?.aborted) {
      abortFromParent();
      return;
    }
    parentSignal?.addEventListener('abort', abortFromParent, { once: true });
    timer = setTimeout(() => {
      const failure = new SearchFailure('auth', timeoutMessage, 'login');
      controller.abort(failure);
      finish(reject, failure);
    }, timeout);
    Promise.resolve().then(() => operation(controller.signal)).then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error),
    );
  });
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason || new DOMException('Search cancelled', 'AbortError');
}

function authFromData(data) {
  const message = [data?.ret, data?.msg, data?.message].flat().filter(Boolean).map(String).join('；');
  if (/TOKEN|SESSION_EXPIRED|NOT_LOGIN|登录/i.test(message)) return new SearchFailure('auth', '1688登录状态已失效，请重新登录后重试。', 'session');
  if (/FAIL_SYS_USER_VALIDATE|RGV587|CAPTCHA|安全|验证|PUNISH|X5SECDATA/i.test(message)) return new SearchFailure('auth', '1688暂时要求完成安全验证，请在 1688 页面处理后重试。', 'challenge');
  return undefined;
}

function publish(job, state, fields = {}) {
  if (!isCurrent(job)) return;
  job.state = state;
  if (job.batch && Array.isArray(fields.results)) job.results = fields.results;
  if (job.batch && fields.message) job.message = fields.message;
  if (job.batch && fields.issue) job.issue = fields.issue;
  const update = {
    type: 'SEARCH_UPDATE',
    requestId: job.requestId,
    state,
    ...fields,
  };
  void (job.batch ? chrome.runtime.sendMessage(update) : chrome.tabs.sendMessage(job.tabId, update)).catch(() => undefined);
}

function isCurrent(job) {
  return jobsByTab.get(job.tabId) === job && !job.controller.signal.aborted;
}

function assertCurrent(job) {
  if (!isCurrent(job)) throw new DOMException('Search superseded', 'AbortError');
}

async function cancelJob(tabId, requestId) {
  if (tabId === undefined) return;
  const job = jobsByTab.get(tabId);
  if (!job || (requestId && job.requestId !== requestId)) return;
  jobsByTab.delete(tabId);
  job.controller.abort();
  finishResponse(job, { ok: false, cancelled: true });
  await closeOfficialTab(job);
}

function finishResponse(job, value) {
  const respond = job.respond;
  if (!respond) return;
  job.respond = undefined;
  try { respond(value); } catch { /* The requesting tab may already be closed. */ }
}

async function closeOfficialTab(job) {
  const tabId = job.officialTabId;
  job.officialTabId = undefined;
  if (tabId !== undefined) await chrome.tabs.remove(tabId).catch(() => undefined);
}

function delay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason || new DOMException('Aborted', 'AbortError')); return; }
    const timer = setTimeout(finish, milliseconds);
    function finish() {
      signal.removeEventListener('abort', abort);
      resolve();
    }
    function abort() {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(signal.reason || new DOMException('Aborted', 'AbortError'));
    }
    signal.addEventListener('abort', abort, { once: true });
  });
}

export { uploadImage };
