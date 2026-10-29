import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../extension/tiktok-core.js');

test('product identity separates the stable product ID from the title', () => {
  assert.deepEqual(core.parseProductIdentity('Foldable desk with storage ID:1729964221905803389'), {
    productId: '1729964221905803389',
    title: 'Foldable desk with storage',
  });
  assert.equal(core.parseProductIdentity('3 个 SKU 展开').productId, null);
});

test('prices retain currency, ranges, and promotional price separately', () => {
  assert.deepEqual(core.parsePrices('£17.47 促销价：£6.99'), {
    raw: '£17.47 促销价：£6.99',
    retail: { raw: '£17.47', currency: 'GBP', minimum: '17.47', maximum: '17.47' },
    promotion: { raw: '£6.99', currency: 'GBP', minimum: '6.99', maximum: '6.99' },
  });
  assert.equal(core.parsePrices('£8.00-£12.00').retail.maximum, '12.00');
});

test('pagination estimates the sampled 50-item pages and the final remainder', () => {
  const first = core.parsePagination({ totalText: '总行数: 197', pageSizeText: '50/页', activePageText: '1', activePageLabel: '第 1 页' });
  const last = core.parsePagination({ totalText: '总行数: 197', pageSizeText: '50/页', activePageText: '4', activePageLabel: '第 4 页' });
  assert.equal(first.expectedRows, 50);
  assert.equal(first.totalPages, 4);
  assert.equal(last.expectedRows, 47);
});

test('SKU summary rows are not products and missing source fields remain explicit', () => {
  const record = core.buildProductRecord({
    productId: '896856733973',
    title: '折叠桌',
    imageUrl: 'https://example.test/item.jpg',
    imageStatus: 'loaded',
    priceRaw: '£12.00',
    inventoryRaw: '100',
    statusRaw: '在售',
    skuRaw: '',
  });
  assert.equal(record.product_id, '896856733973');
  assert.ok(record.missing_fields.includes('sold_count'));
  assert.ok(record.missing_fields.includes('sku_count'));
  assert.equal(core.countIncompleteProducts([record]), 0);
  const missingPrice = core.buildProductRecord({ productId: '896856733974', title: '折叠桌', imageUrl: 'https://example.test/item.jpg', imageStatus: 'loaded', inventoryRaw: '100' });
  assert.equal(core.countIncompleteProducts([missingPrice]), 1);
});

test('page integrity requires bottom, stable content, expected count, and loaded key fields', () => {
  const result = core.evaluatePage({ expectedRows: 2, productIds: ['1', '2', '2'], atBottom: true, stablePasses: 2 });
  assert.equal(result.status, 'complete');
  assert.equal(result.uniqueCount, 2);
  assert.equal(core.evaluatePage({ expectedRows: 2, productIds: ['1'], atBottom: true, stablePasses: 2 }).status, 'needs_review');
  assert.equal(core.evaluatePage({ expectedRows: 2, productIds: ['1', '2'], atBottom: true, stablePasses: 2, failedImages: 1 }).status, 'needs_review');
  assert.match(core.evaluatePage({ expectedRows: 2, productIds: ['1', '2'], atBottom: true, stablePasses: 2, missingCriticalRecords: 1 }).reasons[0], /售价或库存/);
  assert.equal(core.evaluatePage({ expectedRows: null, productIds: ['1', '2'], atBottom: true, stablePasses: 2 }).status, 'needs_review');
});

test('page and collection completion require every known page', () => {
  assert.equal(core.isEntireCollectionComplete([{ page_number: 1, status: 'complete' }], 2), false);
  assert.equal(core.isEntireCollectionComplete([{ page_number: 1, status: 'complete' }, { page_number: 2, status: 'complete' }], 2), true);
});

test('scope fingerprint excludes page cursors but includes filters', () => {
  const first = core.stableScopeFingerprint({ pathname: '/product/manage', search: '?shop_region=GB&page=1', filters: ['在售'] });
  const second = core.stableScopeFingerprint({ pathname: '/product/manage', search: '?page=2&shop_region=GB', filters: ['在售'] });
  const filtered = core.stableScopeFingerprint({ pathname: '/product/manage', search: '?shop_region=GB&page=2', filters: ['草稿'] });
  assert.equal(first, second);
  assert.notEqual(first, filtered);
});
