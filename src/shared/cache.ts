interface Entry<T> {
  data: T
  expiresAt: number
  inflight?: Promise<T>
}

/**
 * In-memory TTL cache with thundering herd protection.
 *
 * Concurrent callers for the same key share one in-flight promise rather than
 * each triggering a separate upstream request. On fetch error the entry is
 * removed so the next caller can retry (unlike a naïve promise-coalescing
 * cache that would permanently serve the rejection).
 */
export class Cache<T> {
  private store = new Map<string, Entry<T>>()

  constructor(private ttlMs: number) {}

  get(key: string): T | undefined {
    const entry = this.store.get(key)
    if (!entry) return undefined
    // Never evict an entry that has an active in-flight promise — getOrFetch
    // still needs to find it. We just don't return stale data for it.
    if (entry.inflight) return undefined
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key)
      return undefined
    }
    return entry.data
  }

  set(key: string, data: T): void {
    this.store.set(key, { data, expiresAt: Date.now() + this.ttlMs })
  }

  clear(): void {
    this.store.clear()
  }

  /**
   * Return the cached value if fresh, otherwise call `fetcher` once — even
   * when multiple callers arrive simultaneously while the fetch is in-flight.
   * If the fetch throws, the entry is deleted so subsequent callers retry.
   */
  async getOrFetch(key: string, fetcher: () => Promise<T>): Promise<T> {
    const cached = this.get(key)
    if (cached !== undefined) return cached

    const existing = this.store.get(key)
    if (existing?.inflight) return existing.inflight

    const promise = fetcher()
      .then((data) => {
        this.set(key, data)
        const entry = this.store.get(key)
        if (entry) delete entry.inflight
        return data
      })
      .catch((err: unknown) => {
        // Remove the entry so the next caller triggers a fresh attempt.
        this.store.delete(key)
        throw err
      })

    this.store.set(key, { data: undefined as unknown as T, expiresAt: 0, inflight: promise })
    return promise
  }
}
