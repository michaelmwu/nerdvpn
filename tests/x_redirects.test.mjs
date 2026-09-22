import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const rules = JSON.parse(
  readFileSync(new URL('../rules/x_redirects.json', import.meta.url), 'utf8'),
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

test('X status links redirect to xcancel with their path and query intact', () => {
  const [rule] = rules;
  const source = 'https://x.com/eglyman/status/2098049270553383031?s=46';

  assert.ok(rule.condition.resourceTypes.includes('main_frame'));
  assert.equal(
    applyRedirectTransform(source, rule),
    'https://xcancel.com/eglyman/status/2098049270553383031?s=46',
  );
});
