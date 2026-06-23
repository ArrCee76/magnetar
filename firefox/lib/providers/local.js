/**
 * Magnetar — Local Torrent Client Provider
 * 
 * Fires magnet URIs to the system's default handler.
 */

const ProviderLocal = {
  name: 'Local Client',
  id: 'local',

  async validateCredentials() {
    // No credentials needed
    return { valid: true, userInfo: 'System default torrent client' };
  },

  async sendMagnet(magnetUri) {
    try {
      window.location.assign(magnetUri);
      return { success: true };
    } catch (e) {
      return { success: false, error: 'Failed to open magnet link: ' + e.message };
    }
  },

  async checkCache() {
    return 'unknown'; // Local client doesn't support cache checks
  },

  _debugClientList(data = {}) {
    console.debug('Magnetar client panel', {
      provider: 'qBittorrent',
      ...data
    });
  },

  _parseClientJson(text) {
    try {
      return { data: JSON.parse(text) };
    } catch (e) {
      return { error: true };
    }
  },

  async listClientItems(creds = {}, options = {}) {
    const dashboardUrl = String(creds.dashboardUrl || '').trim().replace(/\/+$/, '');
    if (!dashboardUrl) {
      return {
        success: false,
        unsupported: true,
        provider: 'qBittorrent',
        items: [],
        error: 'This client does not support toolbar browsing yet.'
      };
    }

    const page = Math.max(1, Number(options.page) || 1);
    const pageSize = Math.min(25, Math.max(1, Number(options.pageSize) || 8));
    const offset = (page - 1) * pageSize;

    try {
      const res = await magnetarFetch(`${dashboardUrl}/api/v2/torrents/info?limit=${pageSize}&offset=${offset}`, {
        credentials: 'include'
      });
      const text = await res.text();
      const emptyBody = !text.trim();
      this._debugClientList({ helper: 'GET /api/v2/torrents/info', status: res.status, emptyBody });
      if (!res.ok) return { success: false, provider: 'qBittorrent', items: [], error: 'Could not load client items.' };
      if (emptyBody) return { success: false, provider: 'qBittorrent', items: [], error: 'Client returned an empty response.' };

      const parsed = this._parseClientJson(text);
      if (parsed.error) {
        this._debugClientList({ helper: 'GET /api/v2/torrents/info', status: res.status, emptyBody, parseError: true });
        return { success: false, provider: 'qBittorrent', items: [], error: 'Could not load client items.' };
      }

      const list = Array.isArray(parsed.data) ? parsed.data : [];
      this._debugClientList({
        helper: 'GET /api/v2/torrents/info',
        status: res.status,
        emptyBody,
        itemCount: list.length,
        normalisedCount: list.length
      });
      return {
        success: true,
        provider: 'qBittorrent',
        page,
        pageSize,
        items: list.map(item => ({
          id: item.hash || item.name || '',
          hash: item.hash || '',
          name: item.name || 'Unnamed torrent',
          type: 'torrent',
          size: item.size || item.total_size || 0,
          status: item.state || `${Math.round((Number(item.progress) || 0) * 100)}%`,
          provider: 'qBittorrent',
          added: item.added_on ? new Date(item.added_on * 1000).toISOString() : '',
          downloadable: false
        })),
        hasMore: list.length === pageSize
      };
    } catch (e) {
      this._debugClientList({ helper: 'GET /api/v2/torrents/info', error: true });
      return { success: false, provider: 'qBittorrent', items: [], error: 'Could not load client items.' };
    }
  }
};

if (typeof self !== 'undefined') {
  self.ProviderLocal = ProviderLocal;
}
