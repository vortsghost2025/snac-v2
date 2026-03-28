/**
 * ColdArchive - cold storage for historical CAPs not active in RAM.
 * Stores compressed JSON files per CAP or per bundling cycle.
 */

const fs = require('fs').promises;
const path = require('path');
const zlib = require('zlib');

class ColdArchive {
    constructor(options = {}) {
        this.location = options.location || './we/pcm/storage/cold';
    }

    async init() {
        await fs.mkdir(this.location, { recursive: true });
    }

    async put(cap) {
        const key = `${cap.id}.json.gz`;
        const payload = JSON.stringify(cap);
        const compressed = zlib.gzipSync(payload);
        const target = path.join(this.location, key);
        await fs.writeFile(target, compressed);
        return { id: cap.id, path: target };
    }

    async get(capId) {
        try {
            const target = path.join(this.location, `${capId}.json.gz`);
            const buf = await fs.readFile(target);
            const decompressed = zlib.gunzipSync(buf).toString('utf8');
            return JSON.parse(decompressed);
        } catch (error) {
            if (error.code === 'ENOENT') return null;
            throw error;
        }
    }

    async exists(capId) {
        try {
            const target = path.join(this.location, `${capId}.json.gz`);
            await fs.access(target);
            return true;
        } catch {
            return false;
        }
    }

    async list(limit = 100) {
        const files = await fs.readdir(this.location);
        return files.filter(f => f.endsWith('.json.gz')).slice(0, limit);
    }

    async delete(capId) {
        const target = path.join(this.location, `${capId}.json.gz`);
        try {
            await fs.unlink(target);
            return true;
        } catch (error) {
            if (error.code === 'ENOENT') return false;
            throw error;
        }
    }
}

module.exports = ColdArchive;
