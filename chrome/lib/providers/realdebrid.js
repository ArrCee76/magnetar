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
    if (!creds?.apiKey) return 'unknown';
    try {
      const magnet = `magnet:?xt=urn:btih:${hash}`;
      const addRes = await magnetarFetch(`${this.baseUrl}/torrents/addMagnet`, {
        method: 'POST',
        headers: this._headers(creds.apiKey),
        body: `magnet=${encodeURIComponent(magnet)}`
      });

      if (!addRes.ok) return 'unknown';
      const addData = await addRes.json();
      const torrentId = addData.id;
      if (!torrentId) return 'unknown';

      // Wait a moment for RD to resolve the magnet
      await new Promise(r => setTimeout(r, 1500));

      // Check torrent info
      const infoRes = await magnetarFetch(`${this.baseUrl}/torrents/info/${torrentId}`, {
        headers: this._headers(creds.apiKey)
      });

      let status = 'unknown';
      if (infoRes.ok) {
        const info = await infoRes.json();
        if (info.status === 'waiting_files_selection') {
          status = 'cached';
        } else if (info.status === 'magnet_conversion') {
          // Could still be resolving — wait a bit more and retry once
          await new Promise(r => setTimeout(r, 2000));
          const retryRes = await magnetarFetch(`${this.baseUrl}/torrents/info/${torrentId}`, {
            headers: this._headers(creds.apiKey)
          });
          if (retryRes.ok) {
            const retryInfo = await retryRes.json();
            if (retryInfo.status === 'waiting_files_selection') {
              status = 'cached';
            } else {
              status = 'not_cached';
            }
          }
        } else if (info.status === 'queued' || info.status === 'downloading') {
          status = 'not_cached';
        }
      }

      // Clean up probe torrent — fire-and-forget. The user doesn't need
      // to wait for this; it frees up ~200ms per cache check.
      magnetarFetch(`${this.baseUrl}/torrents/delete/${torrentId}`, {
        method: 'DELETE',
        headers: this._headers(creds.apiKey)
      }).catch(() => {});

      return status;
    } catch (e) {
      return 'unknown';
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
