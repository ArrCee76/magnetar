/**
 * Magnetar — Real-Debrid Provider
 */

const ProviderRealDebrid = {
  name: 'Real-Debrid',
  id: 'realdebrid',
  baseUrl: 'https://api.real-debrid.com/rest/1.0',
  supportsUrlSend: false,

  _headers(apiKey) {
    return {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    };
  },

  async validateCredentials(creds) {
    const apiKey = String(creds?.apiKey || '').trim();
    if (!apiKey) return { valid: false, error: 'API key is required' };

    try {
      const res = await magnetarFetch(`${this.baseUrl}/user`, {
        headers: this._headers(apiKey)
      });
      if (!res.ok) return { valid: false, error: `Invalid API key (HTTP ${res.status})` };
      const data = await res.json();
      return {
        valid: true,
        userInfo: `${data.username} — ${data.type} (expires ${new Date(data.expiration).toLocaleDateString()})`
      };
    } catch (e) {
      return { valid: false, error: e.message || 'Connection failed' };
    }
  },

  async sendMagnet(magnetUri, creds) {
    const canonicalMagnet = String(magnetUri || '').trim();
    if (!/^magnet:\?[^#]*\bxt=urn:btih:[a-f0-9]{40}(?:&|$)/i.test(canonicalMagnet)) {
      return { success: false, code: 'SAVED_SEND_INVALID_PAYLOAD', error: 'This Saved item does not contain a valid magnet or torrent hash.' };
    }
    try {
      const res = await magnetarFetch(`${this.baseUrl}/torrents/addMagnet`, {
        method: 'POST',
        headers: this._headers(creds.apiKey),
        body: `magnet=${encodeURIComponent(canonicalMagnet)}`
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        return { success: false, adapterStatus: res.status, adapterCode: data.error_code || data.error || '', error: data.error || `HTTP ${res.status}` };
      }
      const data = await res.json();

      // Auto-select all files. Fire-and-forget so a slow selectFiles call does not fail the addMagnet request.
      if (data.id) {
        magnetarFetch(`${this.baseUrl}/torrents/selectFiles/${data.id}`, {
          method: 'POST',
          headers: this._headers(creds.apiKey),
          body: 'files=all'
        }).catch(() => {});
      }

      return { success: true, id: data.id };
    } catch (e) {
      return { success: false, error: 'Send failed: ' + e.message };
    }
  },

  async checkCache(hash, creds) {
    // The published Real-Debrid API has no read-only cache availability check.
    // Adding a magnet creates an account torrent, so report unknown without mutation.
    return 'unknown';
  },

  async getTorrentStatus(torrentId, creds, timeoutMs = 5000) {
    const id = String(torrentId || '').trim();
    if (!/^\d{1,20}$/.test(id) || !creds?.apiKey) return { ok: false };
    try {
      const res = await magnetarFetch(`${this.baseUrl}/torrents/info/${encodeURIComponent(id)}`, {
        headers: this._headers(creds.apiKey),
        timeout: Math.min(5000, Math.max(1000, Number(timeoutMs) || 5000))
      });
      if (res.status === 429) {
        const retryHeader = res.headers?.get?.('Retry-After') || '';
        const retrySeconds = Number(retryHeader);
        const retryAt = Date.parse(retryHeader);
        const retryAfterMs = Number.isFinite(retrySeconds) && retrySeconds > 0
          ? retrySeconds * 1000
          : (Number.isFinite(retryAt) ? Math.max(1000, retryAt - Date.now()) : 5000);
        return { ok: false, retryAfterMs };
      }
      if (!res.ok) return { ok: false };
      const info = await res.json();
      if (!info || typeof info.status !== 'string') return { ok: false };
      const selectedCount = Array.isArray(info.files)
        ? info.files.filter(file => Number(file?.selected) === 1).length
        : 0;
      const linkCount = Array.isArray(info.links) ? info.links.filter(link => typeof link === 'string' && link.trim()).length : 0;
      return {
        ok: true,
        status: info.status,
        ready: info.status === 'downloaded' && selectedCount > 0 && linkCount >= selectedCount
      };
    } catch (e) {
      return { ok: false };
    }
  },

  _debugClientList(data = {}) {
    console.debug('Magnetar client panel', {
      provider: 'Real-Debrid',
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
    const apiKey = String(creds?.apiKey || '').trim();
    if (!apiKey) return { success: false, setupRequired: true, items: [] };

    const page = Math.max(1, Number(options.page) || 1);
    const pageSize = Math.min(25, Math.max(1, Number(options.pageSize) || 8));
    const offset = (page - 1) * pageSize;

    try {
      const res = await magnetarFetch(`${this.baseUrl}/torrents`, {
        headers: this._headers(apiKey)
      });
      const text = await res.text();
      const emptyBody = !text.trim();
      this._debugClientList({ helper: 'GET /torrents', status: res.status, emptyBody });
      if (!res.ok) {
        return { success: false, provider: 'Real-Debrid', items: [], error: 'Could not load client items.' };
      }
      if (emptyBody) {
        return { success: false, provider: 'Real-Debrid', items: [], error: 'Client returned an empty response.' };
      }

      const parsed = this._parseClientListJson(text);
      if (parsed.error) {
        this._debugClientList({ helper: 'GET /torrents', status: res.status, emptyBody, parseError: true });
        return { success: false, provider: 'Real-Debrid', items: [], error: 'Could not load client items.' };
      }
      const data = parsed.data;
      const list = Array.isArray(data) ? data : [];
      const paged = list.slice(offset, offset + pageSize);
      this._debugClientList({
        helper: 'GET /torrents',
        status: res.status,
        emptyBody,
        itemCount: list.length,
        normalisedCount: paged.length
      });
      return {
        success: true,
        provider: 'Real-Debrid',
        page,
        pageSize,
        total: list.length,
        items: paged.map(item => ({
          id: item.id,
          name: item.filename || item.name || `Torrent ${item.id || ''}`.trim(),
          type: 'torrent',
          size: item.bytes || item.size || 0,
          status: item.status || '',
          provider: 'Real-Debrid',
          added: item.added || item.created || '',
          link: Array.isArray(item.links) ? item.links[0] : ''
        })),
        hasMore: offset + pageSize < list.length
      };
    } catch (e) {
      this._debugClientList({ helper: 'GET /torrents', error: true });
      return { success: false, provider: 'Real-Debrid', items: [], error: 'Could not load client items.' };
    }
  },

  async resolveClientDownload(creds, item = {}) {
    const apiKey = String(creds?.apiKey || '').trim();
    if (!apiKey) return { success: false, error: 'Set up a client first.' };

    try {
      let link = String(item.link || '').trim();
      if (!link && item.id) {
        const infoRes = await magnetarFetch(`${this.baseUrl}/torrents/info/${encodeURIComponent(item.id)}`, {
          headers: this._headers(apiKey)
        });
        const text = await infoRes.text();
        if (!infoRes.ok || !text.trim()) {
          return { success: false, error: 'Could not get download link.' };
        }
        let info;
        try {
          info = JSON.parse(text);
        } catch (e) {
          return { success: false, error: 'Could not get download link.' };
        }
        link = Array.isArray(info.links) ? String(info.links[0] || '').trim() : '';
      }

      if (!link) return { success: false, error: 'Download unavailable.' };

      const res = await magnetarFetch(`${this.baseUrl}/unrestrict/link`, {
        method: 'POST',
        headers: this._headers(apiKey),
        body: `link=${encodeURIComponent(link)}`
      });
      const text = await res.text();
      if (!res.ok || !text.trim()) {
        return { success: false, error: 'Could not get download link.' };
      }
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        return { success: false, error: 'Could not get download link.' };
      }
      const downloadUrl = String(data.download || '').trim();
      if (!downloadUrl) return { success: false, error: 'Download unavailable.' };
      return { success: true, url: downloadUrl };
    } catch (e) {
      return { success: false, error: 'Could not get download link.' };
    }
  }
};

if (typeof self !== 'undefined') {
  self.ProviderRealDebrid = ProviderRealDebrid;
}
