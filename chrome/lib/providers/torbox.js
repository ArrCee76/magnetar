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
    try {
      const res = await fetch(`${this.baseUrl}/user/me`, {
        headers: this._headers(creds.apiKey),
      });
      if (!res.ok) return { valid: false, error: "Invalid API key" };
      const data = await res.json();
      const user = data.data || data;
      return {
        valid: true,
        userInfo: `${user.email || "Connected"} — ${
          user.plan ? user.plan + " plan" : "Active"
        }`,
      };
    } catch (e) {
      return { valid: false, error: "Connection failed: " + e.message };
    }
  },

  async sendMagnet(magnetUri, creds) {
    try {
      const formData = new FormData();
      formData.append("magnet", magnetUri);

      const res = await fetch(`${this.baseUrl}/torrents/createtorrent`, {
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
      const res = await fetch(
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
};

if (typeof window !== "undefined") {
  window.ProviderTorBox = ProviderTorBox;
}
