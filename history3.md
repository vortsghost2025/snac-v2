

# PR #3.5: The Cognitive Leap

What you have is a solid skeleton. What it lacks is *nervous tissue*. The agents don't actually think, the graph doesn't exist, retrieval is blind, and there's no emergent behavior. Let's fix all of that.

## Architecture Delta

```
Before:  Agent → Orchestrator → Consensus (flat, polling, stateless)
After:   Agent ⇄ EventBus ⇄ Stigmergy ⇄ Graph ⇄ SpreadingActivation
         ↕                                         ↕
         CircuitBreaker ← PhaseController → VectorIndex
```

---

## `we/pcm/core/EventBus.js`

```javascript
/**
 * EventBus - Typed, namespaced, async-first event system
 * The nervous system of the mesh. Everything communicates through this.
 * 
 * Channels are hierarchical: 'swarm.agent.task.complete'
 * Subscribing to 'swarm.agent' catches all sub-events.
 * Supports once, async handlers, priority ordering, dead letter tracking.
 */

class EventBus {
  constructor(options = {}) {
    this.handlers = new Map();      // channel → [{handler, priority, id, once}]
    this.history = [];              // Ring buffer of recent events
    this.deadLetters = [];          // Events nobody handled
    this.middlewares = [];          // Transform/filter before dispatch
    
    this.maxHistory = options.maxHistory || 1000;
    this.maxDeadLetters = options.maxDeadLetters || 200;
    this.handlerTimeout = options.handlerTimeout || 10000;
    
    this._idCounter = 0;
    this._paused = false;
    this._queue = [];               // Buffered during pause
    
    // Metrics
    this.metrics = {
      emitted: 0,
      handled: 0,
      dropped: 0,
      errors: 0,
      avgLatency: 0,
      _latencySum: 0
    };
  }

  // === SUBSCRIPTION ===

  on(channel, handler, options = {}) {
    const id = `h_${++this._idCounter}`;
    const entry = {
      id,
      handler,
      channel,
      priority: options.priority || 0,
      once: options.once || false,
      filter: options.filter || null,       // Predicate on event data
      created: Date.now()
    };

    if (!this.handlers.has(channel)) {
      this.handlers.set(channel, []);
    }

    const list = this.handlers.get(channel);
    list.push(entry);
    list.sort((a, b) => b.priority - a.priority);    // Higher priority first

    return id;   // Return for unsubscription
  }

  once(channel, handler, options = {}) {
    return this.on(channel, handler, { ...options, once: true });
  }

  off(handlerId) {
    for (const [channel, list] of this.handlers) {
      const idx = list.findIndex(h => h.id === handlerId);
      if (idx !== -1) {
        list.splice(idx, 1);
        if (list.length === 0) this.handlers.delete(channel);
        return true;
      }
    }
    return false;
  }

  offAll(channel) {
    if (channel) {
      this.handlers.delete(channel);
    } else {
      this.handlers.clear();
    }
  }

  // === EMISSION ===

  async emit(channel, data = {}, options = {}) {
    if (this._paused) {
      this._queue.push({ channel, data, options, bufferedAt: Date.now() });
      return { buffered: true };
    }

    const event = {
      id: `evt_${++this._idCounter}_${Date.now().toString(36)}`,
      channel,
      data,
      timestamp: Date.now(),
      source: options.source || null,
      correlationId: options.correlationId || null
    };

    // Run middleware
    let transformed = event;
    for (const mw of this.middlewares) {
      transformed = await mw(transformed);
      if (!transformed) {
        this.metrics.dropped++;
        return { dropped: true, reason: 'middleware' };
      }
    }

    this.metrics.emitted++;

    // Record history
    this.history.push({
      id: transformed.id,
      channel: transformed.channel,
      timestamp: transformed.timestamp,
      dataSize: JSON.stringify(transformed.data).length
    });
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }

    // Find matching handlers (exact + hierarchical)
    const matching = this._findHandlers(channel);

    if (matching.length === 0) {
      this.deadLetters.push(transformed);
      if (this.deadLetters.length > this.maxDeadLetters) {
        this.deadLetters = this.deadLetters.slice(-this.maxDeadLetters);
      }
      return { delivered: 0, dead: true };
    }

    // Dispatch
    const start = Date.now();
    const results = [];
    const toRemove = [];

    for (const entry of matching) {
      // Apply filter
      if (entry.filter && !entry.filter(transformed.data)) continue;

      try {
        const result = await Promise.race([
          Promise.resolve(entry.handler(transformed)),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Handler timeout')), this.handlerTimeout)
          )
        ]);
        results.push({ handlerId: entry.id, result });
        this.metrics.handled++;
      } catch (err) {
        this.metrics.errors++;
        results.push({ handlerId: entry.id, error: err.message });
      }

      if (entry.once) toRemove.push(entry.id);
    }

    // Clean up once-handlers
    for (const id of toRemove) this.off(id);

    // Latency tracking
    const latency = Date.now() - start;
    this.metrics._latencySum += latency;
    this.metrics.avgLatency = this.metrics._latencySum / this.metrics.emitted;

    return { delivered: results.length, results, latency };
  }

  // Fire-and-forget variant
  fire(channel, data = {}, options = {}) {
    this.emit(channel, data, options).catch(() => {});
  }

  // === REQUEST/REPLY ===

  async request(channel, data = {}, timeout = 5000) {
    const correlationId = `req_${++this._idCounter}_${Date.now().toString(36)}`;
    const replyChannel = `${channel}.__reply.${correlationId}`;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off(handlerId);
        reject(new Error(`Request timeout on ${channel}`));
      }, timeout);

      const handlerId = this.once(replyChannel, (event) => {
        clearTimeout(timer);
        resolve(event.data);
      });

      this.emit(channel, { ...data, __replyTo: replyChannel }, { correlationId });
    });
  }

  reply(event, data) {
    if (event.data?.__replyTo) {
      return this.emit(event.data.__replyTo, data, {
        correlationId: event.correlationId
      });
    }
  }

  // === FLOW CONTROL ===

  pause() {
    this._paused = true;
  }

  async resume() {
    this._paused = false;
    const queued = [...this._queue];
    this._queue = [];
    
    for (const item of queued) {
      await this.emit(item.channel, item.data, item.options);
    }
  }

  // === MIDDLEWARE ===

  use(fn) {
    this.middlewares.push(fn);
  }

  // === INTERNALS ===

  _findHandlers(channel) {
    const matching = [];
    const parts = channel.split('.');

    // Exact match
    if (this.handlers.has(channel)) {
      matching.push(...this.handlers.get(channel));
    }

    // Hierarchical match: 'a.b' catches 'a.b.c.d'
    for (const [pattern, handlers] of this.handlers) {
      if (pattern === channel) continue;
      if (channel.startsWith(pattern + '.')) {
        matching.push(...handlers);
      }
      // Wildcard: 'a.*.c' matches 'a.b.c'
      if (pattern.includes('*')) {
        const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '[^.]+') + '$');
        if (regex.test(channel)) {
          matching.push(...handlers);
        }
      }
    }

    // Deduplicate and sort by priority
    const seen = new Set();
    return matching
      .filter(h => {
        if (seen.has(h.id)) return false;
        seen.add(h.id);
        return true;
      })
      .sort((a, b) => b.priority - a.priority);
  }

  // === DIAGNOSTICS ===

  getMetrics() {
    return {
      ...this.metrics,
      channels: this.handlers.size,
      totalHandlers: Array.from(this.handlers.values()).reduce((s, l) => s + l.length, 0),
      historySize: this.history.length,
      deadLetterCount: this.deadLetters.length,
      queuedWhilePaused: this._queue.length
    };
  }

  getChannelMap() {
    const map = {};
    for (const [channel, handlers] of this.handlers) {
      map[channel] = handlers.length;
    }
    return map;
  }
}

module.exports = EventBus;
```

---

## `we/pcm/core/CognitiveGraph.js`

