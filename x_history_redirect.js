const X_HOSTS = new Set(['x.com', 'www.x.com']);

function buildNitterUrl(value) {
  const url = new URL(value);

  if (!X_HOSTS.has(url.hostname)) {
    return null;
  }

  url.protocol = 'https:';
  url.hostname = 'nitter.cf';
  url.port = '';
  return url.href;
}

chrome.webNavigation.onHistoryStateUpdated.addListener(
  ({ frameId, tabId, url }) => {
    if (frameId !== 0 || !Number.isInteger(tabId) || tabId < 0) {
      return;
    }

    const redirectUrl = buildNitterUrl(url);

    if (!redirectUrl) {
      return;
    }

    void (async () => {
      const rules = await chrome.declarativeNetRequest.getSessionRules();
      const hasXOverride = rules.some((rule) => (
        rule.action?.type === 'allow'
        && rule.condition?.tabIds?.includes(tabId)
        && rule.condition?.requestDomains?.includes('x.com')
      ));

      if (!hasXOverride) {
        await chrome.tabs.update(tabId, { url: redirectUrl });
      }
    })().catch((error) => {
      console.warn('NerdVPN could not redirect X history navigation.', error);
    });
  },
  {
    url: [{ hostEquals: 'x.com' }, { hostEquals: 'www.x.com' }],
  },
);
