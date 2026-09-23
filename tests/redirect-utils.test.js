const test = require('node:test');
const assert = require('node:assert/strict');

require('../redirect-utils.js');

const {
  buildBypassRule,
  bypassRuleIdForTab,
  destinationMatches,
  matchRedirect,
  originalUrlForDestination,
} = globalThis.NerdVpnRedirects;

test('matches an X redirect while preserving its route', () => {
  const record = matchRedirect(
    'https://x.com/openai/status/123?ref=home',
    'https://nitter.cf/openai/status/123?ref=home',
  );

  assert.deepEqual(record, {
    kind: 'x',
    originalUrl: 'https://x.com/openai/status/123?ref=home',
    originalLabel: 'X',
    alternateDomains: ['nitter.cf'],
    alternateLabel: 'Nitter',
    allowDomains: ['x.com'],
  });
});

test('does not mistake an unrelated Nitter visit for a NerdVPN redirect', () => {
  assert.equal(matchRedirect(
    'https://example.com/',
    'https://nitter.cf/openai',
  ), null);

  assert.equal(matchRedirect(
    'https://x.com/openai',
    'https://nitter.cf/different-account',
  ), null);
});

test('matches Reddit redirects', () => {
  const record = matchRedirect(
    'https://www.reddit.com/r/javascript/comments/abc/',
    'https://reddit.nerdvpn.de/r/javascript/comments/abc/',
  );

  assert.equal(record.kind, 'reddit');
  assert.equal(record.originalLabel, 'Reddit');
  assert.deepEqual(record.allowDomains, ['reddit.com']);
});

test('matches archive.is redirects with an embedded original URL', () => {
  const original = 'https://www.nytimes.com/2026/09/23/example.html?campaign=test';
  const record = matchRedirect(original, `https://archive.is/${original}`);

  assert.equal(record.kind, 'archive');
  assert.equal(record.originalUrl, original);
  assert.equal(record.originalLabel, 'nytimes.com');
  assert.deepEqual(record.allowDomains, ['nytimes.com']);
});

test('maps navigation on a fixed alternate back to the current original route', () => {
  const record = matchRedirect(
    'https://x.com/openai',
    'https://nitter.cf/openai',
  );

  assert.equal(destinationMatches(record, 'https://nitter.cf/sama/status/456'), true);
  assert.equal(
    originalUrlForDestination(record, 'https://nitter.cf/sama/status/456?lang=en#replies'),
    'https://x.com/sama/status/456?lang=en#replies',
  );
});

test('builds one high-priority tab-scoped bypass rule and merges domains', () => {
  assert.deepEqual(buildBypassRule(42, ['x.com'], ['reddit.com', 'x.com']), {
    id: 42,
    priority: 100,
    action: { type: 'allow' },
    condition: {
      requestDomains: ['reddit.com', 'x.com'],
      resourceTypes: ['main_frame', 'sub_frame'],
      tabIds: [42],
    },
  });
  assert.equal(bypassRuleIdForTab(42), 42);
  assert.equal(bypassRuleIdForTab(0), 2_147_483_647);
  assert.throws(() => bypassRuleIdForTab(-1), /valid tab ID/);
});