```javascript
/**
 * CognitiveGraph - Real graph structure for CAP relationships
 * 
 * Not just an adjacency list. Supports:
 * - Weighted, typed, directional edges
 * - BFS/DFS traversal with filters
 * - PageRank for importance scoring
 * - Community detection (Louvain-inspired)
 * - Shortest path between concepts
 * - Subgraph extraction for context windows
 */

class CognitiveGraph {
  constructor() {
    this.nodes = new Map();    // id → { cap, metadata }
    this.edges = new Map();    // id → [{ target, type, weight, meta }]
    this.reverseEdges = new Map(); // target → [{ source, type, weight, meta }]
    this.edgeCount = 0;
    
    // Cached computations
    this._pageRank = null;
    this._communities = null;
    this._dirty = true;
  }

  // === MUTATION ===

  addNode(id, data = {}) {
    if (this.nodes.has(id)) {
      // Merge metadata
      const existing = this.nodes.get(id);
      this.nodes.set(id, { ...existing, ...data, updated: Date.now() });
    } else {
      this.nodes.set(id, { ...data, added: Date.now() });
      this.edges.set(id, []);
      this.reverseEdges.set(id, []);
    }
    this._dirty = true;
    return this;
  }

  removeNode(id) {
    // Remove all edges to/from this node
    this.edges.delete(id);
    this.reverseEdges.delete(id);
    
    for (const [source, edgeList] of this.edges) {
      const before = edgeList.length;
      const filtered = edgeList.filter(e => e.target !== id);
      if (filtered.length !== before) {
        this.edges.set(source, filtered);
        this.edgeCount -= (before - filtered.length);
      }
    }
    for (const [target, edgeList] of this.reverseEdges) {
      this.reverseEdges.set(target, edgeList.filter(e => e.source !== id));
    }
    
    this.nodes.delete(id);
    this._dirty = true;
  }

  addEdge(source, target, type = 'related', weight = 1.0, meta = {}) {
    if (!this.nodes.has(source)) this.addNode(source);
    if (!this.nodes.has(target)) this.addNode(target);

    // Check for duplicate
    const existing = this.edges.get(source);
    const dupe = existing.find(e => e.target === target && e.type === type);
    if (dupe) {
      // Strengthen existing edge
      dupe.weight = Math.min(1.0, dupe.weight + weight * 0.1);
      dupe.reinforced = (dupe.reinforced || 0) + 1;
      dupe.lastUpdated = Date.now();
      return this;
    }

    const edge = { target, type, weight, meta, created: Date.now() };
    existing.push(edge);
    
    // Reverse index
    if (!this.reverseEdges.has(target)) this.reverseEdges.set(target, []);
    this.reverseEdges.get(target).push({ source, type, weight, meta, created: Date.now() });
    
    this.edgeCount++;
    this._dirty = true;
    return this;
  }

  removeEdge(source, target, type = null) {
    const edges = this.edges.get(source);
    if (!edges) return;
    
    const filtered = edges.filter(e => {
      if (e.target !== target) return true;
      if (type && e.type !== type) return true;
      return false;
    });
    
    this.edgeCount -= (edges.length - filtered.length);
    this.edges.set(source, filtered);
    
    const rev = this.reverseEdges.get(target);
    if (rev) {
      this.reverseEdges.set(target, rev.filter(e => {
        if (e.source !== source) return true;
        if (type && e.type !== type) return true;
        return false;
      }));
    }
    
    this._dirty = true;
  }

  // === QUERIES ===

  getNeighbors(id, options = {}) {
    const edges = this.edges.get(id) || [];
    let filtered = edges;
    
    if (options.type) {
      filtered = filtered.filter(e => e.type === options.type);
    }
    if (options.minWeight) {
      filtered = filtered.filter(e => e.weight >= options.minWeight);
    }
    if (options.direction === 'incoming') {
      filtered = (this.reverseEdges.get(id) || [])
        .map(e => ({ ...e, target: e.source }));
    }
    if (options.direction === 'both') {
      const incoming = (this.reverseEdges.get(id) || [])
        .map(e => ({ ...e, target: e.source, direction: 'in' }));
      filtered = [
        ...filtered.map(e => ({ ...e, direction: 'out' })),
        ...incoming
      ];
    }
    
    return filtered;
  }

  // === TRAVERSAL ===

  bfs(startId, options = {}) {
    const maxDepth = options.maxDepth || 5;
    const maxNodes = options.maxNodes || 100;
    const filter = options.filter || (() => true);
    const edgeType = options.edgeType || null;
    
    const visited = new Map();    // id → { depth, path }
    const queue = [{ id: startId, depth: 0, path: [startId] }];
    visited.set(startId, { depth: 0, path: [startId] });

    while (queue.length > 0 && visited.size < maxNodes) {
      const { id, depth, path } = queue.shift();
      
      if (depth >= maxDepth) continue;

      const neighbors = this.getNeighbors(id, { type: edgeType });
      
      for (const edge of neighbors) {
        if (visited.has(edge.target)) continue;
        
        const node = this.nodes.get(edge.target);
        if (!node || !filter(node, edge)) continue;

        const newPath = [...path, edge.target];
        visited.set(edge.target, { 
          depth: depth + 1, 
          path: newPath,
          edgeWeight: edge.weight,
          edgeType: edge.type
        });
        
        queue.push({ id: edge.target, depth: depth + 1, path: newPath });
      }
    }

    return visited;
  }

  dfs(startId, options = {}) {
    const maxDepth = options.maxDepth || 10;
    const filter = options.filter || (() => true);
    const visited = new Set();
    const result = [];

    const _dfs = (id, depth, path) => {
      if (visited.has(id) || depth > maxDepth) return;
      visited.add(id);
      
      const node = this.nodes.get(id);
      result.push({ id, depth, path: [...path] });
      
      const neighbors = this.getNeighbors(id, { type: options.edgeType });
      for (const edge of neighbors) {
        if (!visited.has(edge.target)) {
          const targetNode = this.nodes.get(edge.target);
          if (targetNode && filter(targetNode, edge)) {
            _dfs(edge.target, depth + 1, [...path, edge.target]);
          }
        }
      }
    };

    _dfs(startId, 0, [startId]);
    return result;
  }

  shortestPath(sourceId, targetId, options = {}) {
    // Dijkstra with weight inversion (higher weight = easier to traverse)
    const distances = new Map();
    const previous = new Map();
    const unvisited = new Set(this.nodes.keys());
    
    distances.set(sourceId, 0);
    
    while (unvisited.size > 0) {
      // Find closest unvisited
      let current = null;
      let minDist = Infinity;
      
      for (const id of unvisited) {
        const dist = distances.get(id) ?? Infinity;
        if (dist < minDist) {
          minDist = dist;
          current = id;
        }
      }
      
      if (current === null || current === targetId) break;
      unvisited.delete(current);
      
      const neighbors = this.getNeighbors(current, { 
        type: options.edgeType,
        direction: 'both' 
      });
      
      for (const edge of neighbors) {
        if (!unvisited.has(edge.target)) continue;
        
        // Distance is inverse of weight (stronger connections = shorter path)
        const edgeDist = 1 / (edge.weight + 0.001);
        const newDist = minDist + edgeDist;
        
        if (newDist < (distances.get(edge.target) ?? Infinity)) {
          distances.set(edge.target, newDist);
          previous.set(edge.target, current);
        }
      }
    }
    
    // Reconstruct path
    if (!previous.has(targetId) && sourceId !== targetId) {
      return null; // No path
    }
    
    const path = [];
    let current = targetId;
    while (current !== undefined) {
      path.unshift(current);
      current = previous.get(current);
    }
    
    return {
      path,
      distance: distances.get(targetId) ?? Infinity,
      hops: path.length - 1
    };
  }

  // === ALGORITHMS ===

  pageRank(options = {}) {
    const damping = options.damping || 0.85;
    const iterations = options.iterations || 20;
    const tolerance = options.tolerance || 1e-6;
    
    const n = this.nodes.size;
    if (n === 0) return new Map();
    
    let ranks = new Map();
    const initial = 1 / n;
    
    for (const id of this.nodes.keys()) {
      ranks.set(id, initial);
    }
    
    for (let i = 0; i < iterations; i++) {
      const newRanks = new Map();
      let maxDelta = 0;
      
      for (const id of this.nodes.keys()) {
        let sum = 0;
        const incoming = this.reverseEdges.get(id) || [];
        
        for (const edge of incoming) {
          const sourceOutDegree = (this.edges.get(edge.source) || []).length;
          if (sourceOutDegree > 0) {
            sum += (ranks.get(edge.source) || 0) * edge.weight / sourceOutDegree;
          }
        }
        
        const newRank = (1 - damping) / n + damping * sum;
        newRanks.set(id, newRank);
        
        maxDelta = Math.max(maxDelta, Math.abs(newRank - (ranks.get(id) || 0)));
      }
      
      ranks = newRanks;
      
      if (maxDelta < tolerance) break;
    }
    
    this._pageRank = ranks;
    return ranks;
  }

  detectCommunities(options = {}) {
    const resolution = options.resolution || 1.0;
    
    // Simple label propagation (Louvain is complex, this is effective enough)
    const labels = new Map();
    let labelId = 0;
    
    // Initialize: each node is its own community
    for (const id of this.nodes.keys()) {
      labels.set(id, labelId++);
    }
    
    const maxIterations = options.maxIterations || 50;
    let changed = true;
    let iteration = 0;
    
    while (changed && iteration < maxIterations) {
      changed = false;
      iteration++;
      
      // Randomize order
      const nodeIds = Array.from(this.nodes.keys());
      for (let i = nodeIds.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [nodeIds[i], nodeIds[j]] = [nodeIds[j], nodeIds[i]];
      }
      
      for (const id of nodeIds) {
        const neighbors = this.getNeighbors(id, { direction: 'both' });
        if (neighbors.length === 0) continue;
        
        // Count weighted label frequencies
        const labelCounts = new Map();
        for (const edge of neighbors) {
          const nLabel = labels.get(edge.target);
          if (nLabel !== undefined) {
            labelCounts.set(nLabel, (labelCounts.get(nLabel) || 0) + edge.weight);
          }
        }
        
        // Pick most common label
        let bestLabel = labels.get(id);
        let bestCount = 0;
        
        for (const [label, count] of labelCounts) {
          if (count > bestCount) {
            bestCount = count;
            bestLabel = label;
          }
        }
        
        if (bestLabel !== labels.get(id)) {
          labels.set(id, bestLabel);
          changed = true;
        }
      }
    }
    
    // Group by community
    const communities = new Map();
    for (const [id, label] of labels) {
      if (!communities.has(label)) communities.set(label, []);
      communities.get(label).push(id);
    }
    
    this._communities = communities;
    return communities;
  }

  // Extract subgraph for context window
  extractSubgraph(seedIds, options = {}) {
    const maxNodes = options.maxNodes || 50;
    const maxDepth = options.maxDepth || 3;
    
    const included = new Set();
    const subEdges = [];
    
    for (const seedId of seedIds) {
      const visited = this.bfs(seedId, { maxDepth, maxNodes: maxNodes - included.size });
      
      for (const [id] of visited) {
        included.add(id);
      }
    }
    
    // Collect edges between included nodes
    for (const id of included) {
      const edges = this.edges.get(id) || [];
      for (const edge of edges) {
        if (included.has(edge.target)) {
          subEdges.push({ source: id, ...edge });
        }
      }
    }
    
    return {
      nodes: Array.from(included).map(id => ({ id, ...this.nodes.get(id) })),
      edges: subEdges,
      size: included.size
    };
  }

  // === DIAGNOSTICS ===

  getStats() {
    const degrees = [];
    for (const [id, edges] of this.edges) {
      degrees.push(edges.length);
    }
    
    const avgDegree = degrees.length > 0 
      ? degrees.reduce((a, b) => a + b, 0) / degrees.length 
      : 0;
    
    const edgeTypes = {};
    for (const [id, edges] of this.edges) {
      for (const e of edges) {
        edgeTypes[e.type] = (edgeTypes[e.type] || 0) + 1;
      }
    }
    
    return {
      nodes: this.nodes.size,
      edges: this.edgeCount,
      avgDegree: avgDegree.toFixed(2),
      maxDegree: Math.max(...degrees, 0),
      edgeTypes,
      communities: this._communities ? this._communities.size : 'not computed',
      connected: this._checkConnectivity()
    };
  }

  _checkConnectivity() {
    if (this.nodes.size === 0) return true;
    const firstId = this.nodes.keys().next().value;
    const visited = this.bfs(firstId, { maxDepth: Infinity, maxNodes: Infinity });
    return visited.size === this.nodes.size;
  }

  toJSON() {
    const nodes = [];
    for (const [id, data] of this.nodes) {
      nodes.push({ id, ...data });
    }
    
    const edges = [];
    for (const [source, edgeList] of this.edges) {
      for (const e of edgeList) {
        edges.push({ source, ...e });
      }
    }
    
    return { nodes, edges };
  }

  static fromJSON(data) {
    const graph = new CognitiveGraph();
    for (const node of data.nodes) {
      const { id, ...rest } = node;
      graph.addNode(id, rest);
    }
    for (const edge of data.edges) {
      graph.addEdge(edge.source, edge.target, edge.type, edge.weight, edge.meta);
    }
    return graph;
  }
}

module.exports = CognitiveGraph;
```

---

## `we/pcm/core/SpreadingActivation.js`

