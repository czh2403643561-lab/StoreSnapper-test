import assert from 'node:assert/strict';
import test from 'node:test';

let onMessage;
let cookieValue = '';
let pageCookieValue = '';
let cookieListener;
let firstPartyPageAvailable = false;
let firstPartySetsCookie = false;
let requests = [];
let loginSteps = [];

globalThis.chrome = {
  runtime: { onMessage: { addListener(listener) { onMessage = listener; } } },
  tabs: {
    onRemoved: { addListener() {} },
    async query() { return firstPartyPageAvailable ? [{ id: 88, status: 'complete', url: 'https://www.1688.com/' }] : []; },
    async get(tabId) { loginSteps.push(['get', tabId]); return { windowId: 9 }; },
    async create(options) { loginSteps.push(['create', options]); return { id: 55 }; },
    async update(tabId, options) { loginSteps.push(['update', tabId, options]); },
  },
  scripting: {
    async executeScript(options) {
      assert.equal(options.target.tabId, 88);
      assert.equal(options.world, 'ISOLATED');
      if (!options.args) return [{ result: pageCookieValue }];
      assert.match(options.args[1], /imageBase64/);
      const extensionFetch = globalThis.fetch;
      globalThis.fetch = async (url, request) => {
        assert.equal(new URL(url).searchParams.get('sign'), '');
        assert.equal(request.mode, 'no-cors');
        assert.equal(request.credentials, 'include');
        assert.match(decodeURIComponent(request.body), /imageBase64/);
        return { type: 'opaque' };
      };
      try { assert.equal(await options.func(...options.args), 'sent'); }
      finally { globalThis.fetch = extensionFetch; }
      if (firstPartySetsCookie) {
        cookieValue = 'page_token';
        cookieListener?.({ removed: false, cookie: { name: '_m_h5_tk', domain: '.1688.com' } });
      }
      return [{ result: 'sent' }];
    },
  },
  cookies: {
    async getAll() { return cookieValue ? [{ value: cookieValue }] : []; },
    onChanged: {
      addListener(listener) { cookieListener = listener; },
      removeListener(listener) { if (cookieListener === listener) cookieListener = undefined; },
    },
  },
  storage: { session: { async set(value) { loginSteps.push(['set', value]); } } },
};

globalThis.fetch = async (url, options) => {
  const requestUrl = new URL(url);
  const sign = requestUrl.searchParams.get('sign');
  requests.push({ sign, body: options.body, credentials: options.credentials });
  assert.equal(requestUrl.hostname, 'h5api.m.1688.com');
  assert.equal(options.credentials, 'include');
  assert.match(options.body, /^data=/);
  assert.ok(sign);
  return new Response('{"data":{"imageId":"123456789"}}', { status: 200 });
};

const { uploadImage } = await import('../extension/background.js');
const image = `data:image/png;base64,${'a'.repeat(120)}`;

function send(message, sender = {}) {
  return new Promise((resolve) => {
    assert.equal(onMessage(message, sender, resolve), true);
  });
}

test('missing token initializes from an existing 1688 page before signed upload', async () => {
  cookieValue = '';
  pageCookieValue = '';
  firstPartyPageAvailable = true;
  firstPartySetsCookie = true;
  requests = [];
  const diagnostics = [];
  const session = await uploadImage(image, new AbortController().signal, (item) => diagnostics.push(item));
  assert.equal(session.image_id, '123456789');
  assert.equal(requests.length, 1);
  assert.ok(requests[0].sign);
  assert.ok(diagnostics.some((item) => item.stage === 'token_first_party_bootstrap' && item.cookie_changed === true && item.credential_found === true));
});

test('existing token skips unsigned initialization', async () => {
  cookieValue = 'existing_token';
  pageCookieValue = '';
  requests = [];
  const session = await uploadImage(image, new AbortController().signal);
  assert.equal(session.image_id, '123456789');
  assert.equal(requests.length, 1);
  assert.ok(requests[0].sign);
});

test('no 1688 page reports auth failure without signed upload', async () => {
  cookieValue = '';
  pageCookieValue = '';
  firstPartyPageAvailable = false;
  firstPartySetsCookie = false;
  requests = [];
  const diagnostics = [];
  await assert.rejects(uploadImage(image, new AbortController().signal, (item) => diagnostics.push(item)), (error) => error.code === 'auth');
  assert.equal(requests.length, 0);
  assert.ok(diagnostics.some((item) => item.stage === 'token_first_party_bootstrap' && item.outcome === 'no_page' && item.credential_found === false));
});

test('1688 page request without a new cookie remains an auth failure', async () => {
  cookieValue = '';
  pageCookieValue = '';
  firstPartyPageAvailable = true;
  firstPartySetsCookie = false;
  requests = [];
  const diagnostics = [];
  await assert.rejects(uploadImage(image, new AbortController().signal, (item) => diagnostics.push(item)), (error) => error.code === 'auth');
  assert.equal(requests.length, 0);
  assert.ok(diagnostics.some((item) => item.stage === 'token_first_party_bootstrap' && item.outcome === 'sent' && item.credential_found === false));
});

test('visible 1688 page token restores the original working fallback', async () => {
  cookieValue = '';
  pageCookieValue = 'page_token_123';
  firstPartyPageAvailable = true;
  firstPartySetsCookie = false;
  requests = [];
  const diagnostics = [];
  const session = await uploadImage(image, new AbortController().signal, (item) => diagnostics.push(item));
  assert.equal(session.image_id, '123456789');
  assert.equal(requests.length, 1);
  assert.ok(diagnostics.some((item) => item.stage === 'token_page_cookie' && item.credential_found === true));
  assert.ok(!diagnostics.some((item) => item.stage === 'token_first_party_bootstrap'));
});

test('status check does not misreport a missing token as ready', async () => {
  cookieValue = '';
  pageCookieValue = '';
  assert.deepEqual(await send({ type: 'CHECK_1688_TOKEN' }), { ok: false });
});

test('login page opens in the Temu window after return context is saved', async () => {
  loginSteps = [];
  assert.deepEqual(await send({ type: 'OPEN_1688_LOGIN' }, { tab: { id: 42 } }), { ok: true });
  assert.deepEqual(loginSteps.map((step) => step[0]), ['get', 'create', 'set', 'update']);
  assert.equal(loginSteps[1][1].windowId, 9);
  assert.equal(loginSteps[1][1].active, false);
  assert.deepEqual(loginSteps[2][1].storesnapper_1688_auth_flow, { originTabId: 42, authTabId: 55 });
  assert.equal(loginSteps[3][1], 55);
});
