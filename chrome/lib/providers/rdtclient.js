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
  },

  _debugClientList(data = {}) {
    console.debug('Magnetar client panel', {
      provider: 'RDT Client',
      ...data
    });
  },

  _parseClientListJson(text) {
    try {
      return { data: JSON.parse(text) };
    } catch (e) {
      return { error: true };
    }
  },

  async listClientItems(creds, options = {}) {
    const url = String(creds?.url || '').trim().replace(/\/+$/, '');
    if (!url || !creds?.username) return { success: false, setupRequired: true, items: [] };

    const page = Math.max(1, Number(options.page) || 1);
    const pageSize = Math.min(25, Math.max(1, Number(options.pageSize) || 8));
    const offset = (page - 1) * pageSize;

    try {
      const loginRes = await magnetarFetch(`${url}/api/v2/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `username=${encodeURIComponent(creds.username)}&password=${encodeURIComponent(creds.password || '')}`
      });
      const loginText = await loginRes.text();
      this._debugClientList({ helper: 'POST /api/v2/auth/login', status: loginRes.status, emptyBody: !loginText.trim() });
      if (!loginRes.ok) return { success: false, provider: 'RDT Client', items: [], error: 'Could not load client items.' };

      const cookie = loginRes.headers.get('set-cookie');
      const infoRes = await magnetarFetch(`${url}/api/v2/torrents/info?limit=${pageSize}&offset=${offset}`, {
        headers: {
          ...(cookie ? { 'Cookie': cookie } : {})
        },
        credentials: 'include'
      });

      const text = await infoRes.text();
      const emptyBody = !text.trim();
      this._debugClientList({ helper: 'GET /api/v2/torrents/info', status: infoRes.status, emptyBody });
      if (!infoRes.ok) return { success: false, provider: 'RDT Client', items: [], error: 'Could not load client items.' };
      if (emptyBody) return { success: false, provider: 'RDT Client', items: [], error: 'Client returned an empty response.' };

      const parsed = this._parseClientListJson(text);
      if (parsed.error) {
        this._debugClientList({ helper: 'GET /api/v2/torrents/info', status: infoRes.status, emptyBody, parseError: true });
        return { success: false, provider: 'RDT Client', items: [], error: 'Could not load client items.' };
      }
      const data = parsed.data;
      const list = Array.isArray(data) ? data : [];
      this._debugClientList({
        helper: 'GET /api/v2/torrents/info',
        status: infoRes.status,
        emptyBody,
        itemCount: list.length,
        normalisedCount: list.length
      });
      return {
        success: true,
        provider: 'RDT Client',
        page,
        pageSize,
        items: list.map(item => ({
          id: item.hash || item.name,
          hash: item.hash || '',
          name: item.name || item.save_path || 'Unnamed torrent',
          type: item.category || 'torrent',
          size: item.size || item.total_size || 0,
          status: item.state || '',
          provider: 'RDT Client',
          added: item.added_on || item.added || item.created_at || '',
          downloadable: false
        })),
        hasMore: list.length === pageSize
      };
    } catch (e) {
      this._debugClientList({ helper: 'GET /api/v2/torrents/info', error: true });
      return { success: false, provider: 'RDT Client', items: [], error: 'Could not load client items.' };
    }
  }
};

if (typeof self !== 'undefined') {
  self.ProviderRdtClient = ProviderRdtClient;
}
