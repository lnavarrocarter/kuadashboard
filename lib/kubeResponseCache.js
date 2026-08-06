'use strict';

class KubeResponseCache {
  constructor({ freshMs = 15000, staleMs = 120000 } = {}) {
    if (freshMs < 0 || staleMs < freshMs) throw new Error('Invalid cache TTL configuration');
    this.freshMs = freshMs;
    this.staleMs = staleMs;
    this.entries = new Map();
  }

  read(key, now = Date.now()) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    const age = now - entry.storedAt;
    if (age > this.staleMs) {
      this.entries.delete(key);
      return null;
    }
    return { value: entry.value, state: age <= this.freshMs ? 'fresh' : 'stale' };
  }

  write(key, value, now = Date.now()) {
    this.entries.set(key, { value, storedAt: now });
  }

  clear() {
    this.entries.clear();
  }
}

module.exports = { KubeResponseCache };