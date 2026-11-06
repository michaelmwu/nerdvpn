const test = require('node:test');
const assert = require('node:assert/strict');

class FakeElement {
  constructor(id) {
    this.id = id;
    this.attributes = new Map();
    this.listeners = new Map();
    this.disabled = false;
    this.focused = false;
    this.hidden = false;
    this.textContent = '';
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  focus() {
    this.focused = true;
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }
}

function waitForRender() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('renders typed recovery state and dispatches the tab-scoped original action', async () => {
  const elements = new Map([
    'recovery',
    'failure-title',
    'failure-description',
    'failure-actions',
    'open-original',
    'retry-alternate',
    'scope-label',
    'error-message',
  ].map((id) => [id, new FakeElement(id)]));
  const messages = [];

  globalThis.document = {
    title: '',
    getElementById(id) {
      return elements.get(id);
    },
  };
  globalThis.window = {
    location: { href: 'chrome-extension://test/redirect-error.html' },
  };
  globalThis.chrome = {
    runtime: {
      lastError: null,
      sendMessage(message, callback) {
        messages.push(message);
        callback(message.type === 'getRedirectFailure'
          ? {
            failure: {
              title: 'Reddit mirror didn’t respond',
              description: 'reddit.nerdvpn.de took too long to respond.',
              actionLabel: 'Go to Reddit',
              actionAriaLabel: 'Go to Reddit in this tab',
              retryLabel: 'Try again',
              retryAriaLabel: 'Try Reddit mirror again',
              scopeLabel: 'This tab will use Reddit until you close it.',
            },
          }
          : { ok: true });
      },
    },
  };

  require('../redirect-error.js');
  await waitForRender();

  const recovery = elements.get('recovery');
  const title = elements.get('failure-title');
  const description = elements.get('failure-description');
  const openOriginal = elements.get('open-original');
  const retryAlternate = elements.get('retry-alternate');
  const scopeLabel = elements.get('scope-label');

  assert.equal(document.title, 'Reddit mirror didn’t respond · NerdVPN');
  assert.equal(title.textContent, 'Reddit mirror didn’t respond');
  assert.equal(title.focused, true);
  assert.equal(description.textContent, 'reddit.nerdvpn.de took too long to respond.');
  assert.equal(openOriginal.textContent, 'Go to Reddit');
  assert.equal(openOriginal.getAttribute('aria-label'), 'Go to Reddit in this tab');
  assert.equal(retryAlternate.getAttribute('aria-label'), 'Try Reddit mirror again');
  assert.equal(
    scopeLabel.textContent,
    'This tab will use Reddit until you close it.',
  );
  assert.equal(recovery.getAttribute('aria-busy'), 'false');

  openOriginal.listeners.get('click')();
  await waitForRender();

  assert.equal(openOriginal.textContent, 'Opening…');
  assert.equal(openOriginal.disabled, true);
  assert.equal(retryAlternate.disabled, true);
  assert.deepEqual(messages.at(-1), {
    type: 'bypassFailedRedirect',
    currentUrl: 'chrome-extension://test/redirect-error.html',
  });
});
