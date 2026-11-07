import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { exportRows, normalizeSources, parseCsv, toCsv, toHtml, toZip } from '../extension/batch-core.mjs';

const require = createRequire(import.meta.url);
const fflate = require('../extension/vendor/fflate.js');

const image = 'https://p16-oec-general.tiktokcdn-eu.com/example.jpeg';

test('Muse CSV import keeps quoted titles and the required source fields', () => {
  const sources = normalizeSources(parseCsv(`\uFEFFrank,product_name,image\r\n1,"Socks, soft\nknit",${image}\r\n`));
  assert.equal(sources.length, 1);
  assert.equal(sources[0].source_title, 'Socks, soft\nknit');
  assert.equal(sources[0].status, '待处理');
});

test('Muse export keeps five candidates in order and marks missing values', () => {
  const source = normalizeSources(parseCsv(`rank,product_name,image\n1,Socks,${image}\n2,Hat,${image}`));
  const candidates = Array.from({ length: 6 }, (_, index) => ({
    offer_id: String(123456789 + index),
    title: `Candidate ${index + 1}`,
    image_url: `https://cbu01.alicdn.com/${index + 1}.jpg`,
    detail_url: `https://detail.1688.com/offer/${123456789 + index}.html`,
    price: { display: '¥3.5' },
  }));
  const rows = exportRows([
    { ...source[0], status: '完成', candidates, similarTotal: 60 },
    { ...source[1], status: '无', candidates: [], similarTotal: 0 },
  ]);
  assert.equal(rows.length, 6);
  assert.deepEqual(rows.slice(0, 5).map((row) => row.candidate_no), [1, 2, 3, 4, 5]);
  assert.equal(rows[0].candidate_price_cny, '3.5');
  assert.equal(rows[0].supplier_city, '未提供');
  assert.equal(rows[5].status, '无');
  assert.equal(rows[5].candidate_title, '');
});

test('Muse CSV and HTML exports escape source content', () => {
  const row = exportRows([{
    source_rank: '1', source_title: '<script>alert(1)</script>', source_image_url: image,
    status: '完成', similarTotal: 1, candidates: [{ title: '=SUM(1,2)', detail_url: 'https://detail.1688.com/offer/123456789.html' }],
  }])[0];
  assert.match(toCsv([row]), /'\=SUM\(1,2\)/);
  const html = toHtml([row]);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
});

test('Muse ZIP contains the same CSV, JSON and HTML as individual exports', () => {
  const rows = exportRows([{ source_rank: '1', source_title: '袜子', source_image_url: image, status: '无', similarTotal: 0, candidates: [] }]);
  const files = fflate.unzipSync(toZip(rows, fflate));
  const decode = (name) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(files[name]);
  assert.deepEqual(Object.keys(files).sort(), ['storesnapper-muse.csv', 'storesnapper-muse.html', 'storesnapper-muse.json']);
  assert.equal(decode('storesnapper-muse.csv'), toCsv(rows));
  assert.equal(decode('storesnapper-muse.json'), JSON.stringify(rows, null, 2));
  assert.equal(decode('storesnapper-muse.html'), toHtml(rows));
});
