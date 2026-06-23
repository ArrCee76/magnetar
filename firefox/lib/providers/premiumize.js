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
      const res = await magnetarFetch(`${this.baseUrl}/account/info`, {
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

      const res = await magnetarFetch(`${this.baseUrl}/transfer/create`, {
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
      const res = await magnetarFetch(`${this.baseUrl}/cache/check?items[]=${hash}`, {
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
  },

  _debugClientList(data = {}) {
    console.debug('Magnetar client panel', {
      provider: 'Premiumize',
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

  _normaliseClientItem(item = {}, fallbackType = 'transfer') {
    const link = String(item.link || item.url || item.stream_link || '').trim();
    return {
      id: item.id || item.file_id || item.folder_id || item.name || '',
      name: item.name || item.filename || `${fallbackType} ${item.id || ''}`.trim(),
      type: item.type || fallbackType,
      size: item.size || item.total_size || 0,
      status: item.status || item.message || '',
      provider: 'Premiumize',
      added: item.created_at || item.added_at || item.created || '',
      downloadable: /^https?:\/\//i.test(link),
      link
    };
  },

  async _fetchClientJson(path, apiKey, helper) {
    const res = await magnetarFetch(`${this.baseUrl}${path}`, {
      headers: this._headers(apiKey)
    });
    const text = await res.text();
    const emptyBody = !text.trim();
    this._debugClientList({ helper, status: res.status, emptyBody });
    if (!res.ok || emptyBody) return { ok: false, status: res.status, emptyBody };
    const parsed = this._parseClientListJson(text);
    if (parsed.error) {
      this._debugClientList({ helper, status: res.status, emptyBody, parseError: true });
      return { ok: false, status: res.status, emptyBody, parseError: true };
    }
    if (parsed.data.status && parsed.data.status !== 'success') {
      return { ok: false, status: res.status, emptyBody };
    }
    return { ok: true, data: parsed.data, status: res.status, emptyBody };
  },

  async listClientItems(creds, options = {}) {
    const apiKey = String(creds?.apiKey || '').trim();
    if (!apiKey) return { success: false, setupRequired: true, items: [] };

    const page = Math.max(1, Number(options.page) || 1);
    const pageSize = Math.min(25, Math.max(1, Number(options.pageSize) || 8));
    const offset = (page - 1) * pageSize;

    try {
      const transferResult = await this._fetchClientJson('/transfer/list', apiKey, 'GET /transfer/list');
      const folderResult = await this._fetchClientJson('/folder/list', apiKey, 'GET /folder/list');
      if (!transferResult.ok && !folderResult.ok) {
        return { success: false, provider: 'Premiumize', items: [], error: 'Could not load client items.' };
      }

      const transfers = transferResult.ok && Array.isArray(transferResult.data.transfers)
        ? transferResult.data.transfers.map(item => this._normaliseClientItem(item, 'transfer'))
        : [];
      const cloudItems = folderResult.ok && Array.isArray(folderResult.data.content)
        ? folderResult.data.content.map(item => this._normaliseClientItem(item, item.type || 'cloud'))
        : [];
      const seen = new Set();
      const items = [...transfers, ...cloudItems].filter(item => {
        const key = `${item.type}:${item.id}:${item.name}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const paged = items.slice(offset, offset + pageSize);
      this._debugClientList({
        helper: 'GET /transfer/list + /folder/list',
        transferSupported: transferResult.ok,
        folderSupported: folderResult.ok,
        itemCount: items.length,
        normalisedCount: paged.length
      });
      return {
        success: true,
        provider: 'Premiumize',
        page,
        pageSize,
        total: items.length,
        items: paged,
        hasMore: offset + pageSize < items.length
      };
    } catch (e) {
      this._debugClientList({ helper: 'GET /transfer/list + /folder/list', error: true });
      return { success: false, provider: 'Premiumize', items: [], error: 'Could not load client items.' };
    }
  },

  async resolveClientDownload(creds, item = {}) {
    if (!String(creds?.apiKey || '').trim()) return { success: false, error: 'Set up a client first.' };
    const link = String(item.link || '').trim();
    if (!/^https?:\/\//i.test(link)) return { success: false, error: 'Download unavailable.' };
    return { success: true, url: link };
  }
};

if (typeof self !== 'undefined') {
  self.ProviderPremiumize = ProviderPremiumize;
}
