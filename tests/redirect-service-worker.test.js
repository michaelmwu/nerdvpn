const test = require('node:test');
const assert = require('node:assert/strict');

const listeners = {};
const sessionStorage = {};
let sessionRules = [];
const tabUpdates = [];
const redirectErrorUrl = 'chrome-extension://test/redirect-error.html';

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
    getURL(path) {
      return `chrome-extension://test/${path}`;
    },
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
    onErrorOccurred: event('navigationError'),
  },
};

require('../redirect-service-worker.js');

function sendMessage(message, tabId) {
  return new Promise((resolve) => {
    const handledAsynchronously = listeners.message(message, {
      tab: { id: tabId },
      url: message.currentUrl,
    }, resolve);
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
      actionLabel: 'Go to X',
      actionAriaLabel: 'Go to X in this tab',
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

test('replaces a timed-out mirror with recovery and opens the original in this tab', async () => {
  const tabId = 252;
  const updateStart = tabUpdates.length;

  listeners.beforeNavigate({
    frameId: 0,
    tabId,
    timeStamp: 3_000,
    url: 'https://reddit.com/r/privacy?sort=top',
  });
  listeners.beforeNavigate({
    frameId: 0,
    tabId,
    timeStamp: 3_100,
    url: 'https://reddit.nerdvpn.de/r/privacy?sort=top',
  });
  await waitForAsyncListeners();

  listeners.navigationError({
    error: 'net::ERR_CONNECTION_TIMED_OUT',
    frameId: 0,
    tabId,
    timeStamp: 3_200,
    url: 'https://reddit.nerdvpn.de/r/privacy?sort=top',
  });
  await waitForAsyncListeners();

  assert.deepEqual(tabUpdates.slice(updateStart), [{
    tabId,
    update: { url: redirectErrorUrl },
  }]);

  listeners.beforeNavigate({
    frameId: 0,
    tabId,
    timeStamp: 3_300,
    url: redirectErrorUrl,
  });
  listeners.committed({
    frameId: 0,
    tabId,
    timeStamp: 3_350,
    url: redirectErrorUrl,
  });
  await waitForAsyncListeners();

  assert.deepEqual(await sendMessage({
    type: 'getRedirectFailure',
    currentUrl: redirectErrorUrl,
  }, tabId), {
    failure: {
      title: 'Reddit mirror didn’t respond',
      description: 'reddit.nerdvpn.de took too long to respond.',
      actionLabel: 'Go to Reddit',
      actionAriaLabel: 'Go to Reddit in this tab',
      retryLabel: 'Try again',
      retryAriaLabel: 'Try Reddit mirror again',
      scopeLabel: 'This tab will use Reddit until you close it.',
    },
  });

  assert.deepEqual(await sendMessage({
    type: 'bypassFailedRedirect',
    currentUrl: redirectErrorUrl,
  }, tabId), { ok: true });

  assert.deepEqual(sessionRules, [{
    id: tabId,
    priority: 100,
    action: { type: 'allow' },
    condition: {
      requestDomains: ['reddit.com'],
      resourceTypes: ['main_frame', 'sub_frame'],
      tabIds: [tabId],
    },
  }]);
  assert.deepEqual(tabUpdates.at(-1), {
    tabId,
    update: { url: 'https://reddit.com/r/privacy?sort=top' },
  });

  listeners.tabRemoved(tabId);
  await waitForAsyncListeners();
  assert.deepEqual(sessionRules, []);
});

test('retries the same alternate URL without installing a bypass', async () => {
  const tabId = 253;
  const alternateUrl = 'https://nitter.cf/openai/status/123';

  listeners.beforeNavigate({
    frameId: 0,
    tabId,
    timeStamp: 4_000,
    url: 'https://x.com/openai/status/123',
  });
  listeners.beforeNavigate({
    frameId: 0,
    tabId,
    timeStamp: 4_100,
    url: alternateUrl,
  });
  await waitForAsyncListeners();
  listeners.navigationError({
    error: 'net::ERR_CONNECTION_REFUSED',
    frameId: 0,
    tabId,
    timeStamp: 4_200,
    url: alternateUrl,
  });
  await waitForAsyncListeners();

  listeners.beforeNavigate({
    frameId: 0,
    tabId,
    timeStamp: 4_300,
    url: redirectErrorUrl,
  });
  listeners.committed({
    frameId: 0,
    tabId,
    timeStamp: 4_350,
    url: redirectErrorUrl,
  });
  await waitForAsyncListeners();

  assert.deepEqual(await sendMessage({
    type: 'retryFailedRedirect',
    currentUrl: redirectErrorUrl,
  }, tabId), { ok: true });
  assert.deepEqual(tabUpdates.at(-1), { tabId, update: { url: alternateUrl } });
  assert.deepEqual(sessionRules, []);
  assert.deepEqual(await sendMessage({
    type: 'getRedirectFailure',
    currentUrl: redirectErrorUrl,
  }, tabId), { failure: null });

  listeners.tabRemoved(tabId);
  await waitForAsyncListeners();
});

test('leaves cancelled and certificate-error navigations to Chrome', async () => {
  const tabId = 254;
  const updateStart = tabUpdates.length;

  listeners.beforeNavigate({
    frameId: 0,
    tabId,
    timeStamp: 5_000,
    url: 'https://x.com/openai',
  });
  listeners.beforeNavigate({
    frameId: 0,
    tabId,
    timeStamp: 5_100,
    url: 'https://nitter.cf/openai',
  });
  await waitForAsyncListeners();

  for (const error of ['net::ERR_ABORTED', 'net::ERR_CERT_DATE_INVALID']) {
    listeners.navigationError({
      error,
      frameId: 0,
      tabId,
      timeStamp: 5_200,
      url: 'https://nitter.cf/openai',
    });
  }
  await waitForAsyncListeners();

  assert.deepEqual(tabUpdates.slice(updateStart), []);
  listeners.tabRemoved(tabId);
  await waitForAsyncListeners();
});
