importScripts('redirect-utils.js');

const {
  buildBypassRule,
  bypassRuleIdForTab,
  destinationMatches,
  matchRedirect,
  originalUrlForDestination,
} = globalThis.NerdVpnRedirects;

const ACTIVE_REDIRECT_KEY_PREFIX = 'activeRedirect:';
const REDIRECT_WINDOW_MS = 15_000;

const pendingNavigations = new Map();
const activeRedirects = new Map();

function activeRedirectKey(tabId) {
  return `${ACTIVE_REDIRECT_KEY_PREFIX}${tabId}`;
}

function isMainFrameNavigation(details) {
  return details.frameId === 0 && Number.isInteger(details.tabId) && details.tabId >= 0;
}

async function storeActiveRedirect(tabId, record) {
  activeRedirects.set(tabId, record);
  await chrome.storage.session.set({ [activeRedirectKey(tabId)]: record });
}

async function getActiveRedirect(tabId) {
  const inMemory = activeRedirects.get(tabId);
  if (inMemory) {
    return inMemory;
  }

  const key = activeRedirectKey(tabId);
  const stored = await chrome.storage.session.get(key);
  const record = stored[key] ?? null;
  if (record) {
    activeRedirects.set(tabId, record);
  }
  return record;
}

async function clearActiveRedirect(tabId) {
  activeRedirects.delete(tabId);
  await chrome.storage.session.remove(activeRedirectKey(tabId));
}

function recordNavigation(details) {
  if (!isMainFrameNavigation(details)) {
    return;
  }

  const current = { url: details.url, timeStamp: details.timeStamp };
  const previous = pendingNavigations.get(details.tabId);
  pendingNavigations.set(details.tabId, current);

  if (!previous || current.timeStamp - previous.timeStamp > REDIRECT_WINDOW_MS) {
    return;
  }

  const redirect = matchRedirect(previous.url, current.url);
  if (!redirect) {
    return;
  }

  void storeActiveRedirect(details.tabId, {
    ...redirect,
    destinationUrl: current.url,
    detectedAt: Date.now(),
  }).catch((error) => {
    console.warn('NerdVPN could not remember the redirect.', error);
  });
}

async function finishNavigation(details) {
  if (!isMainFrameNavigation(details)) {
    return;
  }

  const pending = pendingNavigations.get(details.tabId);
  pendingNavigations.delete(details.tabId);

  if (pending && details.timeStamp - pending.timeStamp <= REDIRECT_WINDOW_MS) {
    const redirect = matchRedirect(pending.url, details.url);
    if (redirect) {
      await storeActiveRedirect(details.tabId, {
        ...redirect,
        destinationUrl: details.url,
        detectedAt: Date.now(),
      });
      return;
    }
  }

  const record = await getActiveRedirect(details.tabId);
  if (record && !destinationMatches(record, details.url)) {
    await clearActiveRedirect(details.tabId);
  }
}

async function getRedirectNotice(tabId, currentUrl) {
  const record = await getActiveRedirect(tabId);
  if (!record || !destinationMatches(record, currentUrl)) {
    return null;
  }

  return {
    originalLabel: record.originalLabel,
    alternateLabel: record.alternateLabel,
    actionLabel: 'Use original',
    actionAriaLabel: `Use ${record.originalLabel} in this tab`,
  };
}

async function bypassRedirect(tabId, currentUrl) {
  const record = await getActiveRedirect(tabId);
  if (!record || !destinationMatches(record, currentUrl)) {
    throw new Error('This redirect is no longer active.');
  }

  const originalUrl = originalUrlForDestination(record, currentUrl);
  if (!originalUrl) {
    throw new Error('NerdVPN could not determine the original page.');
  }

  const ruleId = bypassRuleIdForTab(tabId);
  const sessionRules = await chrome.declarativeNetRequest.getSessionRules();
  const existingRule = sessionRules.find((rule) => rule.id === ruleId);
  const existingDomains = existingRule?.condition?.requestDomains ?? [];
  const bypassRule = buildBypassRule(tabId, record.allowDomains, existingDomains);

  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [ruleId],
    addRules: [bypassRule],
  });
  await chrome.tabs.update(tabId, { url: originalUrl });
  await clearActiveRedirect(tabId);
}

async function cleanUpTab(tabId) {
  pendingNavigations.delete(tabId);
  await Promise.all([
    clearActiveRedirect(tabId),
    chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [bypassRuleIdForTab(tabId)],
    }),
  ]);
}

chrome.webNavigation.onBeforeNavigate.addListener(recordNavigation);
chrome.webNavigation.onCommitted.addListener((details) => {
  void finishNavigation(details).catch((error) => {
    console.warn('NerdVPN could not update redirect state.', error);
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  if (!Number.isInteger(tabId)) {
    return false;
  }

  if (message?.type === 'getRedirectNotice') {
    getRedirectNotice(tabId, message.currentUrl)
      .then((notice) => sendResponse({ notice }))
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }

  if (message?.type === 'dismissRedirectNotice') {
    clearActiveRedirect(tabId)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }

  if (message?.type === 'bypassRedirect') {
    bypassRedirect(tabId, message.currentUrl)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }

  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void cleanUpTab(tabId).catch((error) => {
    console.warn('NerdVPN could not clean up the tab override.', error);
  });
});

chrome.tabs.onReplaced.addListener((_addedTabId, removedTabId) => {
  void cleanUpTab(removedTabId).catch((error) => {
    console.warn('NerdVPN could not clean up the replaced tab override.', error);
  });
});
