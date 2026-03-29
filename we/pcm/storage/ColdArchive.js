  async remove(capId) {
        const target = path.join(this.location, `${capId}.json.gz`);
        try {
            await fs.unlink(target);
            return true;
        } catch (error) {
            if (error.code === 'ENOENT') return false;
            throw error;
        }
    }
    
    async healthCheck() {
        try {
            // Check if the location exists and is writable
            await fs.access(this.location, fs.constants.F_OK | fs.constants.W_OK);
            
            return {
                healthy: true,
                location: this.location,
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
}

module.exports = ColdArchive;