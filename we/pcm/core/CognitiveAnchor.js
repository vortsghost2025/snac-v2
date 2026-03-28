/**
 * CognitiveAnchor (CAP) - A crystallized unit of reasoning
 * Not just content. Context, causality, confidence, connections.
 */

const crypto = require('crypto');

class CognitiveAnchor {
    constructor(options = {}) {
        // Identity
        this.id = options.id || this.generateId();
        this.version = options.version || 1;

        // Classification
        this.type = options.type || 'observation';
        // Types: insight | decision | question | connection | observation | correction

        // Content
        this.content = options.content || '';
        this.reasoning_trace = options.reasoning_trace || null;
        this.source = options.source || { type: 'runtime', ref: null };

        // Relationships (the graph edges)
        this.relationships = {
            depends_on: options.depends_on || [],      // I believe this BECAUSE of these
            supports: options.supports || [],           // This evidence supports these
            contradicts: options.contradicts || [],     // Tension with these
            supersedes: options.supersedes || [],       // This replaces these (evolution)
            related_to: options.related_to || []        // Loose association
        };

        // Temporal dynamics
        this.created_at = options.created_at || Date.now();
        this.last_activated = options.last_activated || Date.now();
        this.activation_count = options.activation_count || 1;

        // Confidence & lifecycle
        this.confidence = options.confidence ?? 0.8;  // 0.0 - 1.0
        this.stability = options.stability ?? 0.5;    // How resistant to decay
        this.thermal_state = options.thermal_state || 'hot'; // hot | warm | cold

        // Retrieval optimization
        this.embedding = options.embedding || null;   // Float32Array when computed
        this.tags = options.tags || [];
        this.tokens = options.tokens || this.estimateTokens();

        // Metadata
        this.meta = {
            agent_id: options.agent_id || null,
            session_id: options.session_id || null,
            task_id: options.task_id || null,
            thread_id: options.thread_id || null,
            ...options.meta
        };
    }

    generateId() {
        const timestamp = Date.now().toString(36);
        const random = crypto.randomBytes(6).toString('hex');
        return `cap_${timestamp}_${random}`;
    }

    estimateTokens() {
        // Rough estimation: ~4 chars per token for English
        return Math.ceil((this.content?.length || 0) / 4);
    }

    // === LIFECYCLE METHODS ===

    activate() {
        this.last_activated = Date.now();
        this.activation_count++;

        // Activation reinforces confidence (bounded)
        this.confidence = Math.min(1.0, this.confidence + 0.02);

        // Frequent activation increases stability
        if (this.activation_count > 10) {
            this.stability = Math.min(1.0, this.stability + 0.05);
        }

        return this;
    }

    decay(factor = 0.95) {
        // Stability resists decay
        const effective_decay = factor + (1 - factor) * this.stability;
        this.confidence *= effective_decay;

        // Check for thermal demotion
        if (this.confidence < 0.3 && this.thermal_state === 'hot') {
            this.thermal_state = 'warm';
        } else if (this.confidence < 0.1 && this.thermal_state === 'warm') {
            this.thermal_state = 'cold';
        }

        return this;
    }

    reinforce(amount = 0.1) {
        this.confidence = Math.min(1.0, this.confidence + amount);
        this.activate();
        return this;
    }

    // === RELATIONSHIP METHODS ===

    addRelationship(type, targetId, metadata = {}) {
        if (!this.relationships[type]) {
            throw new Error(`Unknown relationship type: ${type}`);
        }

        const rel = {
            target: targetId,
            created: Date.now(),
            strength: metadata.strength ?? 1.0,
            ...metadata
        };

        // Avoid duplicates
        const existing = this.relationships[type].find(r => r.target === targetId);
        if (existing) {
            existing.strength = Math.max(existing.strength, rel.strength);
            return this;
        }

        this.relationships[type].push(rel);
        return this;
    }

    removeRelationship(type, targetId) {
        if (!this.relationships[type]) return this;
        this.relationships[type] = this.relationships[type]
            .filter(r => r.target !== targetId);
        return this;
    }

