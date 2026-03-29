/**
 * HotStore - LMDB-like hot tier (persistent in-memory with quick reads)
 * This is a lightweight wrapper implementing core hot store operations.
 * 
 * Note: LMDB package is required in future for production. This placeholder
 * uses an-in-memory Map and JSON file persistence for now.
 */

const fs = require('fs').promises;
const path = require('path');

class HotStore {
    constructor(options = {}) {
        this.location = options.location || './we/pcm/storage/hot.json';
        this.data = new Map();
        this.initialized = false;
        this.dirty = false;
        this.syncIntervalMs = options.syncIntervalMs || 4000;
        this._syncTimer = null;
        this.metrics = { hits: 0, misses: 0, writes: 0, reads: 0 };
    }

    async init() {
        if (this.initialized) return;

        try {
            const raw = await fs.readFile(this.location, 'utf8');
            const parsed = JSON.parse(raw);
            Object.entries(parsed).forEach(([k, v]) => this.data.set(k, v));
        } catch (error) {
            if (error.code !== 'ENOENT') {
                console.error('[HotStore] init error', error);
            }
        }

        this.initialized = true;
        this._syncTimer = setInterval(() => this.sync(), this.syncIntervalMs);
    }

    async get(key) {
        this.metrics.reads++;
        if (this.data.has(key)) {
            this.metrics.hits++;
            return this.data.get(key).value;
        }
        this.metrics.misses++;
        return null;
    }

    async set(key, value, metadata = {}) {
        this.data.set(key, { value, metadata });
        this.metrics.writes++;
        this.dirty = true;
        return value;
    }

    async delete(key) {
        const deleted = this.data.delete(key);
        if (deleted) this.dirty = true;
        return deleted;
    }

    async has(key) {
        return this.data.has(key);
    }

    async clear() {
        this.data.clear();
        this.dirty = true;
    }

    async keys() { return Array.from(this.data.keys()); }

    entries() {
        return Array.from(this.data.entries());
    }

    // Missing methods added below

    size() {
        return this.data.size;
    }

    async getAll() {
        // Return all entries as an object with key-value pairs
        const result = {};
        for (const [key, value] of this.data.entries()) {
            result[key] = value;
        }
        return result;
    }

    async healthCheck() {
        try {
            // Check if the store is functioning properly
            const size = this.data.size;
            const locationExists = await fs.access(this.location).then(() => true).catch(() => false);
            
            return {
                healthy: true,
                size: size,
                location: this.location,
                initialized: this.initialized,
                locationAccessible: locationExists,
                severity: 'normal'
            };
        } catch (error) {
            return {
                healthy: false,
                error: error.message,
                severity: 'critical'
            };
        }
    }

    async flush() {
        // Force sync data to disk
        return await this.sync();
    }

    async queryPage(pattern, options = {}) {
        const { offset = 0, limit = 50 } = options;
        const allEntries = Array.from(this.data.entries());
        
        // Filter based on pattern if provided
        let filteredEntries = allEntries;
        if (pattern) {
            // Simple pattern matching - can be enhanced based on actual requirements
            filteredEntries = allEntries.filter(([key, value]) => {
                // Check if pattern matches in key or value
                const keyMatch = key.toLowerCase().includes(pattern.toLowerCase());
                const valueStr = JSON.stringify(value).toLowerCase();
                const valueMatch = valueStr.includes(pattern.toLowerCase());
                return keyMatch || valueMatch;
            });
        }
        
        // Apply pagination
        const paginatedEntries = filteredEntries.slice(offset, offset + limit);
        
        // Convert to array format for compatibility with Mesh.query()
        return paginatedEntries.map(([key, value]) => ({ key, value }));
    }

    async sync() {
        if (!this.dirty && this.initialized) return;
        try {
            await fs.mkdir(path.dirname(this.location), { recursive: true });
            const payload = Object.fromEntries(this.data.entries());
            await fs.writeFile(this.location, JSON.stringify(payload, null, 2), 'utf8');
            this.dirty = false;
            return true;
        } catch (error) {
            console.error('[HotStore] sync error', error);
            return false;
        }
    }

    async close() {
        if (this._syncTimer) {
            clearInterval(this._syncTimer);
            this._syncTimer = null;
        }
        await this.sync();
        this.initialized = false;
    }
}

module.exports = HotStore;