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
      // The /instantAvailability endpoint was deprecated by RD in late 2025.
      // Alternative: add the magnet, check if it's instantly available, then delete it.
      // We use a lightweight approach: add magnet, check status, remove if just probing.
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

      // Check torrent info — if status is 'waiting_files_selection' it means
      // RD has the files cached and is ready to serve them
      const infoRes = await fetch(`${this.baseUrl}/torrents/info/${torrentId}`, {
        headers: this._headers(creds.apiKey)
      });

      let status = 'unknown';
      if (infoRes.ok) {
        const info = await infoRes.json();
        // 'waiting_files_selection' = cached and ready
        // 'magnet_conversion' = not yet cached, still resolving
        // 'queued' = in queue
        if (info.status === 'waiting_files_selection') {
          status = 'cached';
        } else if (info.status === 'magnet_conversion' || info.status === 'queued') {
          status = 'not_cached';
        }
      }

      // Clean up — delete the probe torrent so we don't pollute the user's list
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
