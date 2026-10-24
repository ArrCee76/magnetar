document.addEventListener('DOMContentLoaded', () => {
  const banner = document.getElementById('magnetar-banner');
  const expand = document.getElementById('preview-expand');
  const expanded = document.getElementById('preview-expanded');
  const hint = document.getElementById('preview-hint');
  const finish = document.getElementById('complete-finish');
  const fallback = document.getElementById('close-fallback');

  expand?.addEventListener('click', () => {
    const isExpanded = expand.getAttribute('aria-expanded') !== 'true';
    expand.setAttribute('aria-expanded', String(isExpanded));
    expand.setAttribute('aria-label', isExpanded ? 'Collapse toolbar preview' : 'Expand toolbar preview');
    expand.title = isExpanded ? 'Collapse' : 'Expand';
    banner?.classList.toggle('magnetar-expanded', isExpanded);
    expanded.hidden = !isExpanded;
  });

  document.querySelectorAll('.preview-action').forEach(button => {
    button.addEventListener('click', () => {
      hint.textContent = `Preview only — ${button.dataset.purpose}`;
      hint.hidden = false;
    });
  });

  finish?.addEventListener('click', () => {
    finish.disabled = true;
    window.close();
    window.setTimeout(() => {
      if (document.visibilityState === 'visible') {
        fallback.hidden = false;
        finish.disabled = false;
      }
    }, 400);
  });
});