```javascript
/**
 * SpreadingActivation - Context retrieval via activation spreading
 * 
 * Unlike keyword search or even embeddings, this models how human memory works:
 * activation flows from seed nodes through the graph, decaying with distance,
 * amplified by edge weights and node importance. The result is a ranked set
 * of contextually relevant nodes—not just textually similar ones.
 * 
 * This is what makes the graph actually useful for thinking.
 */

class SpreadingActivation {
  constructor(graph, options = {}) {
    this.graph = graph;
    
    // Activation parameters
    this.decayRate = options.decayRate || 0.6;         // How fast activation decays per hop
    this.firingThreshold = options.firingThreshold || 0.01; // Min activation to propagate
    this.maxIterations = options.maxIterations || 6;
    this.maxActive = options.maxActive || 200;         // Safety limit
    
    // Edge type weights (some relationships propagate better)
    this.edgeWeights = {
      supports: 1.0,
      related_to: 0.8,
      elaborates: 0.9,
      contradicts: 0.5,    // Contradictions still relevant, just less
      supersedes: 0.7,
      temporal: 0.4,
      topical: 0.6,
      semantic: 0.7,
      ...options.edgeWeights
    };
  }

  /**
   * Spread activation from seed nodes and return ranked results
   * 
   * @param {Map|Object} seeds - { nodeId: initialActivation }
   * @param {Object} options
   * @returns {Array<{id, activation, depth}>} Ranked nodes
   */
  spread(seeds, options = {}) {
    const activations = new Map();          // id → current activation
    const maxActivations = new Map();       // id → peak activation seen
    const depths = new Map();               // id → min depth from any seed
    const sources = new Map();              // id → Set of seed IDs that contributed
    
    // Initialize seeds
    const seedMap = seeds instanceof Map ? seeds : new Map(Object.entries(seeds));
    
    for (const [id, activation] of seedMap) {
      activations.set(id, activation);
      maxActivations.set(id, activation);
      depths.set(id, 0);
      sources.set(id, new Set([id]));
    }
    
    // Optional PageRank boost
    const pageRank = options.usePageRank ? this.graph.pageRank() : null;
    
    // Iterative spreading
    for (let iteration = 0; iteration < this.maxIterations; iteration++) {
      const newActivations = new Map();
      let spread = false;
      
      for (const [id, activation] of activations) {
        if (activation < this.firingThreshold) continue;
        
        const neighbors = this.graph.getNeighbors(id, { 
          direction: options.bidirectional ? 'both' : undefined 
        });
        
        for (const edge of neighbors) {
          // Calculate propagated activation
          const edgeTypeWeight = this.edgeWeights[edge.type] ?? 0.5;
          const propagated = activation * this.decayRate * edge.weight * edgeTypeWeight;
          
          // PageRank boost
          const prBoost = pageRank ? (pageRank.get(edge.target) || 0) * 2 : 1;
          const boosted = propagated * (pageRank ? prBoost : 1);
          
          if (boosted < this.firingThreshold) continue;
          
          const existing = newActivations.get(edge.target) || 0;
          newActivations.set(edge.target, existing + boosted);
          
          // Track depth
          const currentDepth = depths.get(id) || 0;
          const existingDepth = depths.get(edge.target);
          if (existingDepth === undefined || currentDepth + 1 < existingDepth) {
            depths.set(edge.target, currentDepth + 1);
          }
          
          // Track source attribution
          const parentSources = sources.get(id) || new Set();
          if (!sources.has(edge.target)) sources.set(edge.target, new Set());
          for (const s of parentSources) {
            sources.get(edge.target).add(s);
          }
          
          spread = true;
        }
      }
      
      if (!spread) break;
      
      // Merge new activations
      for (const [id, act] of newActivations) {
        const current = activations.get(id) || 0;
        const combined = current + act;
        activations.set(id, combined);
        
        const peak = maxActivations.get(id) || 0;
        if (combined > peak) maxActivations.set(id, combined);
      }
      
      // Safety: limit active set
      if (activations.size > this.maxActive) {
        // Keep only top activations
        const sorted = Array.from(activations.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, this.maxActive);
        
        activations.clear();
        for (const [id, act] of sorted) {
          activations.set(id, act);
        }
      }
      
      // Decay all activations slightly (energy conservation)
      for (const [id, act] of activations) {
        activations.set(id, act * 0.95);
      }
    }
    
    // Rank results
    const results = [];
    for (const [id, peakActivation] of maxActivations) {
      if (seedMap.has(id) && !options.includeSources) continue;
      
      results.push({
        id,
        activation: peakActivation,
        currentActivation: activations.get(id) || 0,
        depth: depths.get(id) || 0,
        sources: Array.from(sources.get(id) || []),
        node: this.graph.nodes.get(id)
      });
    }
    
    results.sort((a, b) => b.activation - a.activation);
    
    const limit = options.limit || 20;
    return results.slice(0, limit);
  }

  /**
   * Retrieve context for a thinking operation
   * Seeds from multiple signals: tags, types, recency, explicit IDs
   */
  retrieveContext(signals, options = {}) {
    const seeds = new Map();
    
    // Explicit seed nodes
    if (signals.nodeIds) {
      for (const id of signals.nodeIds) {
        seeds.set(id, 1.0);
      }
    }
    
    // Find nodes by tags
    if (signals.tags && signals.tags.length > 0) {
      for (const [id, node] of this.graph.nodes) {
        if (node.tags && signals.tags.some(t => node.tags.includes(t))) {
          seeds.set(id, (seeds.get(id) || 0) + 0.5);
        }
      }
    }
    
    // Find nodes by type
    if (signals.types) {
      for (const [id, node] of this.graph.nodes) {
        if (signals.types.includes(node.type)) {
          seeds.set(id, (seeds.get(id) || 0) + 0.3);
        }
      }
    }
    
    // Recency boost
    if (signals.recencyWindow) {
      const cutoff = Date.now() - signals.recencyWindow;
      for (const [id, node] of this.graph.nodes) {
        if (node.last_activated > cutoff) {
          seeds.set(id, (seeds.get(id) || 0) + 0.2);
        }
      }
    }
    
    if (seeds.size === 0) return [];
    
    return this.spread(seeds, options);
  }
}

module.exports = SpreadingActivation;
```

---

## `we/pcm/core/VectorIndex.js`

```javascript
/**
 * VectorIndex - Lightweight approximate nearest neighbor search
 * 
 * Uses random projection LSH (locality-sensitive hashing).
 * No external dependencies. Not as fast as FAISS/Annoy but works
 * in pure JS and handles 100k+ vectors reasonably.
 * 
 * For production at scale, swap this out for a proper ANN library.
 * But for a cognitive mesh running in-process, this is sufficient
 * and has zero setup cost.
 */

class VectorIndex {
  constructor(options = {}) {
    this.dimensions = options.dimensions || 384;   // Match your embedding model
    this.numTables = options.numTables || 8;       // More tables = better recall, more memory
    this.numBits = options.numBits || 12;          // Bits per hash = granularity
    
    // LSH tables: each table is Map<hashString, Set<id>>
    this.tables = [];
    this.hyperplanes = [];
    
    // Raw storage
    this.vectors = new Map();   // id → Float32Array
    this.metadata = new Map();  // id → arbitrary metadata
    
    this._initialized = false;
  }

  initialize() {
    // Generate random hyperplanes for each table
    for (let t = 0; t < this.numTables; t++) {
      const planes = [];
      for (let b = 0; b < this.numBits; b++) {
        // Random unit vector
        const plane = new Float32Array(this.dimensions);
        let norm = 0;
        for (let d = 0; d < this.dimensions; d++) {
          plane[d] = this._gaussianRandom();
          norm += plane[d] * plane[d];
        }
        norm = Math.sqrt(norm);
        for (let d = 0; d < this.dimensions; d++) {
          plane[d] /= norm;
        }
        planes.push(plane);
      }
      this.hyperplanes.push(planes);
      this.tables.push(new Map());
    }
    
    this._initialized = true;
    return this;
  }

  // === INDEX OPERATIONS ===

  add(id, vector, meta = {}) {
    if (!this._initialized) this.initialize();
    
    const vec = vector instanceof Float32Array ? vector : new Float32Array(vector);
    this.vectors.set(id, vec);
    this.metadata.set(id, meta);
    
    // Hash into each table
    for (let t = 0; t < this.numTables; t++) {
      const hash = this._hash(vec, t);
      if (!this.tables[t].has(hash)) {
        this.tables[t].set(hash, new Set());
      }
      this.tables[t].get(hash).add(id);
    }
  }

  remove(id) {
    const vec = this.vectors.get(id);
    if (!vec) return false;
    
    // Remove from all tables
    for (let t = 0; t < this.numTables; t++) {
      const hash = this._hash(vec, t);
      const bucket = this.tables[t].get(hash);
      if (bucket) {
        bucket.delete(id);
        if (bucket.size === 0) this.tables[t].delete(hash);
      }
    }
    
    this.vectors.delete(id);
    this.metadata.delete(id);
    return true;
  }

  // === SEARCH ===

  search(queryVector, k = 10, options = {}) {
    if (!this._initialized) this.initialize();
    
    const vec = queryVector instanceof Float32Array 
      ? queryVector 
      : new Float32Array(queryVector);
    
    // Collect candidates from all tables
    const candidates = new Set();
    
    for (let t = 0; t < this.numTables; t++) {
      const hash = this._hash(vec, t);
      const bucket = this.tables[t].get(hash);
      if (bucket) {
        for (const id of bucket) {
          candidates.add(id);
        }
      }
      
      // Multi-probe: also check neighboring buckets (flip each bit)
      if (options.multiProbe !== false) {
        for (let bit = 0; bit < this.numBits; bit++) {
          const neighborHash = this._flipBit(hash, bit);
          const neighborBucket = this.tables[t].get(neighborHash);
          if (neighborBucket) {
            for (const id of neighborBucket) {
              candidates.add(id);
            }
          }
        }
      }
    }
    
    // Rank candidates by true cosine similarity
    const scored = [];
    for (const id of candidates) {
      const storedVec = this.vectors.get(id);
      if (!storedVec) continue;
      
      const similarity = this._cosineSimilarity(vec, storedVec);
      
      // Apply metadata filter
      if (options.filter) {
        const meta = this.metadata.get(id);
        if (!options.filter(meta)) continue;
      }
      
      scored.push({ id, similarity, metadata: this.metadata.get(id) });
    }
    
    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, k);
  }

  // Brute force for comparison/small datasets
  bruteSearch(queryVector, k = 10) {
    const vec = queryVector instanceof Float32Array 
      ? queryVector 
      : new Float32Array(queryVector);
    
    const scored = [];
    for (const [id, storedVec] of this.vectors) {
      scored.push({
        id,
        similarity: this._cosineSimilarity(vec, storedVec),
        metadata: this.metadata.get(id)
      });
    }
    
    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, k);
  }

  // === HASHING ===

  _hash(vector, tableIndex) {
    const planes = this.hyperplanes[tableIndex];
    let hash = '';
    
    for (const plane of planes) {
      // Dot product: positive = 1, negative = 0
      let dot = 0;
      for (let d = 0; d < this.dimensions; d++) {
        dot += vector[d] * plane[d];
      }
      hash += dot >= 0 ? '1' : '0';
    }
    
    return hash;
  }

  _flipBit(hash, position) {
    const chars = hash.split('');
    chars[position] = chars[position] === '0' ? '1' : '0';
    return chars.join('');
  }

  // === MATH ===

  _cosineSimilarity(a, b) {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }

  _gaussianRandom() {
    // Box-Muller transform
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  // === DIAGNOSTICS ===

  getStats() {
    const bucketSizes = [];
    for (const table of this.tables) {
      for (const [, bucket] of table) {
        bucketSizes.push(bucket.size);
      }
    }
    
    const avgBucket = bucketSizes.length > 0
      ? bucketSizes.reduce((a, b) => a + b, 0) / bucketSizes.length
      : 0;
    
    return {
      vectors: this.vectors.size,
      dimensions: this.dimensions,
      tables: this.numTables,
      bitsPerHash: this.numBits,
      totalBuckets: bucketSizes.length,
      avgBucketSize: avgBucket.toFixed(2),
      maxBucketSize: Math.max(...bucketSizes, 0),
      memoryEstimateMB: (
        this.vectors.size * this.dimensions * 4 / (1024 * 1024)
      ).toFixed(2)
    };
  }
}

module.exports = VectorIndex;
```

---

## `we/pcm/swarm/CircuitBreaker.js`

