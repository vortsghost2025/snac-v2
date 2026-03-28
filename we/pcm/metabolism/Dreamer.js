class Dreamer {
  constructor(o = {}) {
    this.sample = o.sample || 50;
    this.threshold = o.threshold || 0.6;
    this.processor = o.processor || null;
    this.stats = { runs: 0, found: 0 };
  }

  async run(caps, o = {}) {
    const sample = this.sampleCaps(caps, o.sample || this.sample);
    const pairs = this.pairs(sample);
    const discoveries = [];
    for (const [a, b] of pairs) {
      if (this.related(a, b)) continue;
      const conn = await this.find(a, b);
      if (conn && conn.str >= this.threshold) {
        discoveries.push({ capA: a.id, capB: b.id, type: conn.type, desc: conn.desc, str: conn.str });
        this.stats.found++;
      }
    }
    this.stats.runs++;
    return { discoveries, sampled: sample.length, pairs: pairs.length };
  }

  sampleCaps(caps, n) {
    if (caps.length <= n) return [...caps];
    const selected = [];
    const byType = {}; caps.forEach(c => { byType[c.type] = byType[c.type] || []; byType[c.type].push(c); });
    for (const tc of Object.values(byType)) { if (selected.length < n && tc.length) selected.push(tc[Math.floor(Math.random() * tc.length)]); }
    while (selected.length < n && caps.length) selected.push(caps[Math.floor(Math.random() * caps.length)]);
    return selected;
  }

  pairs(caps) { const p = []; for (let i = 0; i < caps.length; i++) for (let j = i + 1; j < caps.length; j++) p.push([caps[i], caps[j]]); return p; }
  related(a, b) { return a.getAllRelatedIds().includes(b.id); }

  async find(a, b) {
    if (this.processor) return this.llmFind(a, b);
    const tags = a.tags.filter(t => b.tags.includes(t));
    if (tags.length >= 2) return { type: "topical", str: 0.5 + tags.length * 0.1, desc: tags.join(", ") };
    const wordsA = new Set(a.content.toLowerCase().split(/\s+/));
    const wordsB = new Set(b.content.toLowerCase().split(/\s+/));
    const inter = [...wordsA].filter(w => wordsB.has(w) && w.length > 5);
    if (inter.length >= 5) return { type: "semantic", str: 0.4 + inter.length * 0.05, desc: inter.slice(0, 5).join(", ") };
    return null;
  }

  async llmFind(a, b) {
    const prompt = "Analyze: A=" + a.content.substring(0, 200) + " B=" + b.content.substring(0, 200) + ". Connection?";
    try { const r = await this.processor.process({ input: prompt }); return r.includes("none") ? null : { type: "llm", str: 0.7, desc: r.substring(0, 100) }; }
    catch { return null; }
  }
}

module.exports = Dreamer;
