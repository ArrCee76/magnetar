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
  }
};

if (typeof window !== 'undefined') {
  window.ProviderLocal = ProviderLocal;
}