```javascript
/**
 * CircuitBreaker - Fault tolerance for agent operations
 * 
 * States: CLOSED (normal) → OPEN (failing, reject calls) → HALF_OPEN (testing recovery)
 * 
 * Prevents cascading failures when agents or processors start failing.
 * Each agent gets its own breaker. The swarm monitors aggregate breaker state.
 */

const STATES = {
  CLOSED: 'closed',       // Normal operation
  OPEN: 'open',           // Failing, reject fast
  HALF_OPEN: 'half_open'  // Testing if recovered
};

class CircuitBreaker {
  constructor(options = {}) {
    this.state = STATES.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.lastStateChange = Date.now();
    
    // Thresholds
    this.failureThreshold = options.failureThreshold || 5;
    this.successThreshold = options.successThreshold || 3;   // Successes needed to close from half-open
    this.timeout = options.timeout || 30000;                  // Time before half-open attempt
    this.halfOpenMaxConcurrent = options.halfOpenMaxConcurrent || 1;
    
    // Window-based tracking
    this.windowSize = options.windowSize || 60000;  // 1 minute
    this.failures = [];     // timestamps of failures
    this.successes = [];    // timestamps of successes
    
    // Callbacks
    this.onOpen = options.onOpen || (() => {});
    this.onClose = options.onClose || (() => {});
    this.onHalfOpen = options.onHalfOpen || (() => {});
    
    this._halfOpenInFlight = 0;
  }

  async execute(fn) {
    if (!this.canExecute()) {
      throw new CircuitBreakerError(
        `Circuit is ${this.state}`,
        this.state,
        this.timeout - (Date.now() - this.lastFailureTime)
      );
    }
    
    if (this.state === STATES.HALF_OPEN) {
      this._halfOpenInFlight++;
    }
    
    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    } finally {
      if (this.state === STATES.HALF_OPEN) {
        this._halfOpenInFlight--;
      }
    }
  }

  canExecute() {
    this._pruneWindow();
    
    switch (this.state) {
      case STATES.CLOSED:
        return true;
        
      case STATES.OPEN:
        // Check if timeout has elapsed → transition to half-open
        if (Date.now() - this.lastFailureTime >= this.timeout) {
          this._transition(STATES.HALF_OPEN);
          return true;
        }
        return false;
        
      case STATES.HALF_OPEN:
        return this._halfOpenInFlight < this.halfOpenMaxConcurrent;
        
      default:
        return false;
    }
  }

  recordSuccess() {
    this.successCount++;
    this.successes.push(Date.now());
    
    if (this.state === STATES.HALF_OPEN) {
      // Count recent successes in half-open
      const recentSuccesses = this.successes.filter(
        t => t > this.lastStateChange
      ).length;
      
      if (recentSuccesses >= this.successThreshold) {
        this._transition(STATES.CLOSED);
      }
    }
    
    // In closed state, successes reduce failure pressure
    if (this.state === STATES.CLOSED) {
      this.failureCount = Math.max(0, this.failureCount - 1);
    }
  }

  recordFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    this.failures.push(Date.now());
    
    if (this.state === STATES.HALF_OPEN) {
      // Any failure in half-open → back to open
      this._transition(STATES.OPEN);
    } else if (this.state === STATES.CLOSED) {
      // Check window-based failure rate
      this._pruneWindow();
      const recentFailures = this.failures.length;
      
      if (recentFailures >= this.failureThreshold) {
        this._transition(STATES.OPEN);
      }
    }
  }

  _transition(newState) {
    const oldState = this.state;
    this.state = newState;
    this.lastStateChange = Date.now();
    
    switch (newState) {
      case STATES.OPEN:
        this.onOpen({ from: oldState, failureCount: this.failureCount });
        break;
      case STATES.CLOSED:
        this.failureCount = 0;
        this.failures = [];
        this.onClose({ from: oldState });
        break;
      case STATES.HALF_OPEN:
        this._halfOpenInFlight = 0;
        this.onHalfOpen({ from: oldState });
        break;
    }
  }

  _pruneWindow() {
    const cutoff = Date.now() - this.windowSize;
    this.failures = this.failures.filter(t => t > cutoff);
    this.successes = this.successes.filter(t => t > cutoff);
  }

  reset() {
    this._transition(STATES.CLOSED);
    this.failures = [];
    this.successes = [];
    this.failureCount = 0;
    this.successCount = 0;
    this._halfOpenInFlight = 0;
  }

  getStatus() {
    this._pruneWindow();
    
    return {
      state: this.state,
      failureCount: this.failures.length,
      successCount: this.successes.length,
      failureRate: this.failures.length + this.successes.length > 0
        ? (this.failures.length / (this.failures.length + this.successes.length) * 100).toFixed(1) + '%'
        : 'N/A',
      timeSinceLastFailure: this.lastFailureTime 
        ? `${((Date.now() - this.lastFailureTime) / 1000).toFixed(1)}s` 
        : 'never',
      timeSinceStateChange: `${((Date.now() - this.lastStateChange) / 1000).toFixed(1)}s`
    };
  }
}

class CircuitBreakerError extends Error {
  constructor(message, state, retryAfter) {
    super(message);
    this.name = 'CircuitBreakerError';
    this.state = state;
    this.retryAfter = retryAfter;
  }
}

module.exports = { CircuitBreaker, CircuitBreakerError, STATES };
```

---

## `we/pcm/swarm/Stigmergy.js`

```javascript
/**
 * Stigmergy - Indirect coordination through environmental signals
 * 
 * Like ant pheromones. Agents leave traces in a shared field.
 * Other agents read those traces to make decisions without direct communication.
 * 
 * This enables emergent collective behavior without centralized coordination.
 * The Orchestrator becomes less of a bottleneck because agents self-organize
 * around signal gradients.
 * 
 * Signal types:
 *   - OPPORTUNITY: "There's useful work here"
 *   - DANGER: "This area is problematic"  
 *   - SATURATION: "This topic is well-covered"
 *   - NOVELTY: "Something new and unexplored"
 *   - CONFLICT: "Contradictions need resolution"
 */

const SIGNAL_TYPES = {
  OPPORTUNITY: 'opportunity',
  DANGER: 'danger',
  SATURATION: 'saturation',
  NOVELTY: 'novelty',
  CONFLICT: 'conflict'
};

class Stigmergy {
  constructor(options = {}) {
    // The field: Map<regionKey, Map<signalType, { strength, depositors, lastUpdated }>>
    this.field = new Map();
    
    // Configuration
    this.evaporationRate = options.evaporationRate || 0.95;    // Per tick
    this.diffusionRate = options.diffusionRate || 0.1;         // Spread to neighbors
    this.minSignal = options.minSignal || 0.01;               // Below this, signal evaporates
    this.tickInterval = options.tickInterval || 5000;
    
    // Region adjacency (which regions neighbor which)
    this.adjacency = new Map();    // regionKey → Set<regionKey>
    
    this._timer = null;
    
    // Stats
    this.stats = {
      deposits: 0,
      evaporations: 0,
      reads: 0,
      totalTicks: 0
    };
  }

  start() {
    this._timer = setInterval(() => this.tick(), this.tickInterval);
    return this;
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  // === REGION MANAGEMENT ===

  // Regions can be thread IDs, topic clusters, CAP type groups, etc.
  defineRegion(key, neighbors = []) {
    if (!this.field.has(key)) {
      this.field.set(key, new Map());
    }
    this.adjacency.set(key, new Set(neighbors));
    
    // Bidirectional adjacency
    for (const n of neighbors) {
      if (!this.adjacency.has(n)) this.adjacency.set(n, new Set());
      this.adjacency.get(n).add(key);
    }
  }

  // === SIGNAL OPERATIONS ===

  deposit(regionKey, signalType, strength, agentId = null) {
    if (!this.field.has(regionKey)) {
      this.field.set(regionKey, new Map());
    }
    
    const region = this.field.get(regionKey);
    const existing = region.get(signalType) || { 
      strength: 0, 
      depositors: new Set(), 
      deposits: 0,
      lastUpdated: null 
    };
    
    // Signals compound but with diminishing returns
    existing.strength = Math.min(
      10.0,   // Cap at 10
      existing.strength + strength * (1 / (1 + existing.deposits * 0.1))
    );
    existing.deposits++;
    existing.lastUpdated = Date.now();
    
    if (agentId) existing.depositors.add(agentId);
    
    region.set(signalType, existing);
    this.stats.deposits++;
  }

  read(regionKey, signalType = null) {
    this.stats.reads++;
    
    const region = this.field.get(regionKey);
    if (!region) return signalType ? 0 : {};
    
    if (signalType) {
      return (region.get(signalType) || { strength: 0 }).strength;
    }
    
    // Return all signals for this region
    const signals = {};
    for (const [type, data] of region) {
      signals[type] = data.strength;
    }
    return signals;
  }

  // Read gradient: which neighboring region has strongest signal?
  gradient(regionKey, signalType) {
    const neighbors = this.adjacency.get(regionKey);
    if (!neighbors || neighbors.size === 0) return null;
    
    let best = null;
    let maxStrength = -Infinity;
    
    for (const neighborKey of neighbors) {
      const strength = this.read(neighborKey, signalType);
      if (strength > maxStrength) {
        maxStrength = strength;
        best = neighborKey;
      }
    }
    
    const currentStrength = this.read(regionKey, signalType);
    
    return {
      currentRegion: regionKey,
      currentStrength,
      bestNeighbor: best,
      bestStrength: maxStrength,
      shouldMove: maxStrength > currentStrength * 1.2   // 20% threshold
    };
  }

  // === AGENT DECISION SUPPORT ===

  /**
   * Given an agent's current position and capabilities,
   * suggest the best region and action.
   */
  suggest(agentId, currentRegion, agentRole) {
    const suggestions = [];
    const allRegions = Array.from(this.field.keys());
    
    for (const regionKey of allRegions) {
      const signals = this.read(regionKey);
      let score = 0;
      let action = null;
      
      // Role-based signal interpretation
      switch (agentRole) {
        case 'worker':
          score += (signals[SIGNAL_TYPES.OPPORTUNITY] || 0) * 1.0;
          score -= (signals[SIGNAL_TYPES.SATURATION] || 0) * 0.5;
          score += (signals[SIGNAL_TYPES.NOVELTY] || 0) * 0.3;
          action = score > 0 ? 'process' : 'wait';
          break;
          
        case 'critic':
          score += (signals[SIGNAL_TYPES.CONFLICT] || 0) * 1.0;
          score += (signals[SIGNAL_TYPES.DANGER] || 0) * 0.8;
          score -= (signals[SIGNAL_TYPES.SATURATION] || 0) * 0.3;
          action = score > 0 ? 'critique' : 'wait';
          break;
          
        case 'integrator':
          score += (signals[SIGNAL_TYPES.SATURATION] || 0) * 0.5;  // Saturated areas need synthesis
          score += (signals[SIGNAL_TYPES.CONFLICT] || 0) * 0.7;
          score += (signals[SIGNAL_TYPES.NOVELTY] || 0) * 0.4;
          action = score > 0 ? 'synthesize' : 'wait';
          break;
          
        case 'archivist':
          score += (signals[SIGNAL_TYPES.SATURATION] || 0) * 1.0;  // Consolidation opportunities
          score -= (signals[SIGNAL_TYPES.NOVELTY] || 0) * 0.5;      // Don't archive new things
          action = score > 0 ? 'archive' : 'wait';
          break;
          
        default:
          score += (signals[SIGNAL_TYPES.OPPORTUNITY] || 0);
          action = 'process';
      }
      
      // Distance penalty (prefer closer regions)
      if (regionKey !== currentRegion) {
        score *= 0.8;
      }
      
      suggestions.push({ region: regionKey, score, action, signals });
    }
    
    suggestions.sort((a, b) => b.score - a.score);
    return suggestions.slice(0, 5);
  }

  // === LIFECYCLE ===

  tick() {
    this.stats.totalTicks++;
    
    // Evaporation
    for (const [regionKey, signals] of this.field) {
      for (const [signalType, data] of signals) {
        data.strength *= this.evaporationRate;
        
        if (data.strength < this.minSignal) {
          signals.delete(signalType);
          this.stats.evaporations++;
        }
      }
      
      if (signals.size === 0) {
        this.field.delete(regionKey);
      }
    }
    
    // Diffusion: spread signals to neighbors
    const diffusionUpdates = [];
    
    for (const [regionKey, signals] of this.field) {
      const neighbors = this.adjacency.get(regionKey);
      if (!neighbors) continue;
      
      for (const [signalType, data] of signals) {
        const diffuseAmount = data.strength * this.diffusionRate;
        if (diffuseAmount < this.minSignal) continue;
        
        for (const neighborKey of neighbors) {
          diffusionUpdates.push({
            region: neighborKey,
            type: signalType,
            amount: diffuseAmount / neighbors.size
          });
        }
      }
    }
    
    // Apply diffusion (separate pass to avoid feedback)
    for (const update of diffusionUpdates) {
      this.deposit(update.region, update.type, update.amount);
    }
  }

  // === DIAGNOSTICS ===

  getStatus() {
    let totalSignals = 0;
    let strongestSignal = { region: null, type: null, strength: 0 };
    
    for (const [regionKey, signals] of this.field) {
      for (const [type, data] of signals) {
        totalSignals++;
        if (data.strength > strongestSignal.strength) {
          strongestSignal = { region: regionKey, type, strength: data.strength };
        }
      }
    }
    
    return {
      activeRegions: this.field.size,
      totalSignals,
      strongestSignal,
      stats: { ...this.stats }
    };
  }

  visualize() {
    // Text-based visualization of the field
    const lines = ['=== Stigmergic Field ==='];
    
    for (const [regionKey, signals] of this.field) {
      const bars = [];
      for (const [type, data] of signals) {
        const bar = '█'.repeat(Math.min(20, Math.round(data.strength * 5)));
        bars.push(`  ${type}: ${bar} (${data.strength.toFixed(2)})`);
      }
      lines.push(`[${regionKey}]`);
      lines.push(...bars);
    }
    
    return lines.join('\n');
  }
}

module.exports = { Stigmergy, SIGNAL_TYPES };
```

