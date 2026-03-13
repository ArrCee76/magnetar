/**
 * Magnetar — Category Detection
 * 
 * Auto-detects content category from page context for RDT Client routing.
 */

const MagnetarCategories = (() => {

  const patterns = {
    audiobooks: {
      url: /audiobookbay|audiobook|librivox/i,
      text: /\b(?:audiobook|narrat(?:ed|or)|unabridged|abridged|read\s+by|spoken\s+word|hours?\s+\d+\s*m|listening\s+length)\b/i,
      weight: 3
    },
    music: {
      url: /rutracker.*music|music(?:brainz)?|discogs/i,
      text: /\b(?:flac|mp3|320\s*kbps|album|discography|vinyl|lossless|cbr|vbr|v0|bitrate)\b/i,
      weight: 2
    },
    video: {
      url: /yts|rarbg|eztv/i,
      text: /\b(?:x264|x265|hevc|bluray|bdrip|webrip|hdtv|1080p|720p|2160p|4k|uhd|remux|dvdrip|subtitle|srt)\b/i,
      weight: 2
    },
    ebooks: {
      url: /libgen|z-library/i,
      text: /\b(?:epub|mobi|pdf|ebook|e-book|kindle|isbn|pages?\s*:\s*\d+)\b/i,
      weight: 2
    },
    software: {
      url: /nsaneforums|softarchive|haxnode/i,
      text: /\b(?:crack(?:ed)?|keygen|patch(?:ed)?|serial|portable|x86|x64|installer|setup\.exe|\.iso|activation|registry|incl\.\s*crack|incl\.\s*patch|pre-?activated|regged|license\s*key|winrar|winzip|adobe|photoshop|office\s*\d{4}|windows\s*\d{1,2}|antivirus|software|application|program|utility)\b/i,
      weight: 3
    },
    games: {
      url: /fitgirl|dodi/i,
      text: /\b(?:repack|fitgirl|dodi|gog|steam(?:rip)?|crack(?:ed)?.*game|game.*crack|trainer|dlc)\b/i,
      weight: 2
    }
  };

  /**
   * Detect the most likely category from page content
   * Returns: string category name or 'general'
   */
  function detect() {
    const url = window.location.href;
    const bodyText = document.body?.textContent || '';
    const title = document.title || '';
    const combined = title + ' ' + bodyText.substring(0, 5000); // Only check first 5k chars for perf

    const scores = {};

    for (const [category, config] of Object.entries(patterns)) {
      let score = 0;

      // URL match is a strong signal
      if (config.url.test(url)) {
        score += config.weight * 2;
      }

      // Text matches
      const matches = combined.match(new RegExp(config.text.source, 'gi'));
      if (matches) {
        score += Math.min(matches.length, 5) * config.weight;
      }

      if (score > 0) {
        scores[category] = score;
      }
    }

    // Return highest scoring category
    let best = 'general';
    let bestScore = 0;

    for (const [category, score] of Object.entries(scores)) {
      if (score > bestScore) {
        best = category;
        bestScore = score;
      }
    }

    return best;
  }

  return { detect, patterns };

})();

if (typeof window !== 'undefined') {
  window.MagnetarCategories = MagnetarCategories;
}
