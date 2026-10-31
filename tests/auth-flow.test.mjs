import assert from 'node:assert/strict';
import test from 'node:test';

let onMessage;
let cookieValue = '';
let fetchCount = 0;
let loginSteps = [];

globalThis.chrome = {
  runtime: { onMessage: { addListener(listener) { onMessage = listener; } } },
  tabs: {
    onRemoved: { addListener() {} },
    async get(tabId) { loginSteps.push(['get', tabId]); return { windowId: 9 }; },
    async create(options) { loginSteps.push(['create', options]); return { id: 55 }; },
    async update(tabId, options) { loginSteps.push(['update', tabId, options]); },
  },
  cookies: {
    async getAll() { return cookieValue ? [{ value: cookieValue }] : []; },
  },
  storage: {
    session: {
      async set(value) { loginSteps.push(['set', value]); },
    },
  },
};

globalThis.fetch = async (url, options) => {
  fetchCount += 1;
  const requestUrl = new URL(url);
  assert.equal(requestUrl.hostname, 'h5api.m.1688.com');
  assert.equal(requestUrl.searchParams.get('sign'), '0');
  assert.equal(options.credentials, 'include');
  assert.equal(options.body, 'data=%7B%7D');
  if (fetchCount === 1) cookieValue = 'bootstrapped_token';
  return new Response('{"ret":["FAIL_SYS_TOKEN_EMPTY"]}', { status: 200 });
};

await import('../extension/background.js');

function send(message, sender = {}) {
  return new Promise((resolve) => {
    assert.equal(onMessage(message, sender, resolve), true);
  });
}

test('missing MTop cookie is initialized before reporting ready', async () => {
  cookieValue = '';
  fetchCount = 0;
  assert.deepEqual(await send({ type: 'CHECK_1688_TOKEN' }), { ok: true });
  assert.equal(fetchCount, 1);
});

test('existing MTop cookie skips initialization', async () => {
  cookieValue = 'existing_token';
  fetchCount = 0;
  assert.deepEqual(await send({ type: 'CHECK_1688_TOKEN' }), { ok: true });
  assert.equal(fetchCount, 0);
});

test('missing cookie after initialization does not report ready', async () => {
  cookieValue = '';
  fetchCount = 1;
  assert.deepEqual(await send({ type: 'CHECK_1688_TOKEN' }), { ok: false });
  assert.equal(fetchCount, 2);
});

test('login page opens in the Temu window after return context is saved', async () => {
  loginSteps = [];
  assert.deepEqual(await send({ type: 'OPEN_1688_LOGIN' }, { tab: { id: 42 } }), { ok: true });
  assert.deepEqual(loginSteps.map((step) => step[0]), ['get', 'create', 'set', 'update']);
  assert.equal(loginSteps[1][1].windowId, 9);
  assert.equal(loginSteps[1][1].active, false);
  assert.deepEqual(loginSteps[2][1].storesnapper_1688_auth_flow, { originTabId: 42, authTabId: 55 });
  assert.equal(loginSteps[3][1], 55);
  assert.deepEqual(loginSteps[3][2], { active: true });
});