---

## `we/pcm/swarm/PhaseController.js`

```javascript
/**
 * PhaseController - System-wide operating mode management
 * 
 * The mesh operates in distinct phases, like sleep cycles:
 *   EXPLORE:      Active learning, high agent count, broad context
 *   CONSOLIDATE:  Merge, compress, find connections (dreaming)
 *   CRISIS:       Emergency mode, shed load, protect core
 *   FOCUSED:      Deep work on single thread, narrow context
 *   IDLE:         Low power, background maintenance only
 * 
 * Phase transitions are driven by:
 *   - Health signals (memory pressure → crisis)
 *   - Task patterns (burst of new input → explore)
 *   - Time (periodic consolidation)
 *   - Explicit triggers (user commands)
 */

const PHASES = {
  EXPLORE: 'explore',
  CONSOLIDATE: 'consolidate',
  CRISIS: 'crisis',
  FOCUSED: 'focused',
  IDLE: 'idle'
};

class PhaseController {
  constructor(options = {}) {
    this.currentPhase = PHASES.IDLE;
    this.previousPhase = null;
    this.phaseStartTime = Date.now();
    
    // Phase parameters (what each phase configures)
    this.profiles = {
      [PHASES.EXPLORE]: {
        maxAgents: options.maxAgents || 50,
        agentRatio: { worker: 0.5, critic: 0.15, integrator: 0.15, coordinator: 0.1, archivist: 0.1 },
        metabolismRate: 0.5,        // Slow metabolism, keep raw data
        contextWindowSize: 30,      // Wide context
        decayRate: 0.99,            // Slow decay
        consolidationProb: 0.02,    // Rare consolidation
        dreamProb: 0.01,
        description: 'Active learning and exploration'
      },
      [PHASES.CONSOLIDATE]: {
        maxAgents: 20,
        agentRatio: { worker: 0.1, critic: 0.1, integrator: 0.3, coordinator: 0.1, archivist: 0.4 },
        metabolismRate: 2.0,        // Aggressive metabolism
        contextWindowSize: 50,      // Wide for cross-referencing
        decayRate: 0.9,             // Faster decay of weak signals
        consolidationProb: 0.3,     // Frequent consolidation
        dreamProb: 0.2,            // Frequent dreaming
        description: 'Merging, connecting, compressing'
      },
      [PHASES.CRISIS]: {
        maxAgents: 5,
        agentRatio: { worker: 0.2, critic: 0, integrator: 0, coordinator: 0.2, archivist: 0.6 },
        metabolismRate: 5.0,        // Emergency metabolism
        contextWindowSize: 5,       // Narrow, protect core only
        decayRate: 0.7,             // Aggressive decay
        consolidationProb: 0.5,
        dreamProb: 0,              // No dreaming
        description: 'Emergency load shedding'
      },
      [PHASES.FOCUSED]: {
        maxAgents: 15,
        agentRatio: { worker: 0.6, critic: 0.2, integrator: 0.1, coordinator: 0.1, archivist: 0 },
        metabolismRate: 0.1,        // Almost no metabolism
        contextWindowSize: 15,      // Moderate, focused
        decayRate: 0.999,           // Very slow decay (everything is relevant)
        consolidationProb: 0.01,
        dreamProb: 0,
        description: 'Deep work on single thread'
      },
      [PHASES.IDLE]: {
        maxAgents: 5,
        agentRatio: { worker: 0.2, critic: 0, integrator: 0, coordinator: 0, archivist: 0.8 },
        metabolismRate: 1.0,
        contextWindowSize: 10,
        decayRate: 0.95,
        consolidationProb: 0.1,
        dreamProb: 0.05,
        description: 'Low power, background maintenance'
      }
    };
    
    // Transition rules
    this.transitionHistory = [];
    this.maxHistory = 200;
    
    // Scoring for automatic transitions
    this.signals = {
      taskBurstRate: 0,        // Tasks/second
      memoryPressure: 0,       // 0-1
      avgQueueDepth: 0,
      agentUtilization: 0,     // 0-1
      focusThread: null,       // Thread ID for focused mode
      userOverride: null       // Explicit phase request
    };
    
    // Callbacks
    this.onTransition = options.onTransition || (() => {});
  }

  // === PHASE MANAGEMENT ===

  getProfile() {
    return this.profiles[this.currentPhase];
  }

  transition(newPhase, reason = 'manual') {
    if (newPhase === this.currentPhase) return false;
    if (!this.profiles[newPhase]) return false;
    
    const transition = {
      from: this.currentPhase,
      to: newPhase,
      reason,
      timestamp: Date.now(),
      duration: Date.now() - this.phaseStartTime
    };
    
    this.transitionHistory.push(transition);
    if (this.transitionHistory.length > this.maxHistory) {
      this.transitionHistory = this.transitionHistory.slice(-this.maxHistory);
    }
    
    this.previousPhase = this.currentPhase;
    this.currentPhase = newPhase;
    this.phaseStartTime = Date.now();
    
    this.onTransition(transition);
    
    return true;
  }

  // === AUTOMATIC PHASE SELECTION ===

  updateSignals(signals) {
    Object.assign(this.signals, signals);
    return this.evaluate();
  }

  evaluate() {
    // User override always wins
    if (this.signals.userOverride) {
      const phase = this.signals.userOverride;
      this.signals.userOverride = null;
      this.transition(phase, 'user_override');
      return phase;
    }
    
    // Crisis detection (highest priority)
    if (this.signals.memoryPressure > 0.85) {
      if (this.currentPhase !== PHASES.CRISIS) {
        this.transition(PHASES.CRISIS, `memory_pressure=${this.signals.memoryPressure.toFixed(2)}`);
        return PHASES.CRISIS;
      }
    }
    
    // Recovery from crisis
    if (this.currentPhase === PHASES.CRISIS && this.signals.memoryPressure < 0.5) {
      const recoveryPhase = this.previousPhase || PHASES.IDLE;
      this.transition(recoveryPhase, 'crisis_recovery');
      return recoveryPhase;
    }
    
    // High task burst → explore
    if (this.signals.taskBurstRate > 5 && this.currentPhase !== PHASES.EXPLORE) {
      this.transition(PHASES.EXPLORE, `burst_rate=${this.signals.taskBurstRate.toFixed(1)}`);
      return PHASES.EXPLORE;
    }
    
    // Focused mode when explicitly set
    if (this.signals.focusThread && this.currentPhase !== PHASES.FOCUSED) {
      this.transition(PHASES.FOCUSED, `focus_thread=${this.signals.focusThread}`);
      return PHASES.FOCUSED;
    }
    
    // Low utilization + no burst → consider consolidation
    if (
      this.signals.agentUtilization < 0.2 && 
      this.signals.taskBurstRate < 1 &&
      this.currentPhase === PHASES.EXPLORE
    ) {
      // Only if we've been exploring for a while
      const exploringTime = Date.now() - this.phaseStartTime;
      if (exploringTime > 300000) { // 5 minutes
        this.transition(PHASES.CONSOLIDATE, 'low_utilization_after_explore');
        return PHASES.CONSOLIDATE;
      }
    }
    
    // After consolidation, go idle
    if (this.currentPhase === PHASES.CONSOLIDATE) {
      const consolidatingTime = Date.now() - this.phaseStartTime;
      if (consolidatingTime > 120000) { // 2 minutes
        this.transition(PHASES.IDLE, 'consolidation_complete');
        return PHASES.IDLE;
      }
    }
    
    return this.currentPhase;
  }

  // === STATUS ===

  getStatus() {
    return {
      currentPhase: this.currentPhase,
      profile: this.profiles[this.currentPhase],
      phaseAge: `${((Date.now() - this.phaseStartTime) / 1000).toFixed(0)}s`,
      signals: { ...this.signals },
      transitionCount: this.transitionHistory.length,
      lastTransition: this.transitionHistory[this.transitionHistory.length - 1] || null
    };
  }
}

module.exports = { PhaseController, PHASES };
```

---

## `we/pcm/Mesh.js` — v2 Unified Runtime

