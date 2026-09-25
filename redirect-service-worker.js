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
const REDIRECT_ERROR_PAGE_URL = chrome.runtime.getURL('redirect-error.html');
const RECOVERABLE_NAVIGATION_ERRORS = new Set([
  'net::ERR_ADDRESS_UNREACHABLE',
  'net::ERR_CONNECTION_CLOSED',
  'net::ERR_CONNECTION_REFUSED',
  'net::ERR_CONNECTION_RESET',
  'net::ERR_CONNECTION_TIMED_OUT',
  'net::ERR_EMPTY_RESPONSE',
  'net::ERR_NAME_NOT_RESOLVED',
  'net::ERR_TIMED_OUT',
]);
const TIMEOUT_NAVIGATION_ERRORS = new Set([
  'net::ERR_CONNECTION_TIMED_OUT',
  'net::ERR_TIMED_OUT',
]);

const pendingNavigations = new Map();
const activeRedirects = new Map();

function activeRedirectKey(tabId) {
  return `${ACTIVE_REDIRECT_KEY_PREFIX}${tabId}`;
}

function isMainFrameNavigation(details) {
  return details.frameId === 0 && Number.isInteger(details.tabId) && details.tabId >= 0;
}

function isRedirectErrorPage(value) {
  return value === REDIRECT_ERROR_PAGE_URL;
}

function originalActionLabel(record) {
  return record.kind === 'archive' ? 'Go to original' : `Go to ${record.originalLabel}`;
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
  const isActiveRecoveryPage = record?.failure && isRedirectErrorPage(details.url);
  if (record && !destinationMatches(record, details.url) && !isActiveRecoveryPage) {
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
    actionLabel: originalActionLabel(record),
    actionAriaLabel: `Go to ${record.originalLabel} in this tab`,
  };
}

async function openOriginalInTab(tabId, record, destinationUrl) {
  const originalUrl = originalUrlForDestination(record, destinationUrl);
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

async function bypassRedirect(tabId, currentUrl) {
  const record = await getActiveRedirect(tabId);
  if (!record || !destinationMatches(record, currentUrl)) {
    throw new Error('This redirect is no longer active.');
  }

  await openOriginalInTab(tabId, record, currentUrl);
}

function failureDescription(record) {
  const failedUrl = new URL(record.failure.destinationUrl);
  if (TIMEOUT_NAVIGATION_ERRORS.has(record.failure.error)) {
    return `${failedUrl.hostname} took too long to respond.`;
  }
  if (record.failure.error === 'net::ERR_NAME_NOT_RESOLVED') {
    return `${failedUrl.hostname} couldn’t be found.`;
  }
  return `${failedUrl.hostname} didn’t respond.`;
}

async function getRedirectFailure(tabId, currentUrl) {
  const record = await getActiveRedirect(tabId);
  if (!record?.failure || !isRedirectErrorPage(currentUrl)) {
    return null;
  }

  return {
    title: `${record.alternateLabel} didn’t respond`,
    description: failureDescription(record),
    actionLabel: originalActionLabel(record),
    actionAriaLabel: `Go to ${record.originalLabel} in this tab`,
    retryLabel: 'Try again',
    retryAriaLabel: `Try ${record.alternateLabel} again`,
    scopeLabel: `This tab will use ${record.originalLabel} until you close it.`,
  };
}

async function bypassFailedRedirect(tabId, currentUrl) {
  const record = await getActiveRedirect(tabId);
  if (!record?.failure || !isRedirectErrorPage(currentUrl)) {
    throw new Error('This failed redirect is no longer active.');
  }

  await openOriginalInTab(tabId, record, record.failure.destinationUrl);
}

async function retryFailedRedirect(tabId, currentUrl) {
  const record = await getActiveRedirect(tabId);
  if (!record?.failure || !isRedirectErrorPage(currentUrl)) {
    throw new Error('This failed redirect is no longer active.');
  }

  const retryUrl = record.failure.destinationUrl;
  const { failure: _failure, ...pendingRecord } = record;
  await storeActiveRedirect(tabId, pendingRecord);

  try {
    await chrome.tabs.update(tabId, { url: retryUrl });
  } catch (error) {
    await storeActiveRedirect(tabId, record);
    throw error;
  }
}

async function handleNavigationError(details) {
  if (!isMainFrameNavigation(details)
    || !RECOVERABLE_NAVIGATION_ERRORS.has(details.error)) {
    return;
  }

  const record = await getActiveRedirect(details.tabId);
  if (!record || !destinationMatches(record, details.url)) {
    return;
  }

  pendingNavigations.delete(details.tabId);
  await storeActiveRedirect(details.tabId, {
    ...record,
    destinationUrl: details.url,
    failure: {
      destinationUrl: details.url,
      error: details.error,
      detectedAt: Date.now(),
    },
  });
  await chrome.tabs.update(details.tabId, { url: REDIRECT_ERROR_PAGE_URL });
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
chrome.webNavigation.onErrorOccurred.addListener((details) => {
  void handleNavigationError(details).catch((error) => {
    console.warn('NerdVPN could not show redirect recovery.', error);
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

  if (message?.type === 'getRedirectFailure') {
    getRedirectFailure(tabId, message.currentUrl)
      .then((failure) => sendResponse({ failure }))
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }

  if (message?.type === 'bypassFailedRedirect') {
    bypassFailedRedirect(tabId, message.currentUrl)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }

  if (message?.type === 'retryFailedRedirect') {
    retryFailedRedirect(tabId, message.currentUrl)
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
