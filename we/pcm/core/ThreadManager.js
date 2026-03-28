/**
 * ThreadManager - Manages Temporal Reasoning Threads (TRTs)
 * Tracks causal chains of thought across sessions
 */

const crypto = require('crypto');
const CognitiveAnchor = require('./CognitiveAnchor');

class Thread {
    constructor(options = {}) {
        this.id = options.id || `thread_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
        this.name = options.name || 'Unnamed Thread';
        this.description = options.description || '';

        // The reasoning chain
        this.history = options.history || []; // Array of CAP IDs in causal order
        this.head = options.head || null;     // Current frontier CAP ID

        // State
        this.status = options.status || 'active'; // active | paused | completed | archived
        this.priority = options.priority ?? 0.5;  // 0.0 - 1.0

        // Ownership
        this.owner_agent = options.owner_agent || null;
        this.collaborators = options.collaborators || [];

        // Temporal
        this.created_at = options.created_at || Date.now();
        this.last_updated = options.last_updated || Date.now();
        this.last_active = options.last_active || Date.now();

        // Goals / completion criteria
        this.goal = options.goal || null;
        this.completion_criteria = options.completion_criteria || null;
        this.progress = options.progress ?? 0; // 0.0 - 1.0

        // Branching
        this.parent_thread = options.parent_thread || null;
        this.child_threads = options.child_threads || [];

        // Tags for retrieval
        this.tags = options.tags || [];
    }

    // Add a CAP to this thread's history
    extend(capId, options = {}) {
        this.history.push({
            cap_id: capId,
            added_at: Date.now(),
            note: options.note || null
        });
        this.head = capId;
        this.last_updated = Date.now();
        this.last_active = Date.now();

        if (options.progress) {
            this.progress = Math.min(1.0, this.progress + options.progress);
        }

        return this;
    }

    // Branch into a new thread (fork for parallel exploration)
    branch(options = {}) {
        const child = new Thread({
            name: options.name || `${this.name} (branch)`,
            description: options.description || `Branched from ${this.id}`,
            history: [...this.history], // Copy history up to branch point
            head: this.head,
            parent_thread: this.id,
            tags: [...this.tags, ...(options.tags || [])],
            goal: options.goal || this.goal
        });

        this.child_threads.push(child.id);
        return child;
    }

    // Merge another thread back into this one
    merge(otherThread, mergeCap) {
        // mergeCap is the CAP that synthesizes both threads
        this.history.push({
            cap_id: mergeCap.id,
            added_at: Date.now(),
            note: `Merged from thread ${otherThread.id}`,
            merged_history: otherThread.history
        });
        this.head = mergeCap.id;
        this.last_updated = Date.now();

        // Archive the merged thread
        otherThread.status = 'archived';
        otherThread.meta = otherThread.meta || {};
        otherThread.meta.merged_into = this.id;

        return this;
    }

    complete(finalCap) {
        if (finalCap) {
            this.extend(finalCap.id || finalCap, { note: 'Thread completed' });
        }
        this.status = 'completed';
        this.progress = 1.0;
        this.last_updated = Date.now();
        return this;
    }

    pause(reason) {
        this.status = 'paused';
        this.meta = this.meta || {};
        this.meta.pause_reason = reason;
        this.meta.paused_at = Date.now();
        return this;
    }

    resume() {
        this.status = 'active';
        this.last_active = Date.now();
        return this;
    }

    toJSON() {
        return {
            id: this.id,
            name: this.name,
            description: this.description,
            history: this.history,
            head: this.head,
            status: this.status,
            priority: this.priority,
            owner_agent: this.owner_agent,
            collaborators: this.collaborators,
            created_at: this.created_at,
            last_updated: this.last_updated,
            last_active: this.last_active,
            goal: this.goal,
            completion_criteria: this.completion_criteria,
            progress: this.progress,
            parent_thread: this.parent_thread,
            child_threads: this.child_threads,
            tags: this.tags
        };
    }

    static fromJSON(data) {
        return new Thread(data);
    }
}


class ThreadManager {
    constructor(options = {}) {
        this.threads = new Map(); // id -> Thread
        this.activeThreads = new Set(); // Quick access to active thread IDs
        this.storage = options.storage || null; // Reference to storage layer
    }

    // === CRUD ===

    create(options = {}) {
        const thread = new Thread(options);
        this.threads.set(thread.id, thread);

        if (thread.status === 'active') {
            this.activeThreads.add(thread.id);
        }

        return thread;
    }

    get(threadId) {
        return this.threads.get(threadId);
    }

    getActive() {
        return Array.from(this.activeThreads)
            .map(id => this.threads.get(id))
            .filter(Boolean)
            .sort((a, b) => b.priority - a.priority);
    }

    update(threadId, updates) {
        const thread = this.threads.get(threadId);
        if (!thread) return null;

        Object.assign(thread, updates);
        thread.last_updated = Date.now();

        // Sync active set
        if (thread.status === 'active') {
            this.activeThreads.add(threadId);
        } else {
            this.activeThreads.delete(threadId);
        }

        return thread;
    }

    delete(threadId) {
        this.activeThreads.delete(threadId);
        return this.threads.delete(threadId);
    }

    // === INTEGRATION ===

    // When a new CAP is created, figure out which thread(s) it belongs to
    async integrate(cap, options = {}) {
        const relevantThreads = await this.findRelevant(cap, options);

        if (relevantThreads.length === 0 && options.createIfNone) {
            // This CAP starts a new thread
            const thread = this.create({
                name: options.threadName || `Thread from ${cap.type}`,
                tags: cap.tags,
                goal: options.goal
            });
            thread.extend(cap.id);
            return [thread];
        }

        // Extend relevant threads
        for (const thread of relevantThreads) {
            thread.extend(cap.id, {
                note: options.note,
                progress: options.progress
            });
        }

        return relevantThreads;
    }

    // Find threads relevant to a CAP or query
    async findRelevant(capOrQuery, options = {}) {
        const limit = options.limit || 5;
        const results = [];

        for (const thread of this.threads.values()) {
            if (thread.status === 'archived' && !options.includeArchived) continue;

            let relevance = 0;

            // Tag overlap
            if (capOrQuery.tags) {
                const overlap = capOrQuery.tags.filter(t => thread.tags.includes(t)).length;
                relevance += overlap * 0.3;
            }

            // Same thread ID in meta
            if (capOrQuery.meta?.thread_id === thread.id) {
                relevance += 1.0;
            }

            // Recency of thread activity
            const age_hours = (Date.now() - thread.last_active) / (1000 * 60 * 60);
            relevance += Math.exp(-age_hours / 48) * 0.2;

            // Active threads get boost
            if (thread.status === 'active') {
                relevance += 0.2;
            }

            // Priority factor
            relevance *= (0.5 + thread.priority * 0.5);

            if (relevance > 0.1) {
                results.push({ thread, relevance });
            }
        }

        return results
            .sort((a, b) => b.relevance - a.relevance)
            .slice(0, limit)
            .map(r => r.thread);
    }

    // Get the reasoning chain for a thread
    getReasoningChain(threadId) {
        const thread = this.threads.get(threadId);
        if (!thread) return null;

        return {
            thread_id: thread.id,
            name: thread.name,
            goal: thread.goal,
            status: thread.status,
            progress: thread.progress,
            chain: thread.history.map(h => ({
                cap_id: h.cap_id,
                added_at: h.added_at,
                note: h.note
            })),
            head: thread.head,
            branches: thread.child_threads
        };
    }

    // === PERSISTENCE ===

    async serialize() {
        const data = {
            threads: Array.from(this.threads.values()).map(t => t.toJSON()),
            activeThreads: Array.from(this.activeThreads)
        };
        return data;
    }

    async deserialize(data) {
        this.threads.clear();
        this.activeThreads.clear();

        if (data.threads) {
            for (const threadData of data.threads) {
                const thread = Thread.fromJSON(threadData);
                this.threads.set(thread.id, thread);
            }
        }

        if (data.activeThreads) {
            for (const id of data.activeThreads) {
                if (this.threads.has(id)) {
                    this.activeThreads.add(id);
                }
            }
        }

        return this;
    }

    async load() {
        if (!this.storage) return this;

        const data = null; // Skip loading for now
        if (data) {
            await this.deserialize(data);
        }
        return this;
    }

    // === MAINTENANCE ===

    // Clean up old completed/archived threads
    prune(options = {}) {
        const maxAge = options.maxAge || 30 * 24 * 60 * 60 * 1000; // 30 days
        const now = Date.now();
        const pruned = [];

        for (const [id, thread] of this.threads) {
            if (thread.status === 'archived' || thread.status === 'completed') {
                if (now - thread.last_updated > maxAge) {
                    pruned.push(id);
                    this.threads.delete(id);
                    this.activeThreads.delete(id);
                }
            }
        }

        return pruned;
    }

    getStats() {
        let active = 0, paused = 0, completed = 0, archived = 0;
        let totalProgress = 0;

        for (const thread of this.threads.values()) {
            switch (thread.status) {
                case 'active': active++; break;
                case 'paused': paused++; break;
                case 'completed': completed++; break;
                case 'archived': archived++; break;
            }
            totalProgress += thread.progress;
        }

        return {
            total: this.threads.size,
            active,
            paused,
            completed,
            archived,
            avgProgress: this.threads.size > 0 ? totalProgress / this.threads.size : 0
        };
    }
}

module.exports = { Thread, ThreadManager };
