/**
 * Migrator - Handles tier migration logic between hot, warm, and cold stores.
 */

class Migrator {
    constructor(options = {}) {
        this.hot = options.hot;
        this.warm = options.warm;
        this.cold = options.cold;

        if (!this.hot || !this.warm || !this.cold) {
            throw new Error('Migrator requires hot, warm, and cold store instances');
        }

        this.policies = {
            hotToWarmConfidence: options.hotToWarmConfidence || 0.4,
            warmToColdConfidence: options.warmToColdConfidence || 0.15,
            hotMaxSize: options.hotMaxSize || 1000,
            warmMaxSize: options.warmMaxSize || 5000,
            ...options.policies
        };
    }

    // Promote from hot to warm based on thermal state and size.
    async migrateHotToWarm() {
        const hotEntries = this.hot.entries();
        const selected = []; // ids to migrate

        for (const [id, cap] of hotEntries) {
            if (cap.thermal_state === 'warm' || cap.thermal_state === 'cold') {
                selected.push(cap);
            }
        }

        let migrated = 0;
        for (const cap of selected) {
            await this.warm.set(cap);
            await this.hot.delete(cap.id);
            migrated++;
        }

        return migrated;
    }

    // Promote from warm to cold based on thermal state and access patterns.
    async migrateWarmToCold() {
        const rows = this.warm.findByThermalState('cold', 256);
        let migrated = 0;

        for (const cap of rows) {
            await this.cold.put(cap);
            await this.warm.delete(cap.id);
            migrated++;
        }

        return migrated;
    }

    async enforcePolicies() {
        const hotCount = this.hot.entries().length;
        if (hotCount > this.policies.hotMaxSize) {
            await this.migrateHotToWarm();
        }

        const warmSubjects = this.warm.findByThermalState('cold', 1000);
        if (warmSubjects.length > 0) {
            await this.migrateWarmToCold();
        }
    }
}

module.exports = Migrator;
