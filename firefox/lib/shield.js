/**
 * Magnetar Shield — Popup/Redirect Blocker
 * 
 * Firefox MV2: Uses webNavigation-based tab closing
 * (blocking handled in background.js onBeforeNavigate listener)
 * Storage-only — rules are checked at navigation time.
 */

const MagnetarShield = {

  DEFAULT_BLOCKLIST: [
    'ultimatesurferprotector.com',
    'notifpushnext.com',
    'jpadsnow.com',
    'pushnext.com',
    'donatelloflowfirstly.com'
  ],

  /**
   * Initialise Shield — load blocklist from storage
   */
  async init() {
    const data = await chrome.storage.local.get(['shield']);
    const shield = data.shield || { enabled: true, blockedDomains: [...this.DEFAULT_BLOCKLIST] };

    // Save defaults if first run
    if (!data.shield) {
      await chrome.storage.local.set({ shield });
    }

    return shield;
  },

  /**
   * Apply rules — no-op on Firefox (blocking handled via webNavigation in background.js)
   */
  async applyRules(domains) {
    // Firefox uses webNavigation.onBeforeNavigate in background.js
    // which checks isBlocked() at navigation time
  },

  /**
   * Clear rules — no-op on Firefox
   */
  async clearRules() {
    // No declarativeNetRequest rules to clear on Firefox
  },

  /**
   * Add a domain to the blocklist
   */
  async blockDomain(domain) {
    domain = domain.toLowerCase().replace(/^(?:https?:\/\/)?(?:www\.)?/, '').replace(/\/.*$/, '');
    const data = await chrome.storage.local.get(['shield']);
    const shield = data.shield || { enabled: true, blockedDomains: [] };

    if (shield.blockedDomains.includes(domain)) return shield;

    shield.blockedDomains.push(domain);
    await chrome.storage.local.set({ shield });

    return shield;
  },

  /**
   * Remove a domain from the blocklist
   */
  async unblockDomain(domain) {
    domain = domain.toLowerCase().replace(/^(?:https?:\/\/)?(?:www\.)?/, '').replace(/\/.*$/, '');
    const data = await chrome.storage.local.get(['shield']);
    const shield = data.shield || { enabled: true, blockedDomains: [] };

    shield.blockedDomains = shield.blockedDomains.filter(d => d !== domain);
    await chrome.storage.local.set({ shield });

    return shield;
  },

  /**
   * Toggle Shield on/off
   */
  async toggle(enabled) {
    const data = await chrome.storage.local.get(['shield']);
    const shield = data.shield || { enabled: true, blockedDomains: [...this.DEFAULT_BLOCKLIST] };
    shield.enabled = enabled;
    await chrome.storage.local.set({ shield });

    return shield;
  },

  /**
   * Check if a domain is blocked
   */
  async isBlocked(domain) {
    domain = domain.toLowerCase().replace(/^(?:https?:\/\/)?(?:www\.)?/, '').replace(/\/.*$/, '');
    const data = await chrome.storage.local.get(['shield']);
    const shield = data.shield || { enabled: true, blockedDomains: [] };
    if (!shield.enabled) return false;
    return shield.blockedDomains.some(d => domain === d || domain.endsWith('.' + d));
  }
};
