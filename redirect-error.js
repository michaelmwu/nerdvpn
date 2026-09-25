(() => {
  const recovery = document.getElementById('recovery');
  const title = document.getElementById('failure-title');
  const description = document.getElementById('failure-description');
  const actions = document.getElementById('failure-actions');
  const openOriginal = document.getElementById('open-original');
  const retryAlternate = document.getElementById('retry-alternate');
  const scopeLabel = document.getElementById('scope-label');
  const errorMessage = document.getElementById('error-message');

  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        if (response?.error) {
          reject(new Error(response.error));
          return;
        }
        resolve(response);
      });
    });
  }

  function renderUnavailable(message = 'This redirect is no longer active.') {
    document.title = 'Redirect unavailable · NerdVPN';
    title.textContent = 'Nothing to recover';
    description.textContent = message;
    actions.hidden = true;
    scopeLabel.hidden = true;
    recovery.setAttribute('aria-busy', 'false');
    title.focus({ preventScroll: true });
  }

  function renderFailure(failure) {
    document.title = `${failure.title} · NerdVPN`;
    title.textContent = failure.title;
    description.textContent = failure.description;
    openOriginal.textContent = failure.actionLabel;
    openOriginal.setAttribute('aria-label', failure.actionAriaLabel);
    retryAlternate.textContent = failure.retryLabel;
    retryAlternate.setAttribute('aria-label', failure.retryAriaLabel);
    scopeLabel.textContent = failure.scopeLabel;
    recovery.setAttribute('aria-busy', 'false');
    title.focus({ preventScroll: true });
  }

  function setPending(activeButton, label) {
    errorMessage.hidden = true;
    openOriginal.disabled = true;
    retryAlternate.disabled = true;
    activeButton.textContent = label;
  }

  function restoreActions(failure, message) {
    openOriginal.disabled = false;
    retryAlternate.disabled = false;
    openOriginal.textContent = failure.actionLabel;
    retryAlternate.textContent = failure.retryLabel;
    errorMessage.textContent = message;
    errorMessage.hidden = false;
  }

  async function runAction(failure, type, activeButton, pendingLabel) {
    setPending(activeButton, pendingLabel);
    try {
      await sendMessage({ type, currentUrl: window.location.href });
    } catch (error) {
      console.warn('NerdVPN redirect recovery failed.', error);
      restoreActions(failure, 'That didn’t work. Check your connection and try again.');
      activeButton.focus();
    }
  }

  sendMessage({ type: 'getRedirectFailure', currentUrl: window.location.href })
    .then((response) => {
      const failure = response?.failure;
      if (!failure) {
        renderUnavailable();
        return;
      }

      renderFailure(failure);
      openOriginal.addEventListener('click', () => {
        void runAction(failure, 'bypassFailedRedirect', openOriginal, 'Opening…');
      });
      retryAlternate.addEventListener('click', () => {
        void runAction(failure, 'retryFailedRedirect', retryAlternate, 'Retrying…');
      });
    })
    .catch(() => {
      renderUnavailable('NerdVPN couldn’t load the recovery options.');
    });
})();
