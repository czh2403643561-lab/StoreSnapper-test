import assert from 'node:assert/strict';
import test from 'node:test';

let onMessage;
const batchUrl = 'chrome-extension://muse-test/batch.html';
globalThis.chrome = {
  runtime: {
    id: 'muse-test',
    getURL: (path) => `chrome-extension://muse-test/${path}`,
    onMessage: { addListener(listener) { onMessage = listener; } },
  },
  action: { onClicked: { addListener() {} } },
  tabs: {
    onRemoved: { addListener() {} },
    async get(id) { return { id, url: batchUrl }; },
  },
};
await import('../muse-edition/extension/background.js');

function send(message, sender) {
  return new Promise((resolve) => onMessage(message, sender, resolve));
}

test('Muse batch page can reach search validation without sender.tab', async () => {
  const response = await send(
    { type: 'SEARCH_IMAGE', tabId: 7, requestId: 'request-1', imageUrl: 'not-an-image-url' },
    { id: 'muse-test', url: batchUrl },
  );
  assert.equal(response.ok, false);
  assert.match(response.error, /图片链接无效/);
});

test('Muse search rejects messages from other extension pages', async () => {
  const response = await send(
    { type: 'SEARCH_IMAGE', tabId: 7, requestId: 'request-2', imageUrl: 'not-an-image-url' },
    { id: 'muse-test', url: 'chrome-extension://muse-test/other.html' },
  );
  assert.equal(response.ok, false);
  assert.match(response.error, /批量图搜页/);
});
