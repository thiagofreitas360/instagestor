const Helpers = (() => {
  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '~MB';
    const mb = bytes / (1024 * 1024);
    return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
  }

  function sanitizeFilename(name) {
    return name.replace(/[^a-z0-9_\-\.]/gi, '_').replace(/_+/g, '_').slice(0, 80);
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function extractUsername(url) {
    try {
      const path = new URL(url).pathname;
      const parts = path.split('/').filter(Boolean);
      if (!parts.length) return null;
      const reserved = ['p', 'reel', 'reels', 'stories', 'explore', 'accounts', 'direct', 'tv', 'login', 'about'];
      return reserved.includes(parts[0]) ? null : parts[0];
    } catch { return null; }
  }

  function isProfilePage(url) {
    if (!url || !url.includes('instagram.com')) return false;
    try {
      const path = new URL(url).pathname;
      const parts = path.split('/').filter(Boolean);
      if (!parts.length) return false;
      const reserved = ['p', 'reel', 'stories', 'explore', 'accounts', 'direct', 'tv', 'login', 'about'];
      if (reserved.includes(parts[0])) return false;
      // Accept: /username/  or  /username/reels/  or  /username/videos/  or  /username/tagged/
      const profileSubs = ['reels', 'videos', 'tagged', 'saved', 'igtv'];
      if (parts.length === 1) return true;
      if (parts.length === 2 && profileSubs.includes(parts[1])) return true;
      return false;
    } catch { return false; }
  }

  function generateId() {
    return Math.random().toString(36).slice(2, 9);
  }

  function chunkArray(arr, size) {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
    return chunks;
  }

  return { formatBytes, sanitizeFilename, sleep, extractUsername, isProfilePage, generateId, chunkArray };
})();
