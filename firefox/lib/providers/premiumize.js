/**
 * Magnetar — Premiumize Provider
 */

const ProviderPremiumize = {
  name: 'Premiumize',
  id: 'premiumize',
  baseUrl: 'https://www.premiumize.me/api',

  _headers(apiKey) {
    return {
      'Authorization': `Bearer ${apiKey}`
    };
  },

  async validateCredentials(creds) {
    try {
      const res = await fetch(`${this.baseUrl}/account/info`, {
        headers: this._headers(creds.apiKey)
      });
      if (!res.ok) return { valid: false, error: 'Invalid API key' };
      const data = await res.json();
      if (data.status !== 'success') return { valid: false, error: data.message || 'Validation failed' };

      const expiry = data.premium_until
        ? new Date(data.premium_until * 1000).toLocaleDateString()
        : 'Unknown';
      return {
        valid: true,
        userInfo: `${data.customer_id || 'Connected'} — Premium until ${expiry}`
      };
    } catch (e) {
      return { valid: false, error: 'Connection failed: ' + e.message };
    }
  },

  async sendMagnet(magnetUri, creds) {
    try {
      const formData = new URLSearchParams();
      formData.append('src', magnetUri);

      const res = await fetch(`${this.baseUrl}/transfer/create`, {
        method: 'POST',
        headers: this._headers(creds.apiKey),
        body: formData
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        return { success: false, error: data.message || `HTTP ${res.status}` };
      }
      const data = await res.json();
      if (data.status !== 'success') {
        return { success: false, error: data.message || 'Transfer failed' };
      }
      return { success: true, id: data.id };
    } catch (e) {
      return { success: false, error: 'Send failed: ' + e.message };
    }
  },

  async checkCache(hash, creds) {
    if (!creds?.apiKey) return 'unknown';
    try {
      const res = await fetch(`${this.baseUrl}/cache/check?items[]=${hash}`, {
        headers: this._headers(creds.apiKey)
      });
      if (!res.ok) return 'unknown';
      const data = await res.json();

      if (data.status === 'success' && data.response) {
        // response is an array of booleans matching the items array
        if (data.response[0] === true) return 'cached';
        return 'not_cached';
      }
      return 'unknown';
    } catch (e) {
      return 'unknown';
    }
  }
};

if (typeof window !== 'undefined') {
  window.ProviderPremiumize = ProviderPremiumize;
}