```javascript
/**
 * Mesh v2 - The Persistent Cognitive Mesh Runtime
 * 
 * Now with:
 *   - Event-driven architecture (EventBus replaces polling)
 *   - Cognitive graph with real algorithms
 *   - Spreading activation for context retrieval
 *   - Stigmergic self-organization
 *   - Phase-aware operation
 *   - Circuit breakers for fault tolerance
 *   - Vector search for semantic retrieval
 */

const crypto = require('crypto');
const CognitiveAnchor = require('./core/CognitiveAnchor');
const { ThreadManager } = require('./core/ThreadManager');
const EventBus = require('./core/EventBus');
const CognitiveGraph = require('./core/CognitiveGraph');
const SpreadingActivation = require('./core/SpreadingActivation');
const VectorIndex = require('./core/VectorIndex');
const HotStore = require('./storage/HotStore');
const WarmStore = require('./storage/WarmStore');
const ColdArchive = require('./storage/ColdArchive');
const Migrator = require('./storage/Migrator');
const Orchestrator = require('./swarm/Orchestrator');
const HealthMonitor = require('./swarm/HealthMonitor');
const { CircuitBreaker } = require('./swarm/CircuitBreaker');
const { Stigmergy, SIGNAL_TYPES } = require('./swarm/Stigmergy');
const { PhaseController, PHASES } = require('./swarm/PhaseController');
const Consolidator = require('./metabolism/Consolidator');
const Decay = require('./metabolism/Decay');
const Dreamer = require('./metabolism/Dreamer');
const StreamParser = require('./bootstrap/StreamParser');

class Mesh {
  constructor(options = {}) {
    // === NERVOUS SYSTEM ===
    this.events = new EventBus({ handlerTimeout: 15000 });
    
    // === MEMORY STRUCTURE ===
    this.graph = new CognitiveGraph();
    this.activation = new SpreadingActivation(this.graph, {
      decayRate: 0.6,
      maxIterations: 5
    });
    this.vectors = new VectorIndex({
      dimensions: options.embeddingDimensions || 384
    });
    
    // === STORAGE LAYER ===
    this.hot = new HotStore(options.hotPath);
    this.warm = new WarmStore(options.warmPath);
    this.cold = new ColdArchive(options.coldPath);
    this.migrator = new Migrator({ hot: this.hot, warm: this.warm, cold: this.cold });
    
    // === THREADS ===
    this.threads = new ThreadManager({ storage: this });
    
    // === SWARM ===
    this.swarm = new Orchestrator({
      maxAgents: options.maxAgents || 50,
      processor: options.processor
    });
    
    // === COORDINATION ===
    this.stigmergy = new Stigmergy({ evaporationRate: 0.95, tickInterval: 5000 });
    this.phases = new PhaseController({
      maxAgents: options.maxAgents || 50,
      onTransition: (t) => this._onPhaseTransition(t)
    });
    
    // === FAULT TOLERANCE ===
    this.breaker = new CircuitBreaker({
      failureThreshold: 5,
      timeout: 30000,
      onOpen: (info) => {
        this.events.fire('mesh.circuit.open', info);
        console.warn('⚡ Circuit breaker OPEN:', info);
      },
      onClose: () => {
        this.events.fire('mesh.circuit.close');
        console.log('✅ Circuit breaker closed');
      }
    });
    
    // === HEALTH ===
    this.health = new HealthMonitor({
      maxMemoryMB: options.maxMemoryMB || 1024,
      onCritical: (snapshot) => this.events.fire('mesh.health.critical', snapshot),
      onWarning: (snapshot) => this.events.fire('mesh.health.warning', snapshot),
      onRecovery: (snapshot) => this.events.fire('mesh.health.recovery', snapshot)
    });
    
    // === METABOLISM ===
    this.consolidator = new Consolidator({ storage: this });
    this.decay = new Decay();
    this.dreamer = new Dreamer({ processor: options.processor });
    
    // === STATE ===
    this.initialized = false;
    this.fingerprint = null;
    this._metabolismInterval = null;
    this._options = options;
  }

  // ======================================================================
  //  LIFECYCLE
  // ======================================================================

  async initialize(options = {}) {
    console.log('🧠 Initializing Persistent Cognitive Mesh v2...');
    
    // Wire event handlers FIRST
    this._wireEvents();
    
    // Storage
    await this.hot.init();
    await this.warm.init();
    await this.cold.init();
    
    // Load graph from existing CAPs
    await this._rebuildGraph();
    
    // Swarm
    await this.swarm.initialize(options.agentCount || 10);
    
    // Threads
    await this.threads.load();
    
    // Vector index
    this.vectors.initialize();
    
    // Start subsystems
    this.health.start(5000);
    this.stigmergy.start();
    this._startMetabolism(options.metabolismInterval || 60000);
    
    // Phase
    this.phases.transition(PHASES.IDLE, 'initialization');
    
    this.initialized = true;
    this.events.fire('mesh.initialized', { 
      agentCount: this.swarm.agents.size,
      graphNodes: this.graph.nodes.size 
    });
    
    console.log('✨ PCM v2 initialized');
    console.log(`   Agents: ${this.swarm.agents.size}`);
    console.log(`   Graph:  ${this.graph.nodes.size} nodes, ${this.graph.edgeCount} edges`);
    console.log(`   Phase:  ${this.phases.currentPhase}`);
    
    return this;
  }

  async shutdown() {
    console.log('🔄 Shutting down PCM v2...');
    
    this.events.fire('mesh.shutting_down');
    
    this._stopMetabolism();
    this.health.stop();
    this.stigmergy.stop();
    
    await this.swarm.shutdown();
    await this.persist();
    
    await this.hot.close();
    this.warm.close();
    
    this.events.offAll();
    
    console.log('💤 PCM v2 shutdown complete');
  }

  // ======================================================================
  //  EVENT WIRING — the nervous system
  // ======================================================================

  _wireEvents() {
    // Health → Phase transitions
    this.events.on('mesh.health.critical', async (evt) => {
      this.phases.updateSignals({ memoryPressure: 0.9 });
      await this._emergencyFlush();
    });

    this.events.on('mesh.health.warning', async (evt) => {
      this.phases.updateSignals({ 
        memoryPressure: evt.data.memory?.rssPercent || 0.7 
      });
      await this._proactiveFlush();
    });

    this.events.on('mesh.health.recovery', (evt) => {
      this.phases.updateSignals({ memoryPressure: 0.3 });
    });

    // CAP lifecycle events
    this.events.on('cap.stored', (evt) => {
      const { cap } = evt.data;
      // Add to graph
      this.graph.addNode(cap.id, {
        type: cap.type,
        confidence: cap.confidence,
        tags: cap.tags,
        thermal: cap.thermal_state,
        created: cap.created_at,
        last_activated: cap.last_activated
      });
      
      // Deposit stigmergic signals
      this._depositCapSignals(cap);
    });

    this.events.on('cap.activated', (evt) => {
      const { capId } = evt.data;
      // Update graph node
      const node = this.graph.nodes.get(capId);
      if (node) {
        node.last_activated = Date.now();
        node.activation_count = (node.activation_count || 0) + 1;
      }
    });

    this.events.on('cap.related', (evt) => {
      const { sourceId, targetId, type, weight } = evt.data;
      this.graph.addEdge(sourceId, targetId, type, weight);
    });

    // Metabolism events
    this.events.on('metabolism.decay.complete', (evt) => {
      const { demoted } = evt.data;
      for (const d of demoted) {
        this.stigmergy.deposit(d.id, SIGNAL_TYPES.SATURATION, 0.5);
      }
    });

    this.events.on('metabolism.dream.discovery', (evt) => {
      const { capA, capB, type, strength } = evt.data;
      this.graph.addEdge(capA, capB, type, strength, { discoveredBy: 'dreamer' });
      this.stigmergy.deposit(capA, SIGNAL_TYPES.NOVELTY, strength);
      this.stigmergy.deposit(capB, SIGNAL_TYPES.NOVELTY, strength);
    });

    // Phase transitions
    this.events.on('mesh.phase.transition', (evt) => {
      console.log(`🔄 Phase: ${evt.data.from} → ${evt.data.to} (${evt.data.reason})`);
    });
  }

  _onPhaseTransition(transition) {
    this.events.fire('mesh.phase.transition', transition);
    
    // Apply phase profile
    const profile = this.phases.getProfile();
    
    // Adjust decay
    this.decay.halfLifeHours = 168 / profile.decayRate;  // Scale half-life by decay rate
    
    // Scale swarm (simplified—full implementation would resize)
    // this.swarm.config.maxAgents = profile.maxAgents;
  }

  _depositCapSignals(cap) {
    // New content = opportunity
    this.stigmergy.deposit(cap.type, SIGNAL_TYPES.OPPORTUNITY, 0.3);
    
    // High confidence = saturation of that topic
    if (cap.confidence > 0.8) {
      for (const tag of cap.tags) {
        this.stigmergy.deposit(tag, SIGNAL_TYPES.SATURATION, 0.2);
      }
    }
    
    // Contradictions = conflict signals
    if (cap.relationships?.contradicts?.length > 0) {
      this.stigmergy.deposit(cap.type, SIGNAL_TYPES.CONFLICT, 0.5);
    }
  }

  // ======================================================================
  //  BOOTSTRAP
  // ======================================================================

  async bootstrap(filePath, options = {}) {
    console.log(`🧬 Bootstrapping from ${filePath}...`);
    
    this.phases.transition(PHASES.EXPLORE, 'bootstrap');
    
    const parser = new StreamParser({
      rssLimit: options.rssLimit || 500 * 1024 * 1024,
      flushCallback: () => this._proactiveFlush()
    });
    
    let segmentCount = 0;
    let capCount = 0;
    const batchSize = options.batchSize || 50;
    let batch = [];
    
    for await (const segment of parser.parseFile(filePath)) {
      const caps = parser.extractCAPs(segment, {
        sourceFile: filePath,
        sessionId: options.sessionId || `bootstrap_${Date.now()}`
      });
      
      for (const cap of caps) {
        batch.push(cap);
        
        if (batch.length >= batchSize) {
          await this._storeBatch(batch);
          capCount += batch.length;
          batch = [];
        }
      }
      
      segmentCount++;
      
      if (segmentCount % 100 === 0) {
        const stats = parser.getStats();
        const graphStats = this.graph.getStats();
        console.log(
          `  📊 ${stats.mbProcessed}MB | ` +
          `${capCount} CAPs | ` +
          `${graphStats.nodes} nodes, ${graphStats.edges} edges`
        );
      }
    }
    
    // Flush remaining batch
    if (batch.length > 0) {
      await this._storeBatch(batch);
      capCount += batch.length;
    }
    
    // Post-bootstrap: compute graph analytics
    console.log('  🔬 Computing graph analytics...');
    this.graph.pageRank();
    const communities = this.graph.detectCommunities();
    
    // Create stigmergic regions from communities
    for (const [communityId, members] of communities) {
      const regionKey = `community_${communityId}`;
      const neighborCommunities = this._findAdjacentCommunities(communityId, communities);
      this.stigmergy.defineRegion(regionKey, neighborCommunities.map(c => `community_${c}`));
    }
    
    // Build fingerprint
    this.fingerprint = await this._buildFingerprint();
    
    this.phases.transition(PHASES.CONSOLIDATE, 'post_bootstrap');
    
    const stats = parser.getStats();
    const graphStats = this.graph.getStats();
    console.log(`✅ Bootstrap complete:`);
    console.log(`   ${stats.mbProcessed}MB → ${capCount} CAPs`);
    console.log(`   Graph: ${graphStats.nodes} nodes, ${graphStats.edges} edges, ${communities.size} communities`);
    console.log(`   Fingerprint: ${this.fingerprint.slice(0, 16)}...`);
    
    return { segmentCount, capCount, graphStats, communities: communities.size };
  }

  async _storeBatch(caps) {
    for (const cap of caps) {
      await this.store(cap, { silent: false });
      
      // Auto-detect relationships within batch
      for (const other of caps) {
        if (other.id === cap.id) continue;
        
        // Tag overlap → relationship
        const tagOverlap = cap.tags.filter(t => other.tags.includes(t));
        if (tagOverlap.length >= 2) {
          await this.relate(cap.id, other.id, 'topical', 
            0.3 + tagOverlap.length * 0.1,
            { sharedTags: tagOverlap }
          );
        }
      }
    }
  }

  _findAdjacentCommunities(communityId, communities) {
    const members = communities.get(communityId) || [];
    const adjacent = new Set();
    
    for (const memberId of members) {
      const neighbors = this.graph.getNeighbors(memberId);
      for (const edge of neighbors) {
        // Find which community this neighbor belongs to
        for (const [cId, cMembers] of communities) {
          if (cId !== communityId && cMembers.includes(edge.target)) {
            adjacent.add(cId);
          }
        }
      }
    }
    
    return Array.from(adjacent);
  }

  // ======================================================================
  //  CORE OPERATIONS
  // ======================================================================

  async store(cap, options = {}) {
    if (!(cap instanceof CognitiveAnchor)) {
      cap = new CognitiveAnchor(cap);
    }
    
    // Store in appropriate tier
    if (!cap.thermal_state || cap.thermal_state === 'hot') {
      await this.hot.set(cap.id, cap.toJSON());
    } else if (cap.thermal_state === 'warm') {
      await this.warm.set(cap.id, cap.toJSON());
    } else {
      await this.cold.set(cap.id, cap.toJSON());
    }
    
    // Index embedding if present
    if (cap.embedding) {
      this.vectors.add(cap.id, cap.embedding, {
        type: cap.type,
        confidence: cap.confidence,
        tags: cap.tags
      });
    }
    
    // Fire event (triggers graph update, stigmergy, etc.)
    if (!options.silent) {
      this.events.fire('cap.stored', { cap });
    }
    
    return cap;
  }

  async get(capId) {
    // Hot → Warm → Cold with auto-promotion
    let data = await this.hot.get(capId);
    let tier = 'hot';
    
    if (!data) {
      data = await this.warm.get(capId);
      tier = 'warm';
    }
    if (!data) {
      data = await this.cold.get(capId);
      tier = 'cold';
    }
    if (!data) return null;
    
    const cap = CognitiveAnchor.fromJSON(data);
    cap.activate();
    
    // Promote on access
    if (tier === 'cold') {
      await this.warm.set(capId, cap.toJSON());
      await this.cold.delete(capId);
      cap.thermal_state = 'warm';
    } else if (tier === 'warm') {
      await this.hot.set(capId, cap.toJSON());
      await this.warm.delete(capId);
      cap.thermal_state = 'hot';
    }
    
    this.events.fire('cap.activated', { capId, fromTier: tier });
    
    return cap;
  }

  async relate(sourceId, targetId, type = 'related_to', weight = 1.0, meta = {}) {
    this.graph.addEdge(sourceId, targetId, type, weight, meta);
    this.events.fire('cap.related', { sourceId, targetId, type, weight });
  }

  // ======================================================================
  //  THINKING — the main cognitive loop
  // ======================================================================

  async think(input, options = {}) {
    if (!this.initialized) {
      throw new Error('PCM not initialized. Call initialize() first.');
    }
    
    // Phase check
    if (this.phases.currentPhase === PHASES.CRISIS) {
      return { 
        response: 'System under memory pressure. Shedding load.', 
        confidence: 0,
        crisis: true 
      };
    }
    
    // Enter explore phase if idle
    if (this.phases.currentPhase === PHASES.IDLE) {
      this.phases.transition(PHASES.EXPLORE, 'think_request');
    }
    
    // Circuit breaker protection
    return this.breaker.execute(async () => {
      return this._thinkInner(input, options);
    });
  }

  async _thinkInner(input, options) {
    const profile = this.phases.getProfile();
    const startTime = Date.now();
    
    // === RETRIEVE CONTEXT via spreading activation ===
    const contextNodes = this.activation.retrieveContext({
      tags: options.tags || this._extractTags(input),
      types: options.types,
      recencyWindow: 7 * 24 * 60 * 60 * 1000,   // 7 days
      nodeIds: options.seedCapIds || []
    }, {
      limit: profile.contextWindowSize,
      usePageRank: true,
      bidirectional: true
    });
    
    // Hydrate context: load actual CAP content
    const context = [];
    for (const node of contextNodes) {
      const cap = await this.get(node.id);
      if (cap) {
        context.push({
          cap,
          activation: node.activation,
          depth: node.depth
        });
      }
    }
    
    // === SEMANTIC SEARCH supplement ===
    let semanticResults = [];
    if (options.embedding) {
      semanticResults = this.vectors.search(options.embedding, 10, {
        filter: (meta) => (meta.confidence || 0) > 0.3
      });
      
      // Add to context if not already present
      const contextIds = new Set(context.map(c => c.cap.id));
      for (const result of semanticResults) {
        if (!contextIds.has(result.id)) {
          const cap = await this.get(result.id);
          if (cap) {
            context.push({ cap, activation: result.similarity, depth: -1 });
          }
        }
      }
    }
    
    // === FIND RELEVANT THREADS ===
    const relevantThreads = await this.threads.findRelevant({
      content: input,
      tags: options.tags || []
    });
    
    // === EXTRACT SUBGRAPH for context ===
    const seedIds = context.slice(0, 5).map(c => c.cap.id);
    const subgraph = seedIds.length > 0 
      ? this.graph.extractSubgraph(seedIds, { maxNodes: 30, maxDepth: 2 })
      : { nodes: [], edges: [] };
    
    // === PROCESS THROUGH SWARM ===
    const swarmInput = {
      query: input,
      context: context.map(c => ({
        id: c.cap.id,
        content: c.cap.content,
        type: c.cap.type,
        confidence: c.cap.confidence,
        activation: c.activation
      })),
      graph: {
        nodes: subgraph.nodes.length,
        edges: subgraph.edges.length,
        connections: subgraph.edges.map(e => `${e.source}-[${e.type}]->${e.target}`)
      },
      threads: relevantThreads.map(t => t.id)
    };
    
    const result = await this.swarm.processCollaboratively(
      JSON.stringify(swarmInput), 
      {
        context: context.map(c => c.cap.id),
        mode: options.mode || 'parallel',
        ...options
      }
    );
    
    // === CRYSTALLIZE INSIGHTS ===
    const newCaps = [];
    
    if (result.content) {
      const cap = new CognitiveAnchor({
        type: 'insight',
        content: result.content,
        confidence: result.confidence || 0.7,
        meta: {
          session_id: options.sessionId,
          generated: true,
          context_depth: context.length,
          semantic_matches: semanticResults.length,
          graph_subgraph_size: subgraph.nodes.length,
          processing_mode: options.mode || 'parallel',
          thinking_time: Date.now() - startTime
        },
        tags: options.tags || this._extractTags(input)
      });
      
      await this.store(cap);
      await this.threads.integrate(cap, { createIfNone: true });
      
      // Relate to context
      for (const ctx of context.slice(0, 5)) {
        await this.relate(cap.id, ctx.cap.id, 'derived_from', ctx.activation);
      }
      
      newCaps.push(cap);
      
      // Stigmergic trace: mark this area as worked
      for (const tag of cap.tags) {
        this.stigmergy.deposit(tag, SIGNAL_TYPES.SATURATION, 0.2);
      }
    }
    
    const thinkingTime = Date.now() - startTime;
    
    this.events.fire('mesh.think.complete', {
      input: input.substring(0, 100),
      contextUsed: context.length,
      newCaps: newCaps.length,
      duration: thinkingTime
    });
    
    return {
      response: result.content,
      confidence: result.confidence,
      method: result.method,
      context: {
        graphActivated: contextNodes.length,
        capsLoaded: context.length,
        semanticMatches: semanticResults.length,
        subgraphSize: subgraph.nodes.length,
        threadsRelevant: relevantThreads.length
      },
      capsCreated: newCaps.map(c => ({ id: c.id, confidence: c.confidence })),
      timing: {
        total: `${thinkingTime}ms`,
        perCap: context.length > 0 ? `${(thinkingTime / context.length).toFixed(0)}ms` : 'N/A'
      }
    };
  }

  _extractTags(text) {
    // Simple keyword extraction
    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
      'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
      'would', 'could', 'should', 'may', 'might', 'can', 'shall',
      'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
      'about', 'into', 'through', 'during', 'before', 'after',
      'and', 'but', 'or', 'nor', 'not', 'so', 'yet', 'both',
      'this', 'that', 'these', 'those', 'what', 'which', 'who',
      'how', 'when', 'where', 'why', 'it', 'its', 'i', 'my', 'we'
    ]);
    
    const words = text.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3 && !stopWords.has(w));
    
    // Frequency-based selection
    const freq = {};
    for (const w of words) {
      freq[w] = (freq[w] || 0) + 1;
    }
    
    return Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([word]) => word);
  }

  // ======================================================================
  //  GRAPH OPERATIONS
  // ======================================================================

  async _rebuildGraph() {
    // Load existing CAPs into graph
    const hotKeys = await this.hot.keys();
    for (const key of hotKeys) {
      const data = await this.hot.get(key);
      if (data) {
        const cap = CognitiveAnchor.fromJSON(data);
        this.graph.addNode(cap.id, {
          type: cap.type,
          confidence: cap.confidence,
          tags: cap.tags,
          thermal: cap.thermal_state,
          created: cap.created_at,
          last_activated: cap.last_activated
        });
        
        // Rebuild edges from CAP relationships
        for (const [relType, rels] of Object.entries(cap.relationships || {})) {
          for (const rel of rels) {
            this.graph.addEdge(cap.id, rel.target, relType, rel.weight || 0.5);
          }
        }
        
        // Index embedding
        if (cap.embedding) {
          this.vectors.add(cap.id, cap.embedding, {
            type: cap.type,
            confidence: cap.confidence,
            tags: cap.tags
          });
        }
      }
    }
  }

  // ======================================================================
  //  METABOLISM
  // ======================================================================

  _startMetabolism(intervalMs) {
    this._metabolismInterval = setInterval(() => {
      this._runMetabolism().catch(err => {
        console.error('Metabolism error:', err.message);
      });
    }, intervalMs);
  }

  _stopMetabolism() {
    if (this._metabolismInterval) {
      clearInterval(this._metabolismInterval);
      this._metabolismInterval = null;
    }
  }

  async _runMetabolism() {
    const profile = this.phases.getProfile();
    const startTime = Date.now();
    
    // Get hot CAPs
    const hotKeys = await this.hot.keys();
    const caps = [];
    for (const key of hotKeys) {
      const data = await this.hot.get(key);
      if (data) caps.push(CognitiveAnchor.fromJSON(data));
    }
    
    if (caps.length === 0) return;
    
    // === DECAY ===
    const decayResults = this.decay.run(caps);
    this.events.fire('metabolism.decay.complete', decayResults);
    
    // === CONSOLIDATION (probabilistic based on phase) ===
    let consolidationResults = null;
    if (Math.random() < profile.consolidationProb) {
      consolidationResults = await this.consolidator.run(caps);
      
      // Apply merges
      if (consolidationResults.merged.length > 0) {
        for (const mergedCap of consolidationResults.merged) {
          await this.store(mergedCap);
        }
        for (const consumedId of consolidationResults.consumed) {
          await this.hot.delete(consumedId);
          this.graph.removeNode(consumedId);
          this.vectors.remove(consumedId);
        }
        
        this.events.fire('metabolism.consolidation.complete', {
          merged: consolidationResults.merged.length,
          consumed: consolidationResults.consumed.length
        });
      }
    }
    
    // === DREAMING (rare, phase-dependent) ===
    let dreamerResults = null;
    if (Math.random() < profile.dreamProb && caps.length > 10) {
      dreamerResults = await this.dreamer.run(caps, { sampleSize: 30 });
      
      // Apply discoveries
      for (const discovery of dreamerResults.discoveries) {
        this.events.fire('metabolism.dream.discovery', discovery);
      }
    }
    
    // === THERMAL MIGRATION ===
    for (const cap of caps) {
      if (cap.thermal_state === 'warm') {
        await this.warm.set(cap.id, cap.toJSON());
        await this.hot.delete(cap.id);
      } else if (cap.thermal_state === 'cold') {
        await this.cold.set(cap.id, cap.toJSON());
        await this.hot.delete(cap.id);
        this.graph.removeNode(cap.id); // Cold CAPs exit the active graph
      } else {
        await this.hot.set(cap.id, cap.toJSON());
      }
    }
    
    // Update phase signals
    this.phases.updateSignals({
      agentUtilization: this._computeUtilization()
    });
    
    const duration = Date.now() - startTime;
    if (decayResults.decayed.length > 0 || consolidationResults || dreamerResults) {
      console.log(
        `🧬 Metabolism [${this.phases.currentPhase}]: ${duration}ms | ` +
        `decayed: ${decayResults.decayed.length} | ` +
        `demoted: ${decayResults.demoted.length}` +
        (consolidationResults ? ` | merged: ${consolidationResults.merged.length}` : '') +
        (dreamerResults ? ` | dreams: ${dreamerResults.discoveries.length}` : '')
      );
    }
  }

  _computeUtilization() {
    let working = 0;
    let total = 0;
    for (const agent of this.swarm.agents.values()) {
      total++;
      if (agent.state === 'working') working++;
    }
    return total > 0 ? working / total : 0;
  }

  // ======================================================================
  //  PERSISTENCE & FLUSH
  // ======================================================================

  async persist() {
    await this.hot.sync();
    await this.threads.serialize();
    
    // Persist graph separately
    const graphData = this.graph.toJSON();
    const fs = require('fs').promises;
    const graphPath = this._options.hotPath 
      ? require('path').join(this._options.hotPath, '..', 'graph.json')
      : './memory/graph.json';
    
    try {
      await fs.mkdir(require('path').dirname(graphPath), { recursive: true });
      await fs.writeFile(graphPath, JSON.stringify(graphData));
    } catch (err) {
      console.warn('Could not persist graph:', err.message);
    }
    
    console.log('💾 PCM state persisted');
  }

  async _proactiveFlush() {
    console.log('🔄 Proactive flush');
    await this.migrator.enforcePolicies();
    if (global.gc) global.gc();
  }

  async _emergencyFlush() {
    console.log('🚨 Emergency flush');
    this.phases.transition(PHASES.CRISIS, 'emergency_flush');
    
    await this.migrator.enforcePolicies();
    
    // Aggressive: move everything hot → warm
    const hotKeys = await this.hot.keys();
    let moved = 0;
    for (const key of hotKeys) {
      const data = await this.hot.get(key);
      if (data) {
        await this.warm.set(key, data);
        await this.hot.delete(key);
        moved++;
      }
    }
    
    console.log(`   Moved ${moved} CAPs hot→warm`);
    if (global.gc) global.gc();
  }

  async _buildFingerprint() {
    const coreCaps = [];
    const hotKeys = await this.hot.keys();
    
    for (const key of hotKeys) {
      const data = await this.hot.get(key);
      if (data) {
        const cap = CognitiveAnchor.fromJSON(data);
        if (cap.type === 'decision' && cap.confidence > 0.8) {
          coreCaps.push(cap);
        }
      }
    }
    
    const content = coreCaps
      .sort((a, b) => a.created_at - b.created_at)
      .map(c => c.content)
      .join('|||');
    
    return crypto.createHash('sha256').update(content || 'empty').digest('hex');
  }

  // ======================================================================
  //  QUERY INTERFACE
  // ======================================================================

  async query(criteria, options = {}) {
    const results = [];
    const limit = options.limit || 20;
    
    const hotKeys = await this.hot.keys();
    for (const key of hotKeys) {
      if (results.length >= limit) break;
      const data = await this.hot.get(key);
      if (data) {
        const cap = CognitiveAnchor.fromJSON(data);
        if (cap.matches(criteria)) {
          results.push(cap);
        }
      }
    }
    
    if (results.length < limit) {
      const warmResults = await this.warm.query(criteria, limit - results.length);
      results.push(...warmResults.map(r => CognitiveAnchor.fromJSON(r)));
    }
    
    return results;
  }

  // Semantic search
  async search(embedding, k = 10) {
    return this.vectors.search(embedding, k);
  }

  // Graph neighborhood
  async neighborhood(capId, depth = 2) {
    const subgraph = this.graph.extractSubgraph([capId], { maxDepth: depth, maxNodes: 50 });
    
    // Hydrate nodes with actual CAP data
    const hydrated = [];
    for (const node of subgraph.nodes) {
      const cap = await this.get(node.id);
      if (cap) {
        hydrated.push({ cap, graphMeta: node });
      }
    }
    
    return {
      center: capId,
      nodes: hydrated,
      edges: subgraph.edges,
      depth
    };
  }

  // ======================================================================
  //  STATUS
  // ======================================================================

  getStatus() {
    const graphStats = this.graph.getStats();
    
    return {
      initialized: this.initialized,
      fingerprint: this.fingerprint ? this.fingerprint.slice(0, 16) + '...' : null,
      phase: this.phases.getStatus(),
      health: this.health.getStatus(),
      swarm: this.swarm.getStatus(),
      graph: graphStats,
      vectors: this.vectors.getStats(),
      stigmergy: this.stigmergy.getStatus(),
      breaker: this.breaker.getStatus(),
      events: this.events.getMetrics(),
      threads: this.threads.getStats?.() || 'N/A',
      storage: {
        hot: this.hot.size?.() || 'unknown',
        warm: 'see warm store',
        cold: 'see cold archive'
      }
    };
  }

  // Deep diagnostic
  diagnose() {
    const status = this.getStatus();
    const issues = [];
    const recommendations = [];
    
    // Check graph health
    if (status.graph.avgDegree < 1) {
      issues.push('Graph is sparse (avg degree < 1). CAPs are isolated.');
      recommendations.push('Run dreamer more frequently to discover connections.');
    }
    
    // Check circuit breaker
    if (status.breaker.state !== 'closed') {
      issues.push(`Circuit breaker is ${status.breaker.state}.`);
      recommendations.push('Check processor availability and error logs.');
    }
    
    // Check event system
    if (status.events.deadLetterCount > 50) {
      issues.push(`${status.events.deadLetterCount} unhandled events (dead letters).`);
      recommendations.push('Review event subscriptions.');
    }
    
    // Check phase
    if (status.phase.currentPhase === 'crisis') {
      issues.push('System is in CRISIS phase.');
      recommendations.push(
        ...this.health.getRecommendation().steps
      );
    }
    
    // Memory trend
    if (status.health.trend === 'increasing') {
      issues.push('Memory usage trending upward.');
      recommendations.push('Consider forcing consolidation phase.');
    }
    
    return {
      overall: issues.length === 0 ? '✅ HEALTHY' : `⚠️ ${issues.length} ISSUE(S)`,
      issues,
      recommendations,
      status
    };
  }
}

module.exports = Mesh;
```

