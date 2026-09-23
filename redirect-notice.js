(() => {
  const NOTICE_HOST_ID = 'nerdvpn-redirect-notice';

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
        position: fixed;
        left: 50%;
        bottom: 18px;
        z-index: 2147483647;
        transform: translateX(-50%);
        max-width: calc(100vw - 24px);
        color-scheme: light dark;
      }

      .notice {
        box-sizing: border-box;
        display: flex;
        align-items: center;
        gap: 10px;
        width: max-content;
        max-width: 100%;
        padding: 8px 9px 8px 14px;
        border: 1px solid rgb(255 255 255 / 18%);
        border-radius: 999px;
        background: #202124;
        box-shadow: 0 6px 24px rgb(0 0 0 / 28%);
        color: #f8f9fa;
        font: 500 13px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
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
        padding: 6px 11px;
        border-radius: 999px;
        background: #f8f9fa;
        color: #202124;
        font-weight: 700;
      }

      .action:hover {
        background: #e8eaed;
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
        width: 28px;
        height: 28px;
        padding: 0;
        border-radius: 50%;
        background: transparent;
        color: #bdc1c6;
        font-size: 18px;
        line-height: 1;
      }

      .close:hover {
        background: rgb(255 255 255 / 10%);
        color: #f8f9fa;
      }

      @media (max-width: 520px) {
        :host {
          right: 12px;
          bottom: 12px;
          left: 12px;
          transform: none;
          max-width: none;
        }

        .notice {
          width: 100%;
        }

        .summary {
          flex: 1;
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

    const action = document.createElement('button');
    action.className = 'action';
    action.type = 'button';
    action.textContent = notice.actionLabel;
    action.addEventListener('click', async () => {
      action.disabled = true;
      const originalText = action.textContent;
      action.textContent = 'Opening…';

      try {
        await sendMessage({ type: 'bypassRedirect', currentUrl: window.location.href });
      } catch (error) {
        console.warn('NerdVPN could not open the original site.', error);
        action.disabled = false;
        action.textContent = 'Try again';
        action.setAttribute('aria-label', `${originalText}. Previous attempt failed; try again.`);
      }
    });

    const close = document.createElement('button');
    close.className = 'close';
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Dismiss NerdVPN redirect notice');
    close.addEventListener('click', () => {
      host.remove();
      void sendMessage({ type: 'dismissRedirectNotice' }).catch(() => {});
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
