/**
 * Magnetar — AllDebrid Provider
 */

const ProviderAllDebrid = {
  name: 'AllDebrid',
  id: 'alldebrid',
  baseUrl: 'https://api.alldebrid.com/v4',
  agent: 'magnetar',

  _params(apiKey) {
    return `agent=${this.agent}&apikey=${encodeURIComponent(apiKey)}`;
  },

  async validateCredentials(creds) {
    try {
      const res = await fetch(`${this.baseUrl}/user?${this._params(creds.apiKey)}`);
      if (!res.ok) return { valid: false, error: 'Invalid API key' };
      const data = await res.json();

      if (data.status !== 'success') {
        return { valid: false, error: data.error?.message || 'Validation failed' };
      }

      const user = data.data;
      const expiry = user.premiumUntil
        ? new Date(user.premiumUntil * 1000).toLocaleDateString()
        : 'Unknown';
      return {
        valid: true,
        userInfo: `${user.username || 'Connected'} — Premium until ${expiry}`
      };
    } catch (e) {
      return { valid: false, error: 'Connection failed: ' + e.message };
    }
  },

  async sendMagnet(magnetUri, creds) {
    try {
      const formData = new URLSearchParams();
      formData.append('magnets[]', magnetUri);

      const res = await fetch(`${this.baseUrl}/magnet/upload?${this._params(creds.apiKey)}`, {
        method: 'POST',
        body: formData
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        return { success: false, error: data.error?.message || `HTTP ${res.status}` };
      }
      const data = await res.json();

      if (data.status !== 'success') {
        return { success: false, error: data.error?.message || 'Upload failed' };
      }

      const magnet = data.data?.magnets?.[0];
      return { success: true, id: magnet?.id };
    } catch (e) {
      return { success: false, error: 'Send failed: ' + e.message };
    }
  },

  async checkCache(hash, creds) {
    if (!creds?.apiKey) return 'unknown';
    try {
      const res = await fetch(
        `${this.baseUrl}/magnet/instant?${this._params(creds.apiKey)}&magnets[]=${hash}`
      );
      if (!res.ok) return 'unknown';
      const data = await res.json();

      if (data.status === 'success' && data.data?.magnets) {
        const magnet = data.data.magnets[0];
        if (magnet?.instant === true) return 'cached';
        return 'not_cached';
      }
      return 'unknown';
    } catch (e) {
      return 'unknown';
    }
  }
};

if (typeof window !== 'undefined') {
  window.ProviderAllDebrid = ProviderAllDebrid;
}
