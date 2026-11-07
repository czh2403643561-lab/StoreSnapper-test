import assert from 'node:assert/strict';
import test from 'node:test';

let onMessage;
const batchUrl = 'chrome-extension://storesnapper-test/batch.html';

globalThis.chrome = {
  runtime: {
    id: 'storesnapper-test',
    getURL: (path) => `chrome-extension://storesnapper-test/${path}`,
    onMessage: { addListener(listener) { onMessage = listener; } },
  },
  tabs: {
    onRemoved: { addListener() {} },
    async get(id) { return { id, url: batchUrl }; },
  },
};
await import('../extension/background.js');

function send(message, sender) {
  return new Promise((resolve) => onMessage(message, sender, resolve));
}

test('main extension accepts its own batch page without sender.tab', async () => {
  const response = await send(
    { type: 'SEARCH_IMAGE', tabId: 7, requestId: 'batch-1', imageUrl: 'not-an-image-url' },
    { id: 'storesnapper-test', url: batchUrl },
  );
  assert.equal(response.ok, false);
  assert.match(response.error, /图片链接无效/);
});

test('main extension keeps the original page search entry', async () => {
  const response = await send(
    { type: 'SEARCH_IMAGE', requestId: 'page-1', imageUrl: 'not-an-image-url' },
    { tab: { id: 8 } },
  );
  assert.equal(response.ok, false);
  assert.match(response.error, /商品图片信息无效/);
});

test('main extension rejects other extension pages', async () => {
  const response = await send(
    { type: 'SEARCH_IMAGE', tabId: 7, requestId: 'other-1', imageUrl: 'not-an-image-url' },
    { id: 'storesnapper-test', url: 'chrome-extension://storesnapper-test/other.html' },
  );
  assert.equal(response.ok, false);
  assert.match(response.error, /Temu 商品图片/);
});
