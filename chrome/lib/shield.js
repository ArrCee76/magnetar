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
  RECOMMENDED_LIST_URL: 'https://arrcee.com/magnetar/shield-popup-list.json',
  RECOMMENDED_LIST_TYPE: 'top-level-popup-domains',
  MAX_RECOMMENDED_DOMAINS: 5000,

  DEFAULT_BLOCKLIST: [
    'ultimatesurferprotector.com',
    'notifpushnext.com',
    'jpadsnow.com',
    'pushnext.com',
    'donatelloflowfirstly.com',
    'goosebomb.com',
    'nutriwellnesscentral.com',
    'atzonebd.com'
  ],

  PROTECTED_DOMAINS: [
    'arrcee.com',
    'real-debrid.com',
    'torbox.app',
    'premiumize.me',
    'alldebrid.com'
  ],

  extraProtectedDomains: [],

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

  isProtectedDomain(domain) {
    domain = this.normaliseDomain(domain);
    if (!domain) return false;
    return this.PROTECTED_DOMAINS.some(protectedDomain =>
      domain === protectedDomain || domain.endsWith('.' + protectedDomain)
    ) || this.extraProtectedDomains.some(protectedDomain => domain === protectedDomain);
  },

  setExtraProtectedDomains(domains = []) {
    this.extraProtectedDomains = [...new Set((domains || [])
      .map(domain => this.normaliseDomain(domain))
      .filter(Boolean))];
  },

  getDefaultShield() {
    return {
      enabled: true,
      blockedDomains: [...this.DEFAULT_BLOCKLIST],
      recommendedList: { installed: false, domains: [] }
    };
  },

  getRecommendedDomains(shield = {}) {
    const list = shield.recommendedList;
    if (!list?.installed || !Array.isArray(list.domains)) return [];
    const excluded = new Set((Array.isArray(list.excludedDomains) ? list.excludedDomains : [])
      .map(domain => this.normaliseDomain(domain))
      .filter(Boolean));
    return list.domains.filter(domain => {
      domain = this.normaliseDomain(domain);
      return domain && !excluded.has(domain);
    });
  },

  getEffectiveDomains(shield = {}) {
    return [...new Set([
      ...(Array.isArray(shield.blockedDomains) ? shield.blockedDomains : []),
      ...this.getRecommendedDomains(shield)
    ].map(domain => this.normaliseDomain(domain)).filter(Boolean))];
  },

  normaliseImportedDomain(value) {
    let domain = String(value || '').trim().toLowerCase();
    if (!domain || /[\s*]/.test(domain)) return null;
    try {
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(domain)) {
        domain = new URL(domain).hostname;
      }
    } catch (e) {
      return null;
    }
    domain = domain.replace(/^\/\//, '').split(/[/?#]/)[0];
    if (!domain || domain.includes(':')) return null;
    return this.normaliseDomain(domain);
  },

  validateRecommendedList(payload, sourceUrl = this.RECOMMENDED_LIST_URL) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('Recommended list is not valid.');
    }
    if (payload.type !== this.RECOMMENDED_LIST_TYPE || !Array.isArray(payload.domains)) {
      throw new Error('Recommended list is not valid.');
    }
    if (payload.domains.length > this.MAX_RECOMMENDED_DOMAINS) {
      throw new Error('Recommended list is not valid.');
    }

    const domains = [...new Set(payload.domains
      .map(domain => this.normaliseImportedDomain(domain))
      .filter(domain => domain && !this.isProtectedDomain(domain)))];

    if (!domains.length) {
      throw new Error('No valid domains found.');
    }

    return {
      installed: true,
      sourceUrl,
      name: String(payload.name || 'Magnetar recommended popup list').slice(0, 120),
      version: String(payload.version || '').slice(0, 40),
      description: String(payload.description || '').slice(0, 240),
      domains
    };
  },

  async installRecommendedList(payload, sourceUrl = this.RECOMMENDED_LIST_URL) {
    const data = await MAGNETAR_API.storage.local.get(['shield']);
    const shield = data.shield || this.getDefaultShield();
    const currentList = shield.recommendedList || {};
    const recommendedList = this.validateRecommendedList(payload, sourceUrl);
    const excludedDomains = [...new Set((Array.isArray(currentList.excludedDomains) ? currentList.excludedDomains : [])
      .map(domain => this.normaliseDomain(domain))
      .filter(Boolean))];
    const now = new Date().toISOString();
    shield.recommendedList = {
      ...recommendedList,
      domains: recommendedList.domains.filter(domain => !excludedDomains.includes(domain)),
      excludedDomains,
      installedAt: currentList.installedAt || now,
      updatedAt: now
    };
    shield.blockedDomains = Array.isArray(shield.blockedDomains) ? shield.blockedDomains : [];
    await MAGNETAR_API.storage.local.set({ shield });

    if (shield.enabled !== false) {
      await this.applyRules(this.getEffectiveDomains(shield));
    }

    return shield;
  },

  async removeRecommendedDomain(domain) {
    domain = this.normaliseDomain(domain);
    const data = await MAGNETAR_API.storage.local.get(['shield']);
    const shield = data.shield || this.getDefaultShield();
    const list = shield.recommendedList || {};
    if (!domain || list.installed !== true) return shield;

    const excludedDomains = [...new Set([
      ...(Array.isArray(list.excludedDomains) ? list.excludedDomains : []),
      domain
    ].map(value => this.normaliseDomain(value)).filter(Boolean))];

    shield.recommendedList = {
      ...list,
      excludedDomains,
      domains: (Array.isArray(list.domains) ? list.domains : []).filter(value => this.normaliseDomain(value) !== domain),
      updatedAt: new Date().toISOString()
    };
    shield.blockedDomains = Array.isArray(shield.blockedDomains) ? shield.blockedDomains : [];
    await MAGNETAR_API.storage.local.set({ shield });

    if (shield.enabled !== false) {
      await this.applyRules(this.getEffectiveDomains(shield));
    }

    return shield;
  },

  async removeRecommendedList() {
    const data = await MAGNETAR_API.storage.local.get(['shield']);
    const shield = data.shield || this.getDefaultShield();
    shield.blockedDomains = Array.isArray(shield.blockedDomains) ? shield.blockedDomains : [];
    shield.recommendedList = { installed: false, domains: [] };
    await MAGNETAR_API.storage.local.set({ shield });

    if (shield.enabled !== false) {
      await this.applyRules(this.getEffectiveDomains(shield));
    }

    return shield;
  },

  /**
   * Initialise Shield — load blocklist from storage, apply rules
   */
  async init() {
    const data = await MAGNETAR_API.storage.local.get(['shield']);
    const shield = data.shield || this.getDefaultShield();

    // Save defaults if first run
    if (!data.shield) {
      await MAGNETAR_API.storage.local.set({ shield });
    }

    if (shield.enabled) {
      await this.applyRules(this.getEffectiveDomains(shield));
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
      .filter(domain => domain && !this.isProtectedDomain(domain)))];

    // Build the new rules
    const rules = validDomains.map((domain, i) => ({
      id: this.RULE_ID_OFFSET + i,
      priority: 1,
      action: { type: 'block' },
      condition: {
        urlFilter: `||${domain}`,
        excludedRequestDomains: [...new Set([...this.PROTECTED_DOMAINS, ...this.extraProtectedDomains])],
        resourceTypes: ['main_frame']
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
      await this.applyRules(this.getEffectiveDomains(shield));
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
      await this.applyRules(this.getEffectiveDomains(shield));
    }

    return shield;
  },

  /**
   * Toggle Shield on/off
   */
  async toggle(enabled) {
    const data = await MAGNETAR_API.storage.local.get(['shield']);
    const shield = data.shield || this.getDefaultShield();
    shield.enabled = enabled;
    await MAGNETAR_API.storage.local.set({ shield });

    if (enabled) {
      await this.applyRules(this.getEffectiveDomains(shield));
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
    if (this.isProtectedDomain(domain)) return false;
    const data = await MAGNETAR_API.storage.local.get(['shield']);
    const shield = data.shield || { enabled: true, blockedDomains: [] };
    if (shield.enabled === false) return false;
    return this.getEffectiveDomains(shield).some(d => domain === d || domain.endsWith('.' + d));
  }
};
