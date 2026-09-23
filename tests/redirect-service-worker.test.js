const test = require('node:test');
const assert = require('node:assert/strict');

const listeners = {};
const sessionStorage = {};
let sessionRules = [];
const tabUpdates = [];

function event(name) {
  return {
    addListener(listener) {
      listeners[name] = listener;
    },
  };
}

globalThis.importScripts = (filename) => require(`../${filename}`);
globalThis.chrome = {
  declarativeNetRequest: {
    async getSessionRules() {
      return structuredClone(sessionRules);
    },
    async updateSessionRules({ removeRuleIds = [], addRules = [] }) {
      sessionRules = sessionRules.filter((rule) => !removeRuleIds.includes(rule.id));
      sessionRules.push(...structuredClone(addRules));
    },
  },
  runtime: {
    onMessage: event('message'),
  },
  storage: {
    session: {
      async get(key) {
        return Object.prototype.hasOwnProperty.call(sessionStorage, key)
          ? { [key]: structuredClone(sessionStorage[key]) }
          : {};
      },
      async remove(key) {
        delete sessionStorage[key];
      },
      async set(values) {
        Object.assign(sessionStorage, structuredClone(values));
      },
    },
  },
  tabs: {
    onRemoved: event('tabRemoved'),
    onReplaced: event('tabReplaced'),
    async update(tabId, update) {
      tabUpdates.push({ tabId, update });
    },
  },
  webNavigation: {
    onBeforeNavigate: event('beforeNavigate'),
    onCommitted: event('committed'),
  },
};

require('../redirect-service-worker.js');

function sendMessage(message, tabId) {
  return new Promise((resolve) => {
    const handledAsynchronously = listeners.message(message, { tab: { id: tabId } }, resolve);
    assert.equal(handledAsynchronously, true);
  });
}

function waitForAsyncListeners() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('tracks a committed redirect, bypasses it in one tab, and cleans up on close', async () => {
  const tabId = 250;
  listeners.beforeNavigate({
    frameId: 0,
    tabId,
    timeStamp: 1_000,
    url: 'https://x.com/openai?source=test',
  });
  listeners.committed({
    frameId: 0,
    tabId,
    timeStamp: 1_250,
    url: 'https://nitter.cf/openai?source=test',
  });
  await waitForAsyncListeners();

  assert.deepEqual(await sendMessage({
    type: 'getRedirectNotice',
    currentUrl: 'https://nitter.cf/openai?source=test',
  }, tabId), {
    notice: {
      originalLabel: 'X',
      alternateLabel: 'Nitter',
      actionLabel: 'Use X in this tab',
    },
  });

  assert.deepEqual(await sendMessage({
    type: 'bypassRedirect',
    currentUrl: 'https://nitter.cf/openai/status/123',
  }, tabId), { ok: true });

  assert.deepEqual(sessionRules, [{
    id: tabId,
    priority: 100,
    action: { type: 'allow' },
    condition: {
      requestDomains: ['x.com'],
      resourceTypes: ['main_frame', 'sub_frame'],
      tabIds: [tabId],
    },
  }]);
  assert.deepEqual(tabUpdates, [{
    tabId,
    update: { url: 'https://x.com/openai/status/123' },
  }]);

  listeners.tabRemoved(tabId);
  await waitForAsyncListeners();
  assert.deepEqual(sessionRules, []);
  assert.deepEqual(sessionStorage, {});
});

test('does not show a notice for a direct visit to an alternate site', async () => {
  const tabId = 251;
  listeners.beforeNavigate({
    frameId: 0,
    tabId,
    timeStamp: 2_000,
    url: 'https://nitter.cf/openai',
  });
  listeners.committed({
    frameId: 0,
    tabId,
    timeStamp: 2_100,
    url: 'https://nitter.cf/openai',
  });
  await waitForAsyncListeners();

  assert.deepEqual(await sendMessage({
    type: 'getRedirectNotice',
    currentUrl: 'https://nitter.cf/openai',
  }, tabId), { notice: null });
});
