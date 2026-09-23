(() => {
  const FIXED_REDIRECTS = [
    {
      kind: 'x',
      originalDomains: ['x.com', 'www.x.com'],
      originalLabel: 'X',
      alternateDomains: ['nitter.cf'],
      alternateLabel: 'Nitter',
      allowDomains: ['x.com'],
    },
    {
      kind: 'reddit',
      originalDomains: ['reddit.com', 'www.reddit.com'],
      originalLabel: 'Reddit',
      alternateDomains: ['reddit.nerdvpn.de'],
      alternateLabel: 'Reddit mirror',
      allowDomains: ['reddit.com'],
    },
  ];

  const ARCHIVE_DOMAIN = 'archive.is';
  const BYPASS_RULE_PRIORITY = 100;
  const MAX_RULE_ID = 2_147_483_647;

  function parseHttpUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
    } catch {
      return null;
    }
  }

  function withoutHash(url) {
    const normalized = new URL(url.href);
    normalized.hash = '';
    return normalized.href;
  }

  function hasDomain(url, domains) {
    return domains.includes(url.hostname.toLowerCase());
  }

  function hasSameRoute(original, alternate) {
    return original.pathname === alternate.pathname && original.search === alternate.search;
  }

  function matchRedirect(originalValue, alternateValue) {
    const original = parseHttpUrl(originalValue);
    const alternate = parseHttpUrl(alternateValue);

    if (!original || !alternate) {
      return null;
    }

    const fixedRedirect = FIXED_REDIRECTS.find((candidate) => (
      hasDomain(original, candidate.originalDomains)
      && hasDomain(alternate, candidate.alternateDomains)
      && hasSameRoute(original, alternate)
    ));

    if (fixedRedirect) {
      return {
        kind: fixedRedirect.kind,
        originalUrl: original.href,
        originalLabel: fixedRedirect.originalLabel,
        alternateDomains: fixedRedirect.alternateDomains,
        alternateLabel: fixedRedirect.alternateLabel,
        allowDomains: fixedRedirect.allowDomains,
      };
    }

    const expectedArchiveUrl = `https://${ARCHIVE_DOMAIN}/${withoutHash(original)}`;
    if (alternate.hostname.toLowerCase() === ARCHIVE_DOMAIN
      && withoutHash(alternate) === expectedArchiveUrl) {
      const originalDomain = original.hostname.toLowerCase().replace(/^www\./, '');
      return {
        kind: 'archive',
        originalUrl: original.href,
        originalLabel: originalDomain,
        alternateDomains: [ARCHIVE_DOMAIN],
        alternateLabel: ARCHIVE_DOMAIN,
        allowDomains: [originalDomain],
      };
    }

    return null;
  }

  function destinationMatches(record, value) {
    const url = parseHttpUrl(value);
    return Boolean(url && hasDomain(url, record.alternateDomains));
  }

  function originalUrlForDestination(record, destinationValue) {
    const destination = parseHttpUrl(destinationValue);
    const original = parseHttpUrl(record.originalUrl);

    if (!destination || !original || !destinationMatches(record, destination.href)) {
      return null;
    }

    if (record.kind === 'archive') {
      return original.href;
    }

    const currentOriginal = new URL(original.origin);
    currentOriginal.pathname = destination.pathname;
    currentOriginal.search = destination.search;
    currentOriginal.hash = destination.hash;
    return currentOriginal.href;
  }

  function bypassRuleIdForTab(tabId) {
    if (!Number.isInteger(tabId) || tabId < 0 || tabId > MAX_RULE_ID) {
      throw new TypeError('A valid tab ID is required.');
    }

    return tabId === 0 ? MAX_RULE_ID : tabId;
  }

  function buildBypassRule(tabId, domains, existingDomains = []) {
    const requestDomains = Array.from(new Set([...existingDomains, ...domains]
      .map((domain) => domain.trim().toLowerCase())
      .filter(Boolean)))
      .sort();

    if (requestDomains.length === 0) {
      throw new TypeError('At least one redirect domain is required.');
    }

    return {
      id: bypassRuleIdForTab(tabId),
      priority: BYPASS_RULE_PRIORITY,
      action: { type: 'allow' },
      condition: {
        requestDomains,
        resourceTypes: ['main_frame', 'sub_frame'],
        tabIds: [tabId],
      },
    };
  }

  globalThis.NerdVpnRedirects = Object.freeze({
    buildBypassRule,
    bypassRuleIdForTab,
    destinationMatches,
    matchRedirect,
    originalUrlForDestination,
  });
})();
