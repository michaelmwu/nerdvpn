const test = require('node:test');
const assert = require('node:assert/strict');

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.removed = false;
    this.textContent = '';
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  append(...children) {
    this.children.push(...children);
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  attachShadow() {
    this.shadowRoot = new FakeElement('shadow-root');
    return this.shadowRoot;
  }

  remove() {
    this.removed = true;
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }
}

function waitForNotice() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('renders a 60-second toast and dismisses it when its lifetime ends', async () => {
  const root = new FakeElement('html');
  const messages = [];

  globalThis.document = {
    createElement: (tagName) => new FakeElement(tagName),
    documentElement: root,
    getElementById: () => null,
  };
  globalThis.window = { location: { href: 'https://nitter.cf/openai' } };
  globalThis.chrome = {
    runtime: {
      lastError: null,
      sendMessage(message, callback) {
        messages.push(message);
        callback(message.type === 'getRedirectNotice'
          ? {
            notice: {
              originalLabel: 'X',
              alternateLabel: 'Nitter',
              actionLabel: 'Go to X',
              actionAriaLabel: 'Go to X in this tab',
            },
          }
          : { ok: true });
      },
    },
  };

  require('../redirect-notice.js');
  await waitForNotice();

  const host = root.children[0];
  const style = host.shadowRoot.children[0];
  assert.match(style.textContent, /nerdvpn-lifetime 60s linear forwards/);
  assert.match(style.textContent, /animation-play-state: paused/);
  assert.match(style.textContent, /unicode-bidi: isolate/);
  assert.equal(host.removed, false);

  const region = host.shadowRoot.children[1];
  const summary = region.children[0];
  const action = region.children[1];
  assert.equal(action.textContent, 'Go to X');
  assert.equal(action.getAttribute('aria-label'), 'Go to X in this tab');
  assert.equal(
    summary.getAttribute('aria-label'),
    'X was redirected to Nitter by NerdVPN. You can return to X in this tab.',
  );

  host.listeners.get('animationend')({
    target: host,
    animationName: 'nerdvpn-lifetime',
  });
  await waitForNotice();

  assert.equal(host.removed, true);
  assert.deepEqual(messages.map((message) => message.type), [
    'getRedirectNotice',
    'dismissRedirectNotice',
  ]);
});