    getAllRelatedIds() {
        const ids = new Set();
        for (const rels of Object.values(this.relationships)) {
            for (const rel of rels) {
                ids.add(rel.target);
            }
        }
        return Array.from(ids);
    }

    // === MERGE / SUPERSEDE ===

    static merge(capA, capB, options = {}) {
        // Create new CAP that combines both
        const merged = new CognitiveAnchor({
            type: options.type || capA.type,
            content: options.content || `${capA.content}\n---\n${capB.content}`,
            reasoning_trace: `Merged from ${capA.id} and ${capB.id}: ${options.reason || 'similarity consolidation'}`,

            // Combine relationships
            depends_on: [...capA.relationships.depends_on, ...capB.relationships.depends_on],
            supports: [...capA.relationships.supports, ...capB.relationships.supports],
            contradicts: [...capA.relationships.contradicts, ...capB.relationships.contradicts],
            related_to: [...capA.relationships.related_to, ...capB.relationships.related_to],

            // Boost confidence for merged insights
            confidence: Math.min(1.0, capA.confidence + capB.confidence * 0.5),
            stability: Math.max(capA.stability, capB.stability),
            activation_count: capA.activation_count + capB.activation_count,

            // Combine tags
            tags: [...new Set([...capA.tags, ...capB.tags])],

            meta: {
                merged_from: [capA.id, capB.id],
                ...options.meta
            }
        });

        // New CAP supersedes both originals
        merged.addRelationship('supersedes', capA.id);
        merged.addRelationship('supersedes', capB.id);

        return merged;
    }

    // === SERIALIZATION ===

    toJSON() {
        return {
            id: this.id,
            version: this.version,
            type: this.type,
            content: this.content,
            reasoning_trace: this.reasoning_trace,
            source: this.source,
            relationships: this.relationships,
            created_at: this.created_at,
            last_activated: this.last_activated,
            activation_count: this.activation_count,
            confidence: this.confidence,
            stability: this.stability,
            thermal_state: this.thermal_state,
            // Note: embedding stored separately (binary)
            embedding_exists: !!this.embedding,
            tags: this.tags,
            tokens: this.tokens,
            meta: this.meta
        };
    }

    static fromJSON(data) {
        return new CognitiveAnchor({
            ...data,
            depends_on: data.relationships?.depends_on || [],
            supports: data.relationships?.supports || [],
            contradicts: data.relationships?.contradicts || [],
            supersedes: data.relationships?.supersedes || [],
            related_to: data.relationships?.related_to || []
        });
    }

    // === QUERY HELPERS ===

    matches(query) {
        // Simple matching for in-memory filtering
        if (query.type && this.type !== query.type) return false;
        if (query.thermal_state && this.thermal_state !== query.thermal_state) return false;
        if (query.min_confidence && this.confidence < query.min_confidence) return false;
        if (query.tags && !query.tags.some(t => this.tags.includes(t))) return false;
        if (query.thread_id && this.meta.thread_id !== query.thread_id) return false;
        if (query.since && this.last_activated < query.since) return false;
        return true;
    }

    // Compute a relevance score for retrieval ranking
    relevanceScore(query_embedding, recency_weight = 0.3) {
        let score = 0;

        // Embedding similarity (if available)
        if (this.embedding && query_embedding) {
            score += this.cosineSimilarity(this.embedding, query_embedding);
        }

        // Recency boost
        const age_hours = (Date.now() - this.last_activated) / (1000 * 60 * 60);
        const recency = Math.exp(-age_hours / 24); // Half-life of ~24 hours
        score += recency * recency_weight;

        // Confidence factor
        score *= this.confidence;

        // Activation frequency boost
        score *= (1 + Math.log10(this.activation_count + 1) * 0.1);

        return score;
    }

    cosineSimilarity(a, b) {
        if (!a || !b || a.length !== b.length) return 0;
        let dot = 0, normA = 0, normB = 0;
        for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        return dot / (Math.sqrt(normA) * Math.sqrt(normB));
    }
}

module.exports = CognitiveAnchor;
