/**
 * Magnetar — Real-Debrid Provider
 */

const ProviderRealDebrid = {
  name: 'Real-Debrid',
  id: 'realdebrid',
  baseUrl: 'https://api.real-debrid.com/rest/1.0',

  _headers(apiKey) {
    return {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    };
  },

  async validateCredentials(creds) {
    try {
      const res = await fetch(`${this.baseUrl}/user`, {
        headers: this._headers(creds.apiKey)
      });
      if (!res.ok) return { valid: false, error: 'Invalid API key' };
      const data = await res.json();
      return {
        valid: true,
        userInfo: `${data.username} — ${data.type} (expires ${new Date(data.expiration).toLocaleDateString()})`
      };
    } catch (e) {
      return { valid: false, error: 'Connection failed: ' + e.message };
    }
  },

  async sendMagnet(magnetUri, creds) {
    try {
      const res = await fetch(`${this.baseUrl}/torrents/addMagnet`, {
        method: 'POST',
        headers: this._headers(creds.apiKey),
        body: `magnet=${encodeURIComponent(magnetUri)}`
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        return { success: false, error: data.error || `HTTP ${res.status}` };
      }
      const data = await res.json();

      // Auto-select all files
      if (data.id) {
        await fetch(`${this.baseUrl}/torrents/selectFiles/${data.id}`, {
          method: 'POST',
          headers: this._headers(creds.apiKey),
          body: 'files=all'
        });
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
      const addRes = await fetch(`${this.baseUrl}/torrents/addMagnet`, {
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
      const infoRes = await fetch(`${this.baseUrl}/torrents/info/${torrentId}`, {
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
          const retryRes = await fetch(`${this.baseUrl}/torrents/info/${torrentId}`, {
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

      // Clean up probe torrent
      await fetch(`${this.baseUrl}/torrents/delete/${torrentId}`, {
        method: 'DELETE',
        headers: this._headers(creds.apiKey)
      }).catch(() => {});

      return status;
    } catch (e) {
      return 'unknown';
    }
  }
};

if (typeof window !== 'undefined') {
  window.ProviderRealDebrid = ProviderRealDebrid;
}
