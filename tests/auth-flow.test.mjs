import assert from 'node:assert/strict';
import test from 'node:test';

let onMessage;
let cookieValue = '';
let bootstrapCount = 0;
let bootstrapSetsCookie = true;
let closedTabs = [];
let loginSteps = [];

globalThis.chrome = {
  runtime: { onMessage: { addListener(listener) { onMessage = listener; } } },
  tabs: {
    onRemoved: { addListener() {} },
    async get(tabId) {
      if (tabId === 55) return { status: 'complete' };
      loginSteps.push(['get', tabId]);
      return { windowId: 9 };
    },
    async create(options) {
      if (new URL(options.url).hostname === 'h5api.m.1688.com') {
        bootstrapCount += 1;
        assert.equal(new URL(options.url).searchParams.get('sign'), '0');
        assert.equal(options.active, false);
        if (bootstrapSetsCookie) cookieValue = 'bootstrapped_token';
        return { id: 55 };
      }
      loginSteps.push(['create', options]);
      return { id: 55 };
    },
    async update(tabId, options) { loginSteps.push(['update', tabId, options]); },
    async remove(tabId) { closedTabs.push(tabId); },
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

await import('../extension/background.js');

function send(message, sender = {}) {
  return new Promise((resolve) => {
    assert.equal(onMessage(message, sender, resolve), true);
  });
}

test('missing MTop cookie is initialized before reporting ready', async () => {
  cookieValue = '';
  bootstrapCount = 0;
  bootstrapSetsCookie = true;
  closedTabs = [];
  assert.deepEqual(await send({ type: 'CHECK_1688_TOKEN' }), { ok: true });
  assert.equal(bootstrapCount, 1);
  assert.deepEqual(closedTabs, [55]);
});

test('existing MTop cookie skips initialization', async () => {
  cookieValue = 'existing_token';
  bootstrapCount = 0;
  assert.deepEqual(await send({ type: 'CHECK_1688_TOKEN' }), { ok: true });
  assert.equal(bootstrapCount, 0);
});

test('missing cookie after initialization does not report ready', async () => {
  cookieValue = '';
  bootstrapCount = 0;
  bootstrapSetsCookie = false;
  closedTabs = [];
  assert.deepEqual(await send({ type: 'CHECK_1688_TOKEN' }), { ok: false });
  assert.equal(bootstrapCount, 1);
  assert.deepEqual(closedTabs, [55]);
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
