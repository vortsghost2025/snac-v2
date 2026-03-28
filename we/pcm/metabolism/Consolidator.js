const CognitiveAnchor = require("../core/CognitiveAnchor");

class Consolidator {
  constructor(o = {}) {
    this.threshold = o.threshold || 0.85;
    this.stats = { comps: 0, merges: 0 };
  }

  async run(caps) {
    const targets = [];
    for (let i = 0; i < caps.length; i++) {
      for (let j = i + 1; j < caps.length; j++) {
        this.stats.comps++;
        const sim = await this.sim(caps[i], caps[j]);
        if (sim >= this.threshold) targets.push({ a: caps[i], b: caps[j], sim });
      }
    }
    const merged = [], used = new Set();
    for (const t of targets) {
      if (used.has(t.a.id) || used.has(t.b.id)) continue;
      const m = CognitiveAnchor.merge(t.a, t.b, { reason: "consolidation" });
      merged.push(m); used.add(t.a.id); used.add(t.b.id); this.stats.merges++;
    }
    return { merged, used: Array.from(used) };
  }

  async sim(a, b) {
    if (a.embedding && b.embedding) return a.cosineSimilarity(a.embedding, b.embedding);
    const wA = new Set(a.content.toLowerCase().split(/\s+/));
    const wB = new Set(b.content.toLowerCase().split(/\s+/));
    const i = new Set([...wA].filter(x => wB.has(x)));
    const u = new Set([...wA, ...wB]);
    return i.size / u.size;
  }
}

module.exports = Consolidator;
