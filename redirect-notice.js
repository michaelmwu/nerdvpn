(() => {
  const NOTICE_HOST_ID = 'nerdvpn-redirect-notice';
  const TOAST_LIFETIME_SECONDS = 60;

  if (document.getElementById(NOTICE_HOST_ID)) {
    return;
  }

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

  function renderNotice(notice) {
    const host = document.createElement('div');
    host.id = NOTICE_HOST_ID;

    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      :host {
        all: initial;
        --nerdvpn-surface: #202124;
        --nerdvpn-text: #f5f6f7;
        --nerdvpn-muted: #bdc1c6;
        --nerdvpn-button: rgb(255 255 255 / 10%);
        --nerdvpn-button-hover: rgb(255 255 255 / 16%);
        position: fixed;
        left: 50%;
        bottom: max(18px, env(safe-area-inset-bottom));
        z-index: 2147483647;
        transform: translateX(-50%);
        max-width: calc(100vw - 24px);
        color-scheme: dark;
        direction: ltr;
        unicode-bidi: isolate;
        animation: nerdvpn-lifetime ${TOAST_LIFETIME_SECONDS}s linear forwards;
      }

      :host(:hover),
      :host(:focus-within) {
        animation-play-state: paused;
      }

      .notice {
        box-sizing: border-box;
        display: flex;
        align-items: center;
        gap: 10px;
        width: max-content;
        max-width: 100%;
        min-height: 48px;
        padding: 2px 4px 2px 14px;
        border: 1px solid rgb(255 255 255 / 14%);
        border-radius: 999px;
        background: var(--nerdvpn-surface);
        box-shadow: 0 8px 24px rgb(0 0 0 / 28%);
        color: var(--nerdvpn-text);
        font: 500 13px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        animation: nerdvpn-enter 180ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
      }

      .summary {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      button {
        box-sizing: border-box;
        border: 0;
        font: inherit;
        cursor: pointer;
      }

      .action {
        flex: none;
        min-height: 40px;
        padding: 6px 12px;
        border-radius: 999px;
        background: var(--nerdvpn-button);
        color: var(--nerdvpn-text);
        font-weight: 700;
        transition: background-color 120ms ease-out, transform 80ms ease-out;
      }

      .action:hover {
        background: var(--nerdvpn-button-hover);
      }

      .action:active {
        transform: translateY(1px);
      }

      .action:focus-visible,
      .close:focus-visible {
        outline: 2px solid #8ab4f8;
        outline-offset: 2px;
      }

      .action:disabled {
        cursor: wait;
        opacity: 0.7;
      }

      .close {
        flex: none;
        display: grid;
        place-items: center;
        width: 40px;
        height: 40px;
        padding: 0;
        border-radius: 50%;
        background: transparent;
        color: var(--nerdvpn-muted);
        font-size: 18px;
        line-height: 1;
        transition: background-color 120ms ease-out, color 120ms ease-out;
      }

      .close:hover {
        background: rgb(255 255 255 / 10%);
        color: #f8f9fa;
      }

      @keyframes nerdvpn-enter {
        from {
          opacity: 0;
          transform: translateY(6px) scale(0.98);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }

      @keyframes nerdvpn-lifetime {
        0%, 99.67% { opacity: 1; }
        100% { opacity: 0; }
      }

      @keyframes nerdvpn-lifetime-reduced {
        from, to { opacity: 1; }
      }

      @media (max-width: 520px) {
        :host {
          bottom: max(12px, env(safe-area-inset-bottom));
        }

        .summary {
          flex: 1;
          min-width: 0;
        }

        .action,
        .close {
          min-height: 44px;
        }

        .close {
          width: 44px;
          height: 44px;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        :host {
          animation-name: nerdvpn-lifetime-reduced;
        }

        .notice {
          animation: none;
        }

        .action,
        .close {
          transition: none;
        }
      }
    `;

    const region = document.createElement('div');
    region.className = 'notice';
    region.setAttribute('role', 'region');
    region.setAttribute('aria-label', 'NerdVPN redirect notice');

    const summary = document.createElement('span');
    summary.className = 'summary';
    summary.setAttribute('role', 'status');
    summary.setAttribute('aria-live', 'polite');
    summary.textContent = `${notice.originalLabel} → ${notice.alternateLabel} by NerdVPN`;
    summary.setAttribute(
      'aria-label',
      `${notice.originalLabel} was redirected to ${notice.alternateLabel} by NerdVPN. `
        + `Use original to open ${notice.originalLabel} in this tab.`,
    );

    const action = document.createElement('button');
    action.className = 'action';
    action.type = 'button';
    action.textContent = notice.actionLabel;
    action.setAttribute('aria-label', notice.actionAriaLabel);
    action.addEventListener('click', async () => {
      action.disabled = true;
      action.textContent = 'Opening…';
      action.setAttribute('aria-label', `Opening ${notice.originalLabel}`);

      try {
        await sendMessage({ type: 'bypassRedirect', currentUrl: window.location.href });
      } catch (error) {
        console.warn('NerdVPN could not open the original site.', error);
        action.disabled = false;
        action.textContent = 'Try again';
        action.setAttribute(
          'aria-label',
          `${notice.actionAriaLabel}. Previous attempt failed; try again.`,
        );
      }
    });

    const close = document.createElement('button');
    close.className = 'close';
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Dismiss NerdVPN redirect notice');

    let dismissed = false;
    function dismissNotice() {
      if (dismissed) return;
      dismissed = true;
      host.remove();
      void sendMessage({ type: 'dismissRedirectNotice' }).catch(() => {});
    }

    close.addEventListener('click', dismissNotice);
    host.addEventListener('animationend', (event) => {
      if (event.target === host && event.animationName.startsWith('nerdvpn-lifetime')) {
        dismissNotice();
      }
    });

    region.append(summary, action, close);
    shadow.append(style, region);
    document.documentElement.appendChild(host);
  }

  sendMessage({ type: 'getRedirectNotice', currentUrl: window.location.href })
    .then((response) => {
      if (response?.notice) {
        renderNotice(response.notice);
      }
    })
    .catch(() => {});
})();
