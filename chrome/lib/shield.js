/**
 * Magnetar Shield — Popup/Redirect Blocker
 *
 * Chrome (MV3): uses declarativeNetRequest dynamic rules for network-level blocking.
 * Firefox (MV2): no DNR available; the background's webNavigation.onBeforeNavigate
 * listener closes tabs heading to blocked domains instead. The applyRules/
 * clearRules methods become no-ops there, but blockDomain/unblockDomain still
 * write the storage list, which is what the navigation listener consults.
 */

// True when the host browser exposes the Chromium MV3 DNR API.
const SHIELD_HAS_DNR = typeof MAGNETAR_API !== 'undefined'
  && MAGNETAR_API.declarativeNetRequest
  && typeof MAGNETAR_API.declarativeNetRequest.updateDynamicRules === 'function';

const MagnetarShield = {

  DEFAULT_BLOCKLIST: [
    'ultimatesurferprotector.com',
    'notifpushnext.com',
    'jpadsnow.com',
    'pushnext.com',
    'donatelloflowfirstly.com'
  ],

  RULE_ID_OFFSET: 10000, // Shield rules start at 10000 to avoid conflicts

  normaliseDomain(domain) {
    domain = String(domain || '').trim().toLowerCase();
    if (!domain || /[\s/?#:*\\]/.test(domain)) return null;
    domain = domain.replace(/^www\./, '');
    if (domain.length > 253 || !domain.includes('.')) return null;
    const labels = domain.split('.');
    const valid = labels.every(label =>
      label.length > 0 &&
      label.length <= 63 &&
      /^[a-z0-9-]+$/.test(label) &&
      !label.startsWith('-') &&
      !label.endsWith('-')
    );
    return valid ? domain : null;
  },

  /**
   * Initialise Shield — load blocklist from storage, apply rules
   */
  async init() {
    const data = await MAGNETAR_API.storage.local.get(['shield']);
    const shield = data.shield || { enabled: true, blockedDomains: [...this.DEFAULT_BLOCKLIST] };

    // Save defaults if first run
    if (!data.shield) {
      await MAGNETAR_API.storage.local.set({ shield });
    }

    if (shield.enabled) {
      await this.applyRules(shield.blockedDomains);
    }

    return shield;
  },

  /**
   * Apply declarativeNetRequest rules for all blocked domains
   */
  async applyRules(domains) {
    // Firefox MV2 path: no DNR. Storage write is enough; webNavigation handles it.
    if (!SHIELD_HAS_DNR) return;

    const validDomains = [...new Set((domains || [])
      .map(domain => this.normaliseDomain(domain))
      .filter(Boolean))];

    // Build the new rules
    const rules = validDomains.map((domain, i) => ({
      id: this.RULE_ID_OFFSET + i,
      priority: 1,
      action: { type: 'block' },
      condition: {
        urlFilter: `||${domain}`,
        resourceTypes: [
          'main_frame', 'sub_frame', 'script', 'image', 'xmlhttprequest',
          'stylesheet', 'font', 'media', 'object', 'ping', 'other'
        ]
      }
    }));

    // Collect all IDs to remove: both existing shield rules AND the IDs we're about to add
    const existingRules = await MAGNETAR_API.declarativeNetRequest.getDynamicRules();
    const existingShieldIds = existingRules
      .filter(r => r.id >= this.RULE_ID_OFFSET)
      .map(r => r.id);
    const newIds = rules.map(r => r.id);
    const removeIds = [...new Set([...existingShieldIds, ...newIds])];

    await MAGNETAR_API.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: removeIds,
      addRules: rules
    });
  },

  /**
   * Clear all Shield rules
   */
  async clearRules() {
    if (!SHIELD_HAS_DNR) return;
    const existingRules = await MAGNETAR_API.declarativeNetRequest.getDynamicRules();
    const shieldRuleIds = existingRules
      .filter(r => r.id >= this.RULE_ID_OFFSET)
      .map(r => r.id);

    await MAGNETAR_API.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: shieldRuleIds,
      addRules: []
    });
  },

  /**
   * Add a domain to the blocklist
   */
  async blockDomain(domain) {
    const data = await MAGNETAR_API.storage.local.get(['shield']);
    const shield = data.shield || { enabled: true, blockedDomains: [] };
    domain = this.normaliseDomain(domain);
    if (!domain) return shield;

    if (shield.blockedDomains.includes(domain)) return shield;

    shield.blockedDomains.push(domain);
    await MAGNETAR_API.storage.local.set({ shield });

    if (shield.enabled) {
      await this.applyRules(shield.blockedDomains);
    }

    return shield;
  },

  /**
   * Remove a domain from the blocklist
   */
  async unblockDomain(domain) {
    const data = await MAGNETAR_API.storage.local.get(['shield']);
    const shield = data.shield || { enabled: true, blockedDomains: [] };
    domain = this.normaliseDomain(domain);
    if (!domain) return shield;

    shield.blockedDomains = shield.blockedDomains.filter(d => d !== domain);
    await MAGNETAR_API.storage.local.set({ shield });

    if (shield.enabled) {
      await this.applyRules(shield.blockedDomains);
    }

    return shield;
  },

  /**
   * Toggle Shield on/off
   */
  async toggle(enabled) {
    const data = await MAGNETAR_API.storage.local.get(['shield']);
    const shield = data.shield || { enabled: true, blockedDomains: [...this.DEFAULT_BLOCKLIST] };
    shield.enabled = enabled;
    await MAGNETAR_API.storage.local.set({ shield });

    if (enabled) {
      await this.applyRules(shield.blockedDomains);
    } else {
      await this.clearRules();
    }

    return shield;
  },

  /**
   * Check if a domain is blocked
   */
  async isBlocked(domain) {
    domain = this.normaliseDomain(domain);
    if (!domain) return false;
    const data = await MAGNETAR_API.storage.local.get(['shield']);
    const shield = data.shield || { enabled: true, blockedDomains: [] };
    return shield.blockedDomains.some(d => domain === d || domain.endsWith('.' + d));
  }
};