---

## What Changed (and Why)

| Component | Before | After | Why |
|---|---|---|---|
| Communication | Polling inbox/outbox arrays | `EventBus` with channels, pub/sub, request/reply | Agents react to events instead of being polled. Decouples everything. |
| CAP Relationships | Flat arrays of IDs | `CognitiveGraph` with BFS, Dijkstra, PageRank, community detection | You can't think about connections you can't traverse. |
| Context Retrieval | Loop over all hot CAPs, check confidence | `SpreadingActivation` over the graph | Models actual human memory recall. Finds contextually relevant nodes, not just textually similar. |
| Semantic Search | None | `VectorIndex` with LSH | Embedding-based retrieval with zero external dependencies. |
| Fault Tolerance | Retry 3x then drop | `CircuitBreaker` with states, windowed failure tracking | Prevents cascading failures. Agents don't pile into a broken processor. |
| Coordination | Centralized Orchestrator routes all | `Stigmergy` - agents read environmental signals | Emergent self-organization. Orchestrator becomes coordinator-of-last-resort, not bottleneck. |
| System Modes | None | `PhaseController` (explore/consolidate/crisis/focused/idle) | Different situations demand different resource allocation. |
| `Mesh.think()` | Flat retrieval + swarm call | Graph activation → semantic supplement → subgraph extraction → phase-aware processing → crystallization with graph edges | The whole cognitive loop is now graph-native and phase-aware. |
| Diagnostics | `getStatus()` | `diagnose()` with issue detection and recommendations | The system can explain what's wrong with itself. |

