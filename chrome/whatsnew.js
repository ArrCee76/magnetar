/**
 * Magnetar — What's New Script
 */

document.addEventListener('DOMContentLoaded', async () => {

  // ── Theme: apply saved preference before anything renders ──
  try {
    const themeRes = await chrome.runtime.sendMessage({ type: 'get-theme' });
    if (themeRes?.theme === 'dark') {
      document.documentElement.classList.add('mg-dark');
    }
  } catch (e) {}

  // Live-sync if the user toggles theme from another surface while this tab is open.
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area !== 'sync' || !changes.magnetar) return;
    const newTheme = changes.magnetar.newValue?.preferences?.theme;
    if (!newTheme) return;
    document.documentElement.classList.toggle('mg-dark', newTheme === 'dark');
  });

  // Show version
  const manifest = chrome.runtime.getManifest();
  document.getElementById('whatsnew-version').textContent = `v${manifest.version}`;

  // ── Pagination ──
  const pages = Array.from(document.querySelectorAll('.whatsnew-page'));
  const dots = Array.from(document.querySelectorAll('.whatsnew-dot'));
  const btnPrev = document.getElementById('whatsnew-prev');
  const btnNext = document.getElementById('whatsnew-next');
  const btnSkip = document.getElementById('whatsnew-skip');

  let current = 1;
  const total = pages.length;

  function showPage(n) {
    current = Math.max(1, Math.min(total, n));
    pages.forEach(p => {
      p.style.display = Number(p.dataset.page) === current ? '' : 'none';
    });
    dots.forEach(d => {
      d.classList.toggle('whatsnew-dot-active', Number(d.dataset.dot) === current);
    });
    btnPrev.style.display = current > 1 ? '' : 'none';
    btnSkip.style.display = current < total ? '' : 'none';
    btnNext.textContent = current === total ? 'Got it' : 'Next';
  }

  async function dismiss() {
    await chrome.runtime.sendMessage({ type: 'dismiss-whatsnew' }).catch(() => {});
    window.close();
  }

  btnPrev.addEventListener('click', () => showPage(current - 1));
  btnNext.addEventListener('click', () => {
    if (current === total) {
      dismiss();
    } else {
      showPage(current + 1);
    }
  });
  btnSkip.addEventListener('click', dismiss);

  dots.forEach(d => {
    d.addEventListener('click', () => showPage(Number(d.dataset.dot)));
  });

  // Keyboard navigation
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') btnNext.click();
    if (e.key === 'ArrowLeft' && current > 1) showPage(current - 1);
    if (e.key === 'Escape') dismiss();
  });

  showPage(1);

  // Mark as seen on first view
  chrome.runtime.sendMessage({ type: 'dismiss-whatsnew' }).catch(() => {});
});
