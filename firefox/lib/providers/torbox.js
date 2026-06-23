/**
 * Magnetar — TorBox Provider
 */

const ProviderTorBox = {
  name: "TorBox",
  id: "torbox",
  baseUrl: "https://api.torbox.app/v1/api",

  _headers(apiKey) {
    return {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
  },

  async validateCredentials(creds) {
    const apiKey = String(creds?.apiKey || '').trim();
    if (!apiKey) return { valid: false, error: 'API key is required' };

    try {
      const res = await magnetarFetch(`${this.baseUrl}/user/me`, {
        headers: this._headers(apiKey),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        return {
          valid: false,
          error: data.detail || data.error || `Invalid API key (HTTP ${res.status})`,
        };
      }

      const user = data.data || data;
      const planNames = ['Free', 'Essential', 'Pro', 'Standard'];
      const rawPlan = user.plan ?? user.account_type ?? user.subscription?.plan;
      const rawPlanNumber = Number(rawPlan);
      const plan = Number.isInteger(rawPlanNumber) ? planNames[rawPlanNumber] : rawPlan;

      return {
        valid: true,
        userInfo: `${user.email || user.username || 'Connected'} — ${plan ? plan + ' plan' : 'Active'}`,
      };
    } catch (e) {
      return { valid: false, error: e.message || 'Connection failed' };
    }
  },

  async sendMagnet(magnetUri, creds) {
    try {
      const formData = new FormData();
      formData.append("magnet", magnetUri);

      const res = await magnetarFetch(`${this.baseUrl}/torrents/createtorrent`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${creds.apiKey}`,
        },
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        return {
          success: false,
          error: data.detail || data.error || `HTTP ${res.status}`,
        };
      }
      const data = await res.json();
      return { success: true, id: data.data?.torrent_id || data.data?.id };
    } catch (e) {
      return { success: false, error: "Send failed: " + e.message };
    }
  },

  async checkCache(hash, creds) {
    if (!creds?.apiKey) return "unknown";
    try {
      const res = await magnetarFetch(
        `${this.baseUrl}/torrents/checkcached?hash=${hash}&format=object`,
        {
          headers: this._headers(creds.apiKey),
        }
      );
      if (!res.ok) return "unknown";
      const data = await res.json();

      // TorBox returns data with hash as key
      if (data.data && (data.data[hash] || data.data[hash.toLowerCase()])) {
        return "cached";
      }
      return "not_cached";
    } catch (e) {
      return "unknown";
    }
  },

  _debugClientList(data = {}) {
    console.debug('Magnetar client panel', {
      provider: 'TorBox',
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

  _keys(value) {
    return value && typeof value === 'object' ? Object.keys(value).sort() : [];
  },

  _pickDownloadLink(item = {}) {
    if (typeof item === 'string') {
      const value = item.trim();
      return /^https?:\/\//i.test(value) ? value : '';
    }
    const directKeys = [
      'download',
      'download_url',
      'downloadUrl',
      'download_link',
      'downloadLink',
      'link',
      'url',
      'file_url',
      'fileUrl',
      'web_url',
      'webUrl',
      'torrent_url',
      'torrentUrl'
    ];
    for (const key of directKeys) {
      const value = String(item?.[key] || '').trim();
      if (/^https?:\/\//i.test(value)) return value;
    }

    const nestedLists = [item.files, item.children, item.links].filter(Array.isArray);
    for (const list of nestedLists) {
      for (const child of list) {
        for (const key of directKeys) {
          const value = String(child?.[key] || '').trim();
          if (/^https?:\/\//i.test(value)) return value;
        }
      }
    }
    return '';
  },

  _pickFileId(item = {}) {
    const files = Array.isArray(item.files) ? item.files : Array.isArray(item.children) ? item.children : [];
    const firstFile = files.find(file => file && (file.id || file.file_id || file.fileId));
    return firstFile?.id || firstFile?.file_id || firstFile?.fileId || '';
  },

  _isDownloadReadyStatus(status) {
    const value = String(status || '').toLowerCase().trim();
    if (!value) return true;
    if (/(error|fail|queued|pending|processing|checking|waiting|downloading|uploading|paused|stalled)/.test(value)) {
      return false;
    }
    return /(cached|ready|complete|completed|finished|done|seeding|downloaded|success)/.test(value);
  },

  _normaliseClientItems(data) {
    const source = Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data?.data?.torrents)
        ? data.data.torrents
        : Array.isArray(data?.torrents)
          ? data.torrents
          : Array.isArray(data)
            ? data
            : [];

    return source.map(item => {
      const link = this._pickDownloadLink(item);
      const id = item.id || item.torrent_id || item.torrentId || item.hash || item.name;
      const fileId = this._pickFileId(item);
      const type = String(item.type || item.kind || item.item_type || item.download_type || 'torrent').toLowerCase();
      const status = item.status || item.download_state || item.state || '';
      const downloadable = Boolean(link || (type === 'torrent' && id && this._isDownloadReadyStatus(status)));
      const fileKeys = Array.isArray(item.files) && item.files[0]
        ? this._keys(item.files[0])
        : Array.isArray(item.children) && item.children[0]
          ? this._keys(item.children[0])
          : [];
      this._debugClientList({
        helper: 'normalise:torbox-item',
        itemKeys: this._keys(item),
        nestedFileKeys: fileKeys,
        itemType: type,
        hasDirectDownloadField: Boolean(link),
        normalisedCanDownload: downloadable,
        hasId: Boolean(id),
        hasHash: Boolean(item.hash || item.info_hash),
        hasFileId: Boolean(fileId)
      });
      return {
        id,
        hash: item.hash || item.info_hash || '',
        fileId,
        name: item.name || item.torrent_name || item.filename || `Torrent ${item.id || item.torrent_id || ''}`.trim(),
        type,
        size: item.size || item.total_size || item.bytes || 0,
        status,
        provider: 'TorBox',
        added: item.created_at || item.added_at || item.created || item.date || '',
        downloadable,
        link
      };
    });
  },

  async listClientItems(creds, options = {}) {
    const apiKey = String(creds?.apiKey || '').trim();
    if (!apiKey) return { success: false, setupRequired: true, items: [] };

    const page = Math.max(1, Number(options.page) || 1);
    const pageSize = Math.min(25, Math.max(1, Number(options.pageSize) || 8));
    const offset = (page - 1) * pageSize;

    try {
      const res = await magnetarFetch(`${this.baseUrl}/torrents/mylist`, {
        headers: this._headers(apiKey),
      });
      const text = await res.text();
      const emptyBody = !text.trim();
      this._debugClientList({ helper: 'GET /torrents/mylist', status: res.status, emptyBody });
      if (!res.ok) {
        return { success: false, provider: 'TorBox', items: [], error: 'Could not load client items.' };
      }
      if (emptyBody) {
        return { success: false, provider: 'TorBox', items: [], error: 'Client returned an empty response.' };
      }

      const parsed = this._parseClientListJson(text);
      if (parsed.error) {
        this._debugClientList({ helper: 'GET /torrents/mylist', status: res.status, emptyBody, parseError: true });
        return { success: false, provider: 'TorBox', items: [], error: 'Could not load client items.' };
      }
      if (parsed.data?.success === false) {
        return { success: false, provider: 'TorBox', items: [], error: 'Could not load client items.' };
      }

      const items = this._normaliseClientItems(parsed.data);
      const paged = items.slice(offset, offset + pageSize);
      this._debugClientList({
        helper: 'GET /torrents/mylist',
        status: res.status,
        emptyBody,
        itemCount: items.length,
        normalisedCount: paged.length
      });
      return {
        success: true,
        provider: 'TorBox',
        page,
        pageSize,
        total: items.length,
        items: paged,
        hasMore: offset + pageSize < items.length
      };
    } catch (e) {
      this._debugClientList({ helper: 'GET /torrents/mylist', error: true });
      return { success: false, provider: 'TorBox', items: [], error: 'Could not load client items.' };
    }
  },

  async resolveClientDownload(creds, item = {}) {
    const apiKey = String(creds?.apiKey || '').trim();
    if (!apiKey) return { success: false, error: 'Set up a client first.' };

    const itemType = String(item.type || item.kind || 'torrent').toLowerCase();
    if (itemType !== 'torrent') return { success: false, error: 'Download unavailable.' };

    const direct = String(item.link || '').trim();
    if (/^https?:\/\//i.test(direct)) return { success: true, url: direct };

    const torrentId = String(item.id || '').trim();
    if (!torrentId) return { success: false, error: 'Download unavailable.' };

    try {
      const params = new URLSearchParams({
        token: apiKey,
        torrent_id: torrentId,
        zip_link: 'true',
        redirect: 'false',
        append_name: 'true'
      });
      const res = await magnetarFetch(`${this.baseUrl}/torrents/requestdl?${params.toString()}`);
      const text = await res.text();
      this._debugClientList({
        helper: 'GET /torrents/requestdl',
        itemType,
        status: res.status,
        emptyBody: !text.trim(),
        hasTorrentId: true,
        zipLink: true
      });
      if (!res.ok || !text.trim()) return { success: false, error: 'Could not get download link.' };

      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        const value = text.trim();
        return /^https?:\/\//i.test(value)
          ? { success: true, url: value }
          : { success: false, error: 'Could not get download link.' };
      }

      const link = typeof data?.data === 'string'
        ? String(data.data).trim()
        : this._pickDownloadLink(data?.data || data);
      const dataLooksLikeUrl = /^https?:\/\//i.test(link);
      this._debugClientList({
        helper: 'GET /torrents/requestdl',
        itemType,
        status: res.status,
        success: data?.success === true,
        dataLooksLikeUrl
      });
      if (!dataLooksLikeUrl) return { success: false, error: 'Could not get download link.' };
      return { success: true, url: link };
    } catch (e) {
      return { success: false, error: 'Could not get download link.' };
    }
  },
};

if (typeof self !== 'undefined') {
  self.ProviderTorBox = ProviderTorBox;
}
