/**
 * Magnetar Shield — Firefox version
 * Uses browser.storage instead of chrome.storage
 */

const MagnetarShield = {
  DEFAULT_BLOCKLIST: [
    'ultimatesurferprotector.com',
    'notifpushnext.com',
    'jpadsnow.com',
    'pushnext.com',
    'donatelloflowfirstly.com'
  ],

  async init() {
    const data = await browser.storage.local.get(['shield']);
    const shield = data.shield || { enabled: true, blockedDomains: [...this.DEFAULT_BLOCKLIST] };
    if (!data.shield) {
      await browser.storage.local.set({ shield });
    }
    return shield;
  },

  async applyRules(domains) { /* Overridden by FirefoxShield in background.js */ },
  async clearRules() { /* Overridden by FirefoxShield in background.js */ },

  async blockDomain(domain) {
    domain = domain.toLowerCase().replace(/^(?:https?:\/\/)?(?:www\.)?/, '').replace(/\/.*$/, '');
    const data = await browser.storage.local.get(['shield']);
    const shield = data.shield || { enabled: true, blockedDomains: [] };
    if (shield.blockedDomains.includes(domain)) return shield;
    shield.blockedDomains.push(domain);
    await browser.storage.local.set({ shield });
    return shield;
  },

  async unblockDomain(domain) {
    domain = domain.toLowerCase().replace(/^(?:https?:\/\/)?(?:www\.)?/, '').replace(/\/.*$/, '');
    const data = await browser.storage.local.get(['shield']);
    const shield = data.shield || { enabled: true, blockedDomains: [] };
    shield.blockedDomains = shield.blockedDomains.filter(d => d !== domain);
    await browser.storage.local.set({ shield });
    return shield;
  },

  async toggle(enabled) {
    const data = await browser.storage.local.get(['shield']);
    const shield = data.shield || { enabled: true, blockedDomains: [...this.DEFAULT_BLOCKLIST] };
    shield.enabled = enabled;
    await browser.storage.local.set({ shield });
    return shield;
  },

  async isBlocked(domain) {
    domain = domain.toLowerCase().replace(/^(?:https?:\/\/)?(?:www\.)?/, '').replace(/\/.*$/, '');
    const data = await browser.storage.local.get(['shield']);
    const shield = data.shield || { enabled: true, blockedDomains: [] };
    return shield.blockedDomains.some(d => domain === d || domain.endsWith('.' + d));
  }
};
