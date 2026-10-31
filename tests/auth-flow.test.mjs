import assert from 'node:assert/strict';
import test from 'node:test';

let onMessage;
let cookieValue = '';
let cookieListener;
let bootstrapSetsCookie = true;
let requests = [];
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
  if (!sign) {
    if (bootstrapSetsCookie) {
      cookieValue = 'fresh_token';
      cookieListener?.({ removed: false, cookie: { name: '_m_h5_tk', domain: '.1688.com' } });
    }
    return new Response('{"ret":["FAIL_SYS_TOKEN_EMPTY"]}', { status: 200 });
  }
  return new Response('{"data":{"imageId":"123456789"}}', { status: 200 });
};

const { uploadImage } = await import('../extension/background.js');
const image = `data:image/png;base64,${'a'.repeat(120)}`;

function send(message, sender = {}) {
  return new Promise((resolve) => {
    assert.equal(onMessage(message, sender, resolve), true);
  });
}

test('missing token uses the former real-image unsigned request before signed upload', async () => {
  cookieValue = '';
  bootstrapSetsCookie = true;
  requests = [];
  const diagnostics = [];
  const session = await uploadImage(image, new AbortController().signal, (item) => diagnostics.push(item));
  assert.equal(session.image_id, '123456789');
  assert.equal(requests.length, 2);
  assert.equal(requests[0].sign, '');
  assert.ok(requests[1].sign);
  assert.match(decodeURIComponent(requests[0].body), /imageBase64/);
  assert.ok(diagnostics.some((item) => item.stage === 'image_upload_bootstrap' && item.cookie_changed === true && item.credential_found === true));
});

test('existing token skips unsigned initialization', async () => {
  cookieValue = 'existing_token';
  requests = [];
  const session = await uploadImage(image, new AbortController().signal);
  assert.equal(session.image_id, '123456789');
  assert.equal(requests.length, 1);
  assert.ok(requests[0].sign);
});

test('no cookie after unsigned request reports auth failure without signed upload', async () => {
  cookieValue = '';
  bootstrapSetsCookie = false;
  requests = [];
  const diagnostics = [];
  await assert.rejects(uploadImage(image, new AbortController().signal, (item) => diagnostics.push(item)), (error) => error.code === 'auth');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].sign, '');
  assert.ok(diagnostics.some((item) => item.stage === 'image_upload_bootstrap' && item.cookie_changed === false && item.credential_found === false));
});

test('status check does not misreport a missing token as ready', async () => {
  cookieValue = '';
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