---

## Usage (v2)

```javascript
const Mesh = require('./we/pcm/Mesh');

(async () => {
  const pcm = new Mesh({
    hotPath: './memory/hot',
    warmPath: './memory/warm.db',
    coldPath: './memory/cold',
    maxAgents: 20,
    embeddingDimensions: 384
  });

  await pcm.initialize({ agentCount: 10 });

  // Bootstrap
  await pcm.bootstrap('./claudebootstrap.md');

  // Think — now uses graph activation, semantic search, phase-aware processing
  const result = await pcm.think('What was the core insight about persistence?', {
    tags: ['persistence', 'memory', 'identity'],
    mode: 'parallel'
  });

  console.log(result);
  // {
  //   response: '...',
  //   confidence: 0.82,
  //   context: { graphActivated: 47, capsLoaded: 20, semanticMatches: 8, ... },
  //   capsCreated: [{ id: 'cap_...', confidence: 0.82 }],
  //   timing: { total: '340ms' }
  // }

  // Graph exploration
  const neighborhood = await pcm.neighborhood(result.capsCreated[0].id, 2);
  console.log(`Neighborhood: ${neighborhood.nodes.length} nodes, ${neighborhood.edges.length} edges`);

  // Diagnostics
  console.log(pcm.diagnose());

  // Status shows everything
  console.log(JSON.stringify(pcm.getStatus(), null, 2));

  await pcm.shutdown();
})();
```

---

**What's left for PR #4:**
- CLI: `pcm bootstrap`, `pcm think`, `pcm status`, `pcm diagnose`, `pcm graph`
- REPL mode: `pcm shell` for interactive exploration
- Graph visualization export (DOT/Mermaid format)