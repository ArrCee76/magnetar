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

  _headers(apiKey) {
    return {
      'Authorization': `Bearer ${apiKey}`
    };
  },

  async validateCredentials(creds) {
    try {
      const res = await magnetarFetch(`${this.baseUrl}/user?${this._params(creds.apiKey)}`);
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

      const res = await magnetarFetch(`${this.baseUrl}/magnet/upload?${this._params(creds.apiKey)}`, {
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
      const res = await magnetarFetch(
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
  },

  _debugClientList(data = {}) {
    console.debug('Magnetar client panel', {
      provider: 'AllDebrid',
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

  _normaliseMagnetList(data) {
    const raw = data?.data?.magnets || data?.magnets || [];
    const magnets = Array.isArray(raw)
      ? raw
      : raw && typeof raw === 'object'
        ? Object.values(raw)
        : [];

    return magnets.map(item => {
      const links = Array.isArray(item.links) ? item.links : [];
      const firstLink = links.find(link => /^https?:\/\//i.test(String(link?.link || link?.url || '').trim()));
      const statusCode = Number(item.statusCode);
      const ready = statusCode === 4 || /ready|finished|complete/i.test(String(item.status || ''));
      return {
        id: item.id || item.magnetId || item.hash || item.filename || '',
        hash: item.hash || '',
        name: item.filename || item.name || `Magnet ${item.id || ''}`.trim(),
        type: 'magnet',
        size: item.size || item.totalSize || firstLink?.size || 0,
        status: item.status || item.statusCode || '',
        provider: 'AllDebrid',
        added: item.uploadDate ? new Date(item.uploadDate * 1000).toISOString() : item.created_at || item.added || '',
        downloadable: Boolean(ready && item.id),
        link: ''
      };
    });
  },

  _summariseFileTree(nodes = []) {
    const summary = { rootCount: 0, folderCount: 0, fileCount: 0, firstFileLink: '', links: [] };
    if (!Array.isArray(nodes)) return summary;
    summary.rootCount = nodes.length;
    const seen = new Set();
    const visit = list => {
      if (!Array.isArray(list)) return;
      list.forEach(node => {
        if (!node) return;
        if (typeof node === 'string') {
          const rawLink = node.trim();
          if (/^https?:\/\//i.test(rawLink) && !seen.has(rawLink)) {
            seen.add(rawLink);
            summary.fileCount += 1;
            summary.links.push(rawLink);
            if (!summary.firstFileLink) summary.firstFileLink = rawLink;
          }
          return;
        }
        if (typeof node !== 'object') return;

        const link = String(node.l || node.link || node.url || '').trim();
        if (/^https?:\/\//i.test(link) && !seen.has(link)) {
          seen.add(link);
          summary.fileCount += 1;
          summary.links.push(link);
          if (!summary.firstFileLink) summary.firstFileLink = link;
        }

        const childLists = [node.e, node.children, node.files, node.links].filter(Array.isArray);
        if (childLists.length) {
          summary.folderCount += 1;
          childLists.forEach(visit);
        }
      });
    };
    visit(nodes);
    return summary;
  },

  async listClientItems(creds, options = {}) {
    const apiKey = String(creds?.apiKey || '').trim();
    if (!apiKey) return { success: false, setupRequired: true, items: [] };

    const page = Math.max(1, Number(options.page) || 1);
    const pageSize = Math.min(25, Math.max(1, Number(options.pageSize) || 8));
    const offset = (page - 1) * pageSize;

    try {
      const res = await magnetarFetch(`${this.baseUrl.replace('/v4', '/v4.1')}/magnet/status`, {
        method: 'POST',
        headers: {
          ...this._headers(apiKey),
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams()
      });
      const text = await res.text();
      const emptyBody = !text.trim();
      this._debugClientList({ helper: 'POST /v4.1/magnet/status', status: res.status, emptyBody });
      if (!res.ok) return { success: false, provider: 'AllDebrid', items: [], error: 'Could not load client items.' };
      if (emptyBody) return { success: false, provider: 'AllDebrid', items: [], error: 'Client returned an empty response.' };

      const parsed = this._parseClientJson(text);
      if (parsed.error) {
        this._debugClientList({ helper: 'POST /v4.1/magnet/status', status: res.status, emptyBody, parseError: true });
        return { success: false, provider: 'AllDebrid', items: [], error: 'Could not load client items.' };
      }
      const data = parsed.data;
      if (data.status && data.status !== 'success') {
        return { success: false, provider: 'AllDebrid', items: [], error: 'Could not load client items.' };
      }

      const items = this._normaliseMagnetList(data);
      const paged = items.slice(offset, offset + pageSize);
      this._debugClientList({
        helper: 'POST /v4.1/magnet/status',
        status: res.status,
        emptyBody,
        itemCount: items.length,
        normalisedCount: paged.length
      });
      return {
        success: true,
        provider: 'AllDebrid',
        page,
        pageSize,
        total: items.length,
        items: paged,
        hasMore: offset + pageSize < items.length
      };
    } catch (e) {
      this._debugClientList({ helper: 'POST /v4.1/magnet/status', error: true });
      return { success: false, provider: 'AllDebrid', items: [], error: 'Could not load client items.' };
    }
  },

  async resolveClientDownload(creds, item = {}) {
    const apiKey = String(creds?.apiKey || '').trim();
    if (!apiKey) return { success: false, error: 'Set up a client first.' };

    let link = '';

    try {
      const id = String(item.id || '').trim();
      if (id) {
        const filesBody = new URLSearchParams();
        filesBody.append('id[]', id);
        const filesRes = await magnetarFetch(`${this.baseUrl}/magnet/files`, {
          method: 'POST',
          headers: {
            ...this._headers(apiKey),
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: filesBody
        });
        const filesText = await filesRes.text();
        const filesEmpty = !filesText.trim();
        this._debugClientList({ helper: 'POST /magnet/files', status: filesRes.status, emptyBody: filesEmpty, hasMagnetId: true });
        if (!filesRes.ok || filesEmpty) return { success: false, error: 'Could not get download link.' };
        const filesParsed = this._parseClientJson(filesText);
        if (filesParsed.error || (filesParsed.data.status && filesParsed.data.status !== 'success')) {
          return { success: false, error: 'Could not get download link.' };
        }
        const magnet = (filesParsed.data?.data?.magnets || []).find(entry => String(entry?.id) === id) || filesParsed.data?.data?.magnets?.[0];
        const fileSummary = this._summariseFileTree(magnet?.files || []);
        this._debugClientList({
          helper: 'POST /magnet/files',
          magnetKeys: magnet && typeof magnet === 'object' ? Object.keys(magnet).sort() : [],
          rootCount: fileSummary.rootCount,
          folderCount: fileSummary.folderCount,
          fileCount: fileSummary.fileCount
        });
        if (fileSummary.links.length >= 1) {
          return {
            success: true,
            action: 'alldebrid-service-open',
            title: item.name || magnet?.filename || magnet?.name || '',
            links: fileSummary.links,
            expectedLinkCount: fileSummary.links.length
          };
        }
        return { success: false, error: 'Could not get download links.' };
      } else {
        link = String(item.link || '').trim();
        if (!/^https?:\/\//i.test(link)) return { success: false, error: 'Download unavailable.' };
      }

      const unlockBody = new URLSearchParams({ link });
      const res = await magnetarFetch(`${this.baseUrl}/link/unlock`, {
        method: 'POST',
        headers: {
          ...this._headers(apiKey),
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: unlockBody
      });
      const text = await res.text();
      const emptyBody = !text.trim();
      this._debugClientList({ helper: 'POST /link/unlock', status: res.status, emptyBody, hasInputLink: true });
      if (!res.ok || emptyBody) return { success: false, error: 'Could not get download link.' };

      const parsed = this._parseClientJson(text);
      if (parsed.error || (parsed.data.status && parsed.data.status !== 'success')) {
        return { success: false, error: 'Could not get download link.' };
      }
      const downloadUrl = String(parsed.data?.data?.link || parsed.data?.link || '').trim();
      const dataLooksLikeUrl = /^https?:\/\//i.test(downloadUrl);
      this._debugClientList({ helper: 'POST /link/unlock', status: res.status, dataLooksLikeUrl });
      if (!dataLooksLikeUrl) return { success: false, error: 'Could not get download link.' };
      return { success: true, url: downloadUrl };
    } catch (e) {
      return { success: false, error: 'Could not get download link.' };
    }
  }
};

if (typeof self !== 'undefined') {
  self.ProviderAllDebrid = ProviderAllDebrid;
}
