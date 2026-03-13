/**
 * Magnetar — Hash Detection Engine
 * 
 * Six-layer detection pipeline:
 * 1. Custom site rules (user-defined CSS selectors / regex)
 * 2. Magnet link scan (DOM <a> elements with magnet: hrefs)
 * 3. Labelled hash scan (text patterns near "Info Hash:" etc.)
 * 4. Structured data scan (data- attributes, hidden inputs, <code> blocks)
 * 5. Broad regex sweep (40/64 hex chars, 32 Base32 chars)
 * 6. Confidence scoring (corroborating torrent signals)
 */

const MagnetarDetector = (() => {

  // ── Constants ──────────────────────────────────────────────────────────

  const SHA1_HEX = /\b([a-fA-F0-9]{40})\b/;
  const SHA256_HEX = /\b([a-fA-F0-9]{64})\b/;
  const BASE32_HASH = /\b([A-Z2-7]{32})\b/;
  const MAGNET_URI = /magnet:\?xt=urn:btih:([a-fA-F0-9]{40}|[a-fA-F0-9]{64}|[A-Z2-7]{32})/i;

  const HASH_LABELS = [
    'info hash', 'infohash', 'info_hash', 'hash:', 'btih:',
    'info hash:', 'infohash:', 'torrent hash', 'torrent hash:'
  ];

  const TORRENT_SIGNALS = {
    seedLeech: /\b(seed(?:s|ers?)?|leech(?:s|ers?)?|peer(?:s)?)\s*[:\s]*\d+/i,
    fileSize: /\b\d+(?:\.\d+)?\s*(?:GB|MB|TB|GiB|MiB|TiB)\b/i,
    trackerUrl: /(?:udp|http|https):\/\/[^\s"']+(?:announce|tracker)/i,
    magnetLink: /magnet:\?/i,
    torrentMeta: /\b(?:torrent|magnet|seeds|leechers|uploaded|swarm)\b/i,
    categoryBadge: /\b(?:audio\s*book|ebook|flac|mp3|x264|x265|hevc|aac|bluray|webrip|hdtv)\b/i
  };

  // ── Utilities ──────────────────────────────────────────────────────────

  /**
   * Convert Base32 hash to hex
   */
  function base32ToHex(base32) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = '';
    for (const char of base32.toUpperCase()) {
      const val = alphabet.indexOf(char);
      if (val === -1) return null;
      bits += val.toString(2).padStart(5, '0');
    }
    let hex = '';
    for (let i = 0; i + 4 <= bits.length; i += 4) {
      hex += parseInt(bits.substring(i, i + 4), 2).toString(16);
    }
    return hex.length === 40 || hex.length === 64 ? hex : null;
  }

  /**
   * Normalise any hash to lowercase hex
   */
  function normaliseHash(raw) {
    if (!raw) return null;
    const trimmed = raw.trim().replace(/\s+/g, '');

    // Already hex
    if (/^[a-fA-F0-9]{40}$/.test(trimmed) || /^[a-fA-F0-9]{64}$/.test(trimmed)) {
      return trimmed.toLowerCase();
    }

    // Base32
    if (/^[A-Z2-7]{32}$/.test(trimmed)) {
      const hex = base32ToHex(trimmed);
      return hex ? hex.toLowerCase() : null;
    }

    return null;
  }

  /**
   * Extract hash from a magnet URI
   */
  function hashFromMagnet(magnetUri) {
    const match = magnetUri.match(MAGNET_URI);
    return match ? normaliseHash(match[1]) : null;
  }

  /**
   * Extract display name from magnet URI
   */
  function nameFromMagnet(magnetUri) {
    const match = magnetUri.match(/[?&]dn=([^&]+)/);
    return match ? decodeURIComponent(match[1].replace(/\+/g, ' ')) : null;
  }

  /**
   * Build a full magnet URI from a hash and optional name
   */
  function buildMagnet(hash, name) {
    let uri = `magnet:?xt=urn:btih:${hash}`;
    if (name) {
      uri += `&dn=${encodeURIComponent(name)}`;
    }
    // Default open trackers
    const trackers = [
      'udp://tracker.opentrackr.org:1337/announce',
      'udp://open.stealth.si:80/announce',
      'udp://tracker.openbittorrent.com:6969/announce',
      'udp://open.demonii.com:1337/announce',
      'udp://tracker.torrent.eu.org:451/announce'
    ];
    trackers.forEach(t => {
      uri += `&tr=${encodeURIComponent(t)}`;
    });
    return uri;
  }

  /**
   * Check if context suggests this is NOT a torrent hash (false positive filter)
   */
  function isFalsePositive(hashStr, contextText) {
    if (!contextText) return false;
    const ctx = contextText.toLowerCase();

    // Git context
    if (/\b(?:commit|sha|git|merge|branch|pull request|diff|repo(?:sitory)?)\b/.test(ctx)) return true;

    // CSS colour (unlikely at 40 chars but check anyway)
    if (/^#?[a-f0-9]{6}$/i.test(hashStr)) return true;

    // API/token/session context
    if (/\b(?:api[_\s]?key|token|secret|password|session|csrf|nonce|auth|bearer|jwt|cookie|credential)\b/.test(ctx)) return true;

    // Checksum context (file verification, not torrent)
    if (/\b(?:sha256sum|sha1sum|md5sum|checksum|verify|integrity|fingerprint|certificate)\b/.test(ctx)) return true;

    // AI/chat/messaging platforms (session IDs, conversation IDs)
    if (/\b(?:conversation|message|chat|model|prompt|usage|session|plan|billing|subscription|account)\b/.test(ctx)) return true;

    // Dashboard/app context (internal IDs)
    if (/\b(?:dashboard|settings|profile|preference|notification|workspace|organization)\b/.test(ctx)) return true;

    return false;
  }

  /**
   * Check if the current URL is a known non-torrent site
   */
  function isExcludedSite() {
    const host = window.location.hostname;
    const excluded = [
      'claude.ai', 'chat.openai.com', 'chatgpt.com', 'gemini.google.com',
      'github.com', 'gitlab.com', 'bitbucket.org',
      'google.com', 'google.se', 'bing.com', 'duckduckgo.com',
      'youtube.com', 'facebook.com', 'twitter.com', 'x.com',
      'reddit.com', 'linkedin.com', 'instagram.com',
      'amazon.com', 'ebay.com', 'netflix.com', 'spotify.com',
      'stackoverflow.com', 'developer.mozilla.org',
      'mail.google.com', 'outlook.live.com', 'outlook.office.com',
      'docs.google.com', 'drive.google.com', 'sheets.google.com',
      'notion.so', 'slack.com', 'discord.com', 'teams.microsoft.com',
      'bank', 'banking', 'paypal.com', 'stripe.com',
      'localhost'
    ];
    return excluded.some(ex => host === ex || host.endsWith('.' + ex) || host.includes(ex));
  }


  // ── Detection Layers ───────────────────────────────────────────────────

  /**
   * Layer 1: Custom site rules
   */
  function detectCustomRules(customSites) {
    const hostname = window.location.hostname;

    for (const site of customSites) {
      const pattern = site.domain.replace(/\*/g, '.*');
      const regex = new RegExp(`^${pattern}$`, 'i');

      if (!regex.test(hostname)) continue;

      if (site.method === 'selector' && site.selector) {
        const el = document.querySelector(site.selector);
        if (el) {
          const hash = normaliseHash(el.textContent);
          if (hash) return { hash, source: 'custom-selector', name: null };
        }
      }

      if (site.method === 'regex' && site.regex) {
        try {
          const re = new RegExp(site.regex, 'i');
          const match = document.body.textContent.match(re);
          if (match && match[1]) {
            const hash = normaliseHash(match[1]);
            if (hash) return { hash, source: 'custom-regex', name: null };
          }
        } catch (e) {
          console.warn('Magnetar: Invalid custom regex for', site.domain, e);
        }
      }
    }

    return null;
  }

  /**
   * Layer 2: Magnet link scan
   */
  function detectMagnetLinks() {
    const anchors = document.querySelectorAll('a[href^="magnet:"]');
    if (anchors.length === 0) return null;

    // Collect all unique hashes to determine if this is a listing or detail page
    const uniqueHashes = new Set();
    const results = [];

    for (const a of anchors) {
      const hash = hashFromMagnet(a.href);
      if (!hash) continue;
      uniqueHashes.add(hash);

      const name = nameFromMagnet(a.href);
      results.push({ hash, source: 'magnet-link', name, magnetUri: a.href });
    }

    // Multiple unique hashes = listing/search page — don't auto-select
    if (uniqueHashes.size > 2) return null;

    // Single hash (or two, e.g. v1 + v2 of same torrent) — this is a detail page
    // Prefer the result with a display name
    let best = null;
    for (const r of results) {
      if (r.name) return r;
      if (!best) best = r;
    }

    return best;
  }

  /**
   * Layer 3: Labelled hash scan
   */
  function detectLabelledHash() {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      null
    );

    while (walker.nextNode()) {
      const text = walker.currentNode.textContent.toLowerCase();

      for (const label of HASH_LABELS) {
        const idx = text.indexOf(label);
        if (idx === -1) continue;

        // Check text after the label in this node
        const afterLabel = walker.currentNode.textContent.substring(idx + label.length);
        let match = afterLabel.match(SHA1_HEX) || afterLabel.match(SHA256_HEX);
        if (match) {
          const hash = normaliseHash(match[1]);
          if (hash) return { hash, source: 'labelled-hash', name: null };
        }

        // Check sibling/adjacent elements
        const parentEl = walker.currentNode.parentElement;
        if (parentEl) {
          const next = parentEl.nextElementSibling;
          if (next) {
            const nextText = next.textContent;
            match = nextText.match(SHA1_HEX) || nextText.match(SHA256_HEX);
            if (match) {
              const hash = normaliseHash(match[1]);
              if (hash) return { hash, source: 'labelled-hash', name: null };
            }
          }

          // Check inside parent's code/span/td children
          const codeEls = parentEl.parentElement?.querySelectorAll('code, span, td, dd, div');
          if (codeEls) {
            for (const el of codeEls) {
              match = el.textContent.match(SHA1_HEX) || el.textContent.match(SHA256_HEX);
              if (match) {
                const hash = normaliseHash(match[1]);
                if (hash) return { hash, source: 'labelled-hash', name: null };
              }
            }
          }
        }
      }
    }

    return null;
  }

  /**
   * Layer 4: Structured data scan
   */
  function detectStructuredData() {
    // data- attributes
    const dataAttrs = ['data-hash', 'data-infohash', 'data-info-hash', 'data-magnet', 'data-btih'];
    for (const attr of dataAttrs) {
      const els = document.querySelectorAll(`[${attr}]`);
      for (const el of els) {
        const val = el.getAttribute(attr);

        // Could be a full magnet URI in data-magnet
        if (attr === 'data-magnet' && val.startsWith('magnet:')) {
          const hash = hashFromMagnet(val);
          if (hash) return { hash, source: 'data-attr', name: nameFromMagnet(val), magnetUri: val };
        }

        const hash = normaliseHash(val);
        if (hash) return { hash, source: 'data-attr', name: null };
      }
    }

    // Hidden inputs
    const inputs = document.querySelectorAll('input[type="hidden"]');
    for (const input of inputs) {
      const name = (input.name || input.id || '').toLowerCase();
      if (name.includes('hash') || name.includes('magnet') || name.includes('btih')) {
        const hash = normaliseHash(input.value);
        if (hash) return { hash, source: 'hidden-input', name: null };
      }
    }

    // <code> blocks with isolated hashes
    const codeBlocks = document.querySelectorAll('code, pre');
    for (const block of codeBlocks) {
      const text = block.textContent.trim();
      if (/^[a-fA-F0-9]{40}$/.test(text) || /^[a-fA-F0-9]{64}$/.test(text)) {
        const hash = normaliseHash(text);
        if (hash && !isFalsePositive(text, block.parentElement?.textContent)) {
          return { hash, source: 'code-block', name: null };
        }
      }
    }

    return null;
  }

  /**
   * Layer 5: Broad regex sweep with false positive filtering
   */
  function detectBroadSweep() {
    const bodyText = document.body.textContent;
    const candidates = [];

    // SHA-1 (40 hex)
    const sha1Matches = bodyText.matchAll(/\b([a-fA-F0-9]{40})\b/g);
    for (const m of sha1Matches) {
      candidates.push({ raw: m[1], index: m.index, type: 'sha1' });
    }

    // SHA-256 (64 hex)
    const sha256Matches = bodyText.matchAll(/\b([a-fA-F0-9]{64})\b/g);
    for (const m of sha256Matches) {
      candidates.push({ raw: m[1], index: m.index, type: 'sha256' });
    }

    // Base32 (32 chars)
    const b32Matches = bodyText.matchAll(/\b([A-Z2-7]{32})\b/g);
    for (const m of b32Matches) {
      candidates.push({ raw: m[1], index: m.index, type: 'base32' });
    }

    // Filter false positives using surrounding context
    for (const candidate of candidates) {
      const start = Math.max(0, candidate.index - 200);
      const end = Math.min(bodyText.length, candidate.index + candidate.raw.length + 200);
      const context = bodyText.substring(start, end);

      if (isFalsePositive(candidate.raw, context)) continue;

      const hash = normaliseHash(candidate.raw);
      if (hash) return { hash, source: 'broad-sweep', name: null };
    }

    return null;
  }

  /**
   * Layer 6: Confidence scoring — check for corroborating torrent signals
   */
  function getTorrentConfidence() {
    const bodyText = document.body.textContent;
    const bodyHtml = document.body.innerHTML;
    let score = 0;

    if (TORRENT_SIGNALS.seedLeech.test(bodyText)) score += 2;
    if (TORRENT_SIGNALS.fileSize.test(bodyText)) score += 1;
    if (TORRENT_SIGNALS.trackerUrl.test(bodyHtml)) score += 2;
    if (TORRENT_SIGNALS.magnetLink.test(bodyHtml)) score += 2;
    if (TORRENT_SIGNALS.torrentMeta.test(bodyText)) score += 1;
    if (TORRENT_SIGNALS.categoryBadge.test(bodyText)) score += 1;

    return score;
  }


  // ── Main Detection Pipeline ────────────────────────────────────────────

  /**
   * Run the full detection pipeline.
   * Returns: { hash, name, magnetUri, source, confidence } or null
   */
  function detect(customSites = []) {
    // Quick bail: skip obvious non-torrent pages
    if (document.contentType && !document.contentType.includes('html')) return null;

    let result = null;

    // Layer 1: Custom rules (highest priority, always runs)
    if (customSites.length > 0) {
      result = detectCustomRules(customSites);
      if (result) {
        result.confidence = 10; // Custom rule = full confidence
        return finalise(result);
      }
    }

    // Skip all remaining layers on known non-torrent sites
    // (GitHub, Google, banking sites etc. contain 40-char hex strings
    // that look like hashes but aren't — commit SHAs, tokens, etc.)
    if (isExcludedSite()) return null;

    // Layer 2: Magnet links
    result = detectMagnetLinks();
    if (result) {
      result.confidence = 10; // Magnet link = full confidence
      return finalise(result);
    }

    // Layer 3: Labelled hashes
    result = detectLabelledHash();
    if (result) {
      result.confidence = 8; // Label + hash = high confidence
      return finalise(result);
    }

    // Layer 4: Structured data
    result = detectStructuredData();
    if (result) {
      result.confidence = 7;
      return finalise(result);
    }

    // Layer 5 + 6: Broad sweep requires confidence check
    result = detectBroadSweep();
    if (result) {
      const confidence = getTorrentConfidence();
      result.confidence = confidence;

      // Only show banner if we have corroborating signals
      if (confidence >= 3) {
        return finalise(result);
      }

      // Low confidence — return with flag so icon can dim
      result.lowConfidence = true;
      return finalise(result);
    }

    // Nothing found — check if this looks like a torrent page anyway (for dimmed icon)
    const confidence = getTorrentConfidence();
    if (confidence >= 3) {
      return { hash: null, name: null, magnetUri: null, source: null, confidence, noHash: true };
    }

    return null;
  }

  /**
   * Finalise a detection result — build magnet URI if needed, extract name
   */
  function finalise(result) {
    // Try to get name from page title if not from magnet
    if (!result.name) {
      const title = document.title;
      // Strip common suffixes like " - Site Name", " :: Site", " | Torrents"
      const cleaned = title.replace(/\s*[-–|:·]\s*[^-–|:·]*$/, '').trim();
      if (cleaned.length > 3 && cleaned.length < 200) {
        result.name = cleaned;
      }
    }

    // Build magnet URI if we don't have one
    if (!result.magnetUri && result.hash) {
      result.magnetUri = buildMagnet(result.hash, result.name);
    }

    return result;
  }


  // ── Public API ─────────────────────────────────────────────────────────

  return {
    detect,
    normaliseHash,
    hashFromMagnet,
    nameFromMagnet,
    buildMagnet,
    getTorrentConfidence,
    base32ToHex
  };

})();

// Make available to content script
if (typeof window !== 'undefined') {
  window.MagnetarDetector = MagnetarDetector;
}
