import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSearchUrl,
  findImageSession,
  md5,
  mergeOfficialResults,
  normalizeOfficialOffer,
  officialSearchPageUrl,
  parseImageSessionResponse,
  parseResponseText,
  parseSearchResponseText,
  SearchFailure,
} from '../extension/core.mjs';

test('MD5 matches the standard signing vector', () => {
  assert.equal(md5('abc'), '900150983cd24fb0d6963f7d28e17f72');
});

test('response parsing accepts JSON and JSONP and flags an access challenge', () => {
  assert.deepEqual(parseResponseText('{"ok":true}'), { ok: true });
  assert.deepEqual(parseResponseText('mtopjsonp1({"data":{"imageId":"123456789"}});'), { data: { imageId: '123456789' } });
  assert.throws(
    () => parseResponseText('<html><body>captcha 安全验证</body></html>'),
    (error) => error instanceof SearchFailure && error.code === 'auth' && error.issue === 'challenge',
  );
});

test('image session is found in a nested response without exposing a cookie token', () => {
  assert.deepEqual(findImageSession({ data: { result: { imageId: 'img-12345678', requestId: 'req-1' } } }), {
    image_id: 'img-12345678', request_id: 'req-1', session_id: undefined,
  });
  assert.equal(parseImageSessionResponse({ data: { image_id: 'img-87654321' } }).image_id, 'img-87654321');
});

test('offer normalization keeps available fields and does not invent missing values', () => {
  const item = normalizeOfficialOffer({
    offerId: '123456789012',
    title: 'Tablet stand',
    imageUrl: '//cbu01.alicdn.com/img/ibank/example.jpg',
    price: '¥8.50-¥12.00',
    monthSold: '1.2万件',
    minOrderQuantity: 5,
    shops: { shop_name: 'Sample supplier', opened_year: 6 },
  });
  assert.equal(item.offer_id, '123456789012');
  assert.equal(item.title, 'Tablet stand');
  assert.equal(item.image_url, 'https://cbu01.alicdn.com/img/ibank/example.jpg');
  assert.equal(item.price.display, '¥8.50–¥12');
  assert.equal(item.minimum_order, '5件起批');
  assert.equal(item.sales, '1.2万件');
  assert.equal(item.supplier_name, 'Sample supplier');

  const sparse = normalizeOfficialOffer({ offerId: '987654321' });
  assert.equal(sparse.title, '');
  assert.equal(sparse.image_url, '');
  assert.equal(sparse.price, undefined);
  assert.equal(sparse.sales, undefined);
  assert.equal(sparse.minimum_order, undefined);
});

test('offers can be identified from detail links and reject missing identifiers', () => {
  assert.equal(normalizeOfficialOffer({ href: 'https://detail.1688.com/offer/123456789.html' }).offer_id, '123456789');
  assert.equal(normalizeOfficialOffer({ title: 'No ID' }), undefined);
});

test('search response parsing reports empty results without fabricating offers', () => {
  const empty = parseSearchResponseText('{"data":{"offerList":[]}}', { image_id: 'image-12345678' });
  assert.deepEqual(empty.results, []);
  const found = parseSearchResponseText('{"data":{"offerList":[{"offerId":"123456789","title":"Case"}]}}', { image_id: 'image-12345678' });
  assert.equal(found.results.length, 1);
  assert.equal(found.results[0].price, undefined);
});

test('official result ordering is preserved while API-only results remain available', () => {
  const api = [
    { offer_id: '1', title: 'API one', image_url: '', badges: [] },
    { offer_id: '2', title: 'API two', image_url: 'https://example.com/two.jpg', badges: [] },
  ];
  const official = [
    { offer_id: '2', title: 'Official two', image_url: '', badges: [] },
  ];
  const merged = mergeOfficialResults(api, official);
  assert.deepEqual(merged.map((item) => item.offer_id), ['2', '1']);
  assert.equal(merged[0].title, 'Official two');
  assert.equal(merged[0].image_url, 'https://example.com/two.jpg');
});

test('official URLs carry only the returned image search session identifiers', () => {
  const session = { image_id: 'image-12345678', request_id: 'request-1', session_id: 'session-1' };
  const apiUrl = new URL(buildSearchUrl(session));
  assert.equal(apiUrl.origin, 'https://search.1688.com');
  assert.equal(apiUrl.searchParams.get('imageId'), session.image_id);
  assert.equal(apiUrl.searchParams.get('beginPage'), '1');
  assert.equal(apiUrl.searchParams.get('requestId'), session.request_id);
  const pageUrl = new URL(officialSearchPageUrl(session));
  assert.equal(pageUrl.origin, 'https://air.1688.com');
  assert.equal(pageUrl.searchParams.get('imageIdList'), session.image_id);
});
