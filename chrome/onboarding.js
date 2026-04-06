/**
 * Magnetar — Onboarding Script
 * 
 * Three-step wizard:
 * 1. Choose download client + enter credentials
 * 2. Configure detection preferences (batch, banner, shield)
 * 3. Ready — site grid + finish
 */

document.addEventListener('DOMContentLoaded', async () => {

  let currentStep = 1;
  let selectedMode = 'local';

  // ── Step Navigation ──────────────────────────────────────────────────

  function goToStep(step) {
    // Hide all steps
    document.querySelectorAll('.onboarding-step').forEach(el => {
      el.classList.remove('active');
    });

    // Show target step
    const target = document.getElementById(`step-${step}`);
    if (target) target.classList.add('active');

    // Update progress dots
    document.querySelectorAll('.onboarding-dot').forEach(dot => {
      const dotStep = parseInt(dot.dataset.step);
      dot.classList.remove('active', 'done');
      if (dotStep === step) dot.classList.add('active');
      else if (dotStep < step) dot.classList.add('done');
    });

    currentStep = step;
  }

  // Step 1 → 2
  document.getElementById('next-1').addEventListener('click', async () => {
    await saveMode();
    goToStep(2);
  });

  // Step 2 → 3
  document.getElementById('next-2').addEventListener('click', async () => {
    await savePreferences();
    goToStep(3);
  });

  // Back buttons
  document.getElementById('back-2').addEventListener('click', () => goToStep(1));
  document.getElementById('back-3').addEventListener('click', () => goToStep(2));

  // Finish → close onboarding
  document.getElementById('finish').addEventListener('click', async () => {
    await savePreferences();
    // Mark onboarding complete
    await chrome.storage.local.set({ 'magnetar-onboarded': true });
    // Close this tab
    window.close();
  });


  // ── Step 1: Mode Selection ───────────────────────────────────────────

  const modeCards = document.querySelectorAll('.mode-card');

  function selectMode(mode) {
    selectedMode = mode;
    modeCards.forEach(c => c.classList.toggle('active', c.dataset.mode === mode));
    // Show/hide credential panels
    document.querySelectorAll('.creds-panel').forEach(p => p.style.display = 'none');
    const panel = document.getElementById(`creds-${mode}`);
    if (panel) panel.style.display = 'block';
  }

  modeCards.forEach(card => {
    card.addEventListener('click', () => selectMode(card.dataset.mode));
  });

  // Start with local selected
  selectMode('local');


  // ── Step 1: Credential Save & Test ───────────────────────────────────

  function showResult(el, message, success) {
    el.textContent = success ? `✓ ${message}` : `✗ ${message}`;
    el.className = 'test-result ' + (success ? 'success' : 'fail');
  }

  // Real-Debrid
  document.getElementById('rd-test').addEventListener('click', async () => {
    const btn = document.getElementById('rd-test');
    const result = document.getElementById('rd-result');
    const apiKey = document.getElementById('rd-apikey').value.trim();
    if (!apiKey) { showResult(result, 'Please enter an API key', false); return; }

    btn.disabled = true;
    btn.textContent = 'Testing…';

    const s = await chrome.runtime.sendMessage({ type: 'get-settings' });
    s.credentials = s.credentials || {};
    s.credentials.realdebrid = { apiKey };
    await chrome.runtime.sendMessage({ type: 'save-settings', data: s });

    const res = await chrome.runtime.sendMessage({ type: 'validate-credentials', mode: 'realdebrid', credentials: { apiKey } });
    showResult(result, res.valid ? res.userInfo : (res.error || 'Validation failed'), res.valid);

    btn.disabled = false;
    btn.textContent = 'Save & Test';
  });

  // RDT Client
  document.getElementById('rdt-test').addEventListener('click', async () => {
    const btn = document.getElementById('rdt-test');
    const result = document.getElementById('rdt-result');
    const creds = {
      url: document.getElementById('rdt-url').value.trim(),
      username: document.getElementById('rdt-username').value.trim(),
      password: document.getElementById('rdt-password').value,
      rdApiKey: document.getElementById('rdt-rdkey').value.trim()
    };
    if (!creds.url || !creds.username) { showResult(result, 'URL and username are required', false); return; }

    btn.disabled = true;
    btn.textContent = 'Testing…';

    const s = await chrome.runtime.sendMessage({ type: 'get-settings' });
    s.credentials = s.credentials || {};
    s.credentials.rdtclient = creds;
    await chrome.runtime.sendMessage({ type: 'save-settings', data: s });

    const res = await chrome.runtime.sendMessage({ type: 'validate-credentials', mode: 'rdtclient', credentials: creds });
    showResult(result, res.valid ? res.userInfo : (res.error || 'Validation failed'), res.valid);

    btn.disabled = false;
    btn.textContent = 'Save & Test';
  });

  // TorBox
  document.getElementById('tb-test').addEventListener('click', async () => {
    const btn = document.getElementById('tb-test');
    const result = document.getElementById('tb-result');
    const apiKey = document.getElementById('tb-apikey').value.trim();
    if (!apiKey) { showResult(result, 'Please enter an API key', false); return; }

    btn.disabled = true;
    btn.textContent = 'Testing…';

    const s = await chrome.runtime.sendMessage({ type: 'get-settings' });
    s.credentials = s.credentials || {};
    s.credentials.torbox = { apiKey };
    await chrome.runtime.sendMessage({ type: 'save-settings', data: s });

    const res = await chrome.runtime.sendMessage({ type: 'validate-credentials', mode: 'torbox', credentials: { apiKey } });
    showResult(result, res.valid ? res.userInfo : (res.error || 'Validation failed'), res.valid);

    btn.disabled = false;
    btn.textContent = 'Save & Test';
  });

  // Premiumize
  document.getElementById('pm-test').addEventListener('click', async () => {
    const btn = document.getElementById('pm-test');
    const result = document.getElementById('pm-result');
    const apiKey = document.getElementById('pm-apikey').value.trim();
    if (!apiKey) { showResult(result, 'Please enter an API key', false); return; }

    btn.disabled = true;
    btn.textContent = 'Testing…';

    const s = await chrome.runtime.sendMessage({ type: 'get-settings' });
    s.credentials = s.credentials || {};
    s.credentials.premiumize = { apiKey };
    await chrome.runtime.sendMessage({ type: 'save-settings', data: s });

    const res = await chrome.runtime.sendMessage({ type: 'validate-credentials', mode: 'premiumize', credentials: { apiKey } });
    showResult(result, res.valid ? res.userInfo : (res.error || 'Validation failed'), res.valid);

    btn.disabled = false;
    btn.textContent = 'Save & Test';
  });

  // AllDebrid
  document.getElementById('ad-test').addEventListener('click', async () => {
    const btn = document.getElementById('ad-test');
    const result = document.getElementById('ad-result');
    const apiKey = document.getElementById('ad-apikey').value.trim();
    if (!apiKey) { showResult(result, 'Please enter an API key', false); return; }

    btn.disabled = true;
    btn.textContent = 'Testing…';

    const s = await chrome.runtime.sendMessage({ type: 'get-settings' });
    s.credentials = s.credentials || {};
    s.credentials.alldebrid = { apiKey };
    await chrome.runtime.sendMessage({ type: 'save-settings', data: s });

    const res = await chrome.runtime.sendMessage({ type: 'validate-credentials', mode: 'alldebrid', credentials: { apiKey } });
    showResult(result, res.valid ? res.userInfo : (res.error || 'Validation failed'), res.valid);

    btn.disabled = false;
    btn.textContent = 'Save & Test';
  });


  // ── Save Functions ───────────────────────────────────────────────────

  async function saveMode() {
    const s = await chrome.runtime.sendMessage({ type: 'get-settings' });
    s.mode = selectedMode;
    await chrome.runtime.sendMessage({ type: 'save-settings', data: s });
  }

  async function savePreferences() {
    const s = await chrome.runtime.sendMessage({ type: 'get-settings' });
    s.preferences = s.preferences || {};
    s.preferences.batchMode = document.getElementById('ob-batch-mode').checked;
    s.preferences.bannerStyle = document.getElementById('ob-banner-style').value;
    s.preferences.bannerPosition = document.getElementById('ob-banner-position').value;
    await chrome.runtime.sendMessage({ type: 'save-settings', data: s });

    // Shield toggle
    const shieldEnabled = document.getElementById('ob-shield').checked;
    await chrome.runtime.sendMessage({ type: 'shield-toggle', enabled: shieldEnabled });
  }

});
