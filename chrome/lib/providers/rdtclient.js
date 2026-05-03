/**
 * Magnetar — RDT Client Provider (Self-Hosted)
 */

const ProviderRdtClient = {
  name: 'RDT Client',
  id: 'rdtclient',

  async validateCredentials(creds) {
    try {
      const url = String(creds?.url || '').trim().replace(/\/+$/, '');
      if (!url) return { valid: false, error: 'Server URL is required' };
      const res = await magnetarFetch(`${url}/api/v2/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `username=${encodeURIComponent(creds.username)}&password=${encodeURIComponent(creds.password)}`
      });
      if (!res.ok) return { valid: false, error: `Auth failed (HTTP ${res.status})` };
      return { valid: true, userInfo: `Connected to ${url}` };
    } catch (e) {
      return { valid: false, error: 'Connection failed: ' + e.message };
    }
  },

  async sendMagnet(magnetUri, creds, options = {}) {
    try {
      const url = String(creds?.url || '').trim().replace(/\/+$/, '');
      if (!url) return { success: false, error: 'Server URL is required' };

      // Login first to get session
      const loginRes = await magnetarFetch(`${url}/api/v2/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `username=${encodeURIComponent(creds.username)}&password=${encodeURIComponent(creds.password)}`
      });
      if (!loginRes.ok) return { success: false, error: 'Auth failed' };

      // Extract session cookie
      const cookie = loginRes.headers.get('set-cookie');

      // Send magnet
      let body = `urls=${encodeURIComponent(magnetUri)}`;
      if (options.category) {
        body += `&category=${encodeURIComponent(options.category)}`;
      }

      const addRes = await magnetarFetch(`${url}/api/v2/torrents/add`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          ...(cookie ? { 'Cookie': cookie } : {})
        },
        body,
        credentials: 'include'
      });

      if (!addRes.ok) {
        return { success: false, error: `Add failed (HTTP ${addRes.status})` };
      }

      return { success: true };
    } catch (e) {
      return { success: false, error: 'Send failed: ' + e.message };
    }
  },

  async checkCache(hash, creds) {
    // RDT Client doesn't have its own cache check, use RD API if key available
    if (!creds?.rdApiKey) return 'unknown';
    return ProviderRealDebrid.checkCache(hash, { apiKey: creds.rdApiKey });
  }
};

if (typeof self !== 'undefined') {
  self.ProviderRdtClient = ProviderRdtClient;
}
