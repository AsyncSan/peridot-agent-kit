interface Entry<T> {
  data: T
  expiresAt: number
  inflight?: Promise<T>
}

/**
 * Simple in-memory TTL cache with request coalescing.
 * If a key is being fetched, concurrent callers wait for the same promise
 * rather than each firing a separate DB query (thundering herd prevention).
 */
export class Cache<T> {
  private store = new Map<string, Entry<T>>()

  constructor(private ttlMs: number) {}

  get(key: string): T | undefined {
    const entry = this.store.get(key)
    if (!entry) return undefined
    if (entry.inflight) return undefined  // never evict in-flight entries
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key)
      return undefined
    }
    return entry.data
  }

  set(key: string, data: T): void {
    this.store.set(key, { data, expiresAt: Date.now() + this.ttlMs })
  }

  /**
   * Get from cache, or call `fetcher` if stale.
   * Concurrent calls with the same key share one inflight promise.
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
        this.store.delete(key)
        throw err
      })

    this.store.set(key, { data: undefined as unknown as T, expiresAt: 0, inflight: promise })
    return promise
  }
}
