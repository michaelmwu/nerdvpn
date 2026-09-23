import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const rules = JSON.parse(
  readFileSync(new URL('../rules/x_redirects.json', import.meta.url), 'utf8'),
);
const manifest = JSON.parse(
  readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'),
);

function applyRedirectTransform(source, rule) {
  const url = new URL(source);

  if (!rule.condition.requestDomains.includes(url.hostname)) {
    return null;
  }

  const { scheme, host } = rule.action.redirect.transform;
  url.protocol = `${scheme}:`;
  url.hostname = host;
  return url.href;
}

test('X status links redirect to nitter.cf with their path and query intact', () => {
  const [rule] = rules;
  const source = 'https://x.com/eglyman/status/2098049270553383031?s=46';

  assert.ok(rule.condition.resourceTypes.includes('main_frame'));
  assert.equal(
    applyRedirectTransform(source, rule),
    'https://nitter.cf/eglyman/status/2098049270553383031?s=46',
  );
});

test('X history-state navigations redirect to nitter.cf', async () => {
  let listener;
  let eventFilter;
  let updateCall;

  globalThis.chrome = {
    tabs: {
      update: (...args) => {
        updateCall = args;
        return Promise.resolve();
      },
    },
    webNavigation: {
      onHistoryStateUpdated: {
        addListener: (callback, filter) => {
          listener = callback;
          eventFilter = filter;
        },
      },
    },
  };

  try {
    await import(`../x_history_redirect.js?test=${Date.now()}`);

    assert.ok(manifest.permissions.includes('webNavigation'));
    assert.equal(manifest.background.service_worker, 'x_history_redirect.js');
    assert.deepEqual(eventFilter, {
      url: [{ hostEquals: 'x.com' }, { hostEquals: 'www.x.com' }],
    });

    listener({
      frameId: 1,
      tabId: 42,
      url: 'https://x.com/embedded/status/2098049270553383031?s=46',
    });

    assert.equal(updateCall, undefined);

    listener({
      frameId: 0,
      tabId: 42,
      url: 'https://x.com/eglyman/status/2098049270553383031?s=46',
    });

    assert.deepEqual(updateCall, [
      42,
      { url: 'https://nitter.cf/eglyman/status/2098049270553383031?s=46' },
    ]);
  } finally {
    delete globalThis.chrome;
  }
});
