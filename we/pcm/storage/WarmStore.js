/**
 * WarmStore - SQLite layer for warm memory with WAL.
 * This store is the mid-tier for semantic retrieval and similarity joins.
 */

const fs = require('fs').promises;
const path = require('path');
const BetterSqlite3 = require('better-sqlite3');

class WarmStore {
    constructor(options = {}) {
        this.location = options.location || './we/pcm/storage/warm.db';
        this.db = null;
    }

    async init() {
        await fs.mkdir(path.dirname(this.location), { recursive: true });
        this.db = new BetterSqlite3(this.location, { fileMustExist: false });

        this.db.pragma('journal_mode = WAL');
        this.db.pragma('synchronous = NORMAL');

        this.db.prepare(`
      CREATE TABLE IF NOT EXISTS cap (
        id TEXT PRIMARY KEY,
        body TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_activated INTEGER NOT NULL,
        confidence REAL NOT NULL,
        thermal_state TEXT NOT NULL
      )
    `).run();

        this.db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_cap_thermal ON cap (thermal_state)
    `).run();

        this.db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_cap_last_active ON cap (last_activated)
    `).run();

        this.db.prepare(`
      CREATE TABLE IF NOT EXISTS tag (
        cap_id TEXT,
        tag TEXT,
        PRIMARY KEY (cap_id, tag),
        FOREIGN KEY (cap_id) REFERENCES cap(id) ON DELETE CASCADE
      )
    `).run();

        this.insertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO cap (id, body, created_at, last_activated, confidence, thermal_state)
      VALUES (@id, @body, @created_at, @last_activated, @confidence, @thermal_state)
    `);

        this.tagInsertStmt = this.db.prepare(`
      INSERT OR IGNORE INTO tag (cap_id, tag) VALUES (?, ?)
    `);
    }

    // Overloaded set method to support both (cap) and (key, value, metadata) signatures
    set(arg1, arg2, arg3) {
        let cap;
        
        // Check if first argument is a capsule object
        if (arg2 === undefined && typeof arg1 === 'object' && arg1.id) {
            cap = arg1;
        } else {
            // Construct capsule from (key, value, metadata) parameters
            const key = arg1;
            const value = arg2;
            const metadata = arg3 || {};
            const now = Date.now();
            
            cap = {
                id: key,
                value: value,
                created_at: metadata.created_at || now,
                last_activated: metadata.last_activated || now,
                confidence: metadata.confidence || 0.8,
                thermal_state: metadata.thermal_state || 'warm',
                tags: metadata.tags || []
            };
        }
        
        const body = JSON.stringify(cap.value || cap.body || cap);
        this.insertStmt.run({
            id: cap.id,
            body,
            created_at: cap.created_at,
            last_activated: cap.last_activated,
            confidence: cap.confidence,
            thermal_state: cap.thermal_state
        });

        if (Array.isArray(cap.tags)) {
            const tx = this.db.transaction(tags => {
                for (const tag of tags) {
                    this.tagInsertStmt.run(cap.id, tag);
                }
            });
            tx(cap.tags);
        }
        return cap;
    }

    get(id) {
        const row = this.db.prepare('SELECT body FROM cap WHERE id = ?').get(id);
        if (!row) return null;
        return JSON.parse(row.body);
    }

    delete(id) {
        const info = this.db.prepare('DELETE FROM cap WHERE id = ?').run(id);
        return info.changes > 0;
    }

    findByTag(tag, limit = 32) {
        const rows = this.db.prepare(`
      SELECT cap.body
      FROM cap
      JOIN tag ON cap.id = tag.cap_id
      WHERE tag.tag = ?
      ORDER BY cap.last_activated DESC
      LIMIT ?
    `).all(tag, limit);
        return rows.map(r => JSON.parse(r.body));
    }

    findByThermalState(state, limit = 100) {
        const rows = this.db.prepare(`
      SELECT body
      FROM cap
      WHERE thermal_state = ?
      ORDER BY last_activated DESC
      LIMIT ?
    `).all(state, limit);
        return rows.map(r => JSON.parse(r.body));
    }

    pruneCold(maxAgeMs) {
        const cutoff = Date.now() - maxAgeMs;
        const info = this.db.prepare(`
      DELETE FROM cap
      WHERE thermal_state = 'cold' AND last_activated < ?
    `).run(cutoff);
        return info.changes;
    }

    async healthCheck() {
        try {
            // Check if the database connection is active
            const result = this.db.prepare('SELECT 1').get();
            
            return {
                healthy: true,
                dbLocation: this.location,
                connected: !!this.db,
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

    close() {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }
    
    async expireOldEntries(maxAgeMs = 86400000) {  // Default to 24 hours
        const cutoff = Date.now() - maxAgeMs;
        const info = this.db.prepare(`
      DELETE FROM cap
      WHERE last_activated < ? AND thermal_state = 'warm'
    `).run(cutoff);
        return info.changes;
    }
}

module.exports = WarmStore;
