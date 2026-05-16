/**
 * Magnetar — Onboarding Script
 * 
 * Three-step wizard:
 * 1. Choose download client + enter credentials
 * 2. Configure detection preferences (batch, banner, shield)
 * 3. Ready — site grid + finish
 */

document.addEventListener('DOMContentLoaded', async () => {

  // ── Theme: apply saved preference before anything renders ──
  try {
    const themeRes = await MAGNETAR_API.runtime.sendMessage({ type: 'get-theme' });
    if (themeRes?.theme === 'dark') {
      document.documentElement.classList.add('mg-dark');
    }
  } catch (e) {}


  // ── i18n hydration ──
  const t = (key, ...subs) => MAGNETAR_API.i18n.getMessage(key, subs) || key;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const msg = t(el.dataset.i18n);
    if (msg !== el.dataset.i18n) el.textContent = msg;
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const msg = t(el.dataset.i18nPlaceholder);
    if (msg !== el.dataset.i18nPlaceholder) el.placeholder = msg;
  });
  document.querySelectorAll('option[data-i18n]').forEach(el => {
    const msg = t(el.dataset.i18n);
    if (msg !== el.dataset.i18n) el.textContent = msg;
  });

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
    await MAGNETAR_API.storage.local.set({ 'magnetar-onboarded': true });
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

  try {
    const settings = (await MAGNETAR_API.runtime.sendMessage({ type: 'get-settings' })) || {};
    document.getElementById('ob-interface-mode').value =
      settings?.preferences?.interfaceMode === 'standard' ? 'standard' : 'advanced';
  } catch (e) {}


  // ── Step 1: Credential Save & Test ───────────────────────────────────

  function showResult(el, message, success) {
    el.textContent = success ? `✓ ${message}` : `✗ ${message}`;
    el.className = 'test-result ' + (success ? 'success' : 'fail');
  }

  function timeout(ms, message) {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    });
  }

  async function sendRuntimeMessage(message, ms = 20000) {
    return await Promise.race([
      MAGNETAR_API.runtime.sendMessage(message),
      timeout(ms, 'No response from extension background. Reload the extension and try again.')
    ]);
  }

  async function getSettingsForUpdate() {
    const s = await sendRuntimeMessage({ type: 'get-settings' }, 8000);
    return (s && typeof s === 'object') ? s : {};
  }

  async function saveCredentialsAndValidate(mode, credentials) {
    const s = await getSettingsForUpdate();
    s.credentials = s.credentials || {};
    s.credentials[mode] = credentials;
    s.providerStatus = s.providerStatus || {};
    s.providerStatus[mode] = { valid: false, testedAt: Date.now() };
    await sendRuntimeMessage({ type: 'save-settings', data: s }, 8000);

    const res = await sendRuntimeMessage({
      type: 'validate-credentials',
      mode,
      credentials
    }, 20000);

    s.providerStatus[mode] = {
      valid: res?.valid === true,
      testedAt: Date.now()
    };
    await sendRuntimeMessage({ type: 'save-settings', data: s }, 8000);

    return res || { valid: false, error: 'No response from extension background.' };
  }

  async function runCredentialTest(btnId, resultId, mode, credentials) {
    const btn = document.getElementById(btnId);
    const result = document.getElementById(resultId);

    btn.disabled = true;
    btn.textContent = 'Testing…';

    try {
      const res = await saveCredentialsAndValidate(mode, credentials);
      showResult(result, res.valid ? res.userInfo : (res.error || 'Validation failed'), res.valid);
    } catch (e) {
      showResult(result, 'Test failed: ' + (e?.message || 'unknown error'), false);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save & Test';
    }
  }

  // Real-Debrid
  document.getElementById('rd-test').addEventListener('click', async () => {
    const result = document.getElementById('rd-result');
    const apiKey = document.getElementById('rd-apikey').value.trim();
    if (!apiKey) { showResult(result, 'Please enter an API key', false); return; }
    await runCredentialTest('rd-test', 'rd-result', 'realdebrid', { apiKey });
  });

  // RDT Client
  document.getElementById('rdt-test').addEventListener('click', async () => {
    const result = document.getElementById('rdt-result');
    const creds = {
      url: document.getElementById('rdt-url').value.trim(),
      username: document.getElementById('rdt-username').value.trim(),
      password: document.getElementById('rdt-password').value,
      rdApiKey: document.getElementById('rdt-rdkey').value.trim()
    };
    if (!creds.url || !creds.username) { showResult(result, 'URL and username are required', false); return; }
    await runCredentialTest('rdt-test', 'rdt-result', 'rdtclient', creds);
  });

  // TorBox
  document.getElementById('tb-test').addEventListener('click', async () => {
    const result = document.getElementById('tb-result');
    const apiKey = document.getElementById('tb-apikey').value.trim();
    if (!apiKey) { showResult(result, 'Please enter an API key', false); return; }
    await runCredentialTest('tb-test', 'tb-result', 'torbox', { apiKey });
  });

  // Premiumize
  document.getElementById('pm-test').addEventListener('click', async () => {
    const result = document.getElementById('pm-result');
    const apiKey = document.getElementById('pm-apikey').value.trim();
    if (!apiKey) { showResult(result, 'Please enter an API key', false); return; }
    await runCredentialTest('pm-test', 'pm-result', 'premiumize', { apiKey });
  });

  // AllDebrid
  document.getElementById('ad-test').addEventListener('click', async () => {
    const result = document.getElementById('ad-result');
    const apiKey = document.getElementById('ad-apikey').value.trim();
    if (!apiKey) { showResult(result, 'Please enter an API key', false); return; }
    await runCredentialTest('ad-test', 'ad-result', 'alldebrid', { apiKey });
  });


  // ── Save Functions ───────────────────────────────────────────────────

  async function saveMode() {
    const s = (await MAGNETAR_API.runtime.sendMessage({ type: 'get-settings' })) || {};
    s.mode = selectedMode;
    await MAGNETAR_API.runtime.sendMessage({ type: 'save-settings', data: s });
  }

  async function savePreferences() {
    const s = (await MAGNETAR_API.runtime.sendMessage({ type: 'get-settings' })) || {};
    s.preferences = s.preferences || {};
    const interfaceMode = document.getElementById('ob-interface-mode').value;
    s.preferences.interfaceMode = interfaceMode === 'advanced' ? 'advanced' : 'standard';
    s.preferences.batchMode = document.getElementById('ob-batch-mode').checked;
    s.preferences.bannerStyle = document.getElementById('ob-banner-style').value;
    s.preferences.bannerPosition = document.getElementById('ob-banner-position').value;
    await MAGNETAR_API.runtime.sendMessage({ type: 'save-settings', data: s });

    // Shield toggle
    const shieldEnabled = document.getElementById('ob-shield').checked;
    await MAGNETAR_API.runtime.sendMessage({ type: 'shield-toggle', enabled: shieldEnabled });
  }

});
