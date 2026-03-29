class Consensus {
  constructor(options = {}) {
    this.strategies = {
      vote: this.vote.bind(this),
      weighted: this.weighted.bind(this),
      defer: this.defer.bind(this)
    };
    this.default = options.default || "weighted";
  }

  aggregate(results, options = {}) {
    if (!results || !results.length) {
      return { content: null, confidence: 0, method: "none" };
    }
    if (results.length === 1) {
      return {
        content: results[0].result?.content || results[0],
        confidence: 1,
        method: "single",
        source: results[0].agentId
      };
    }
    return this.strategies[options.strategy || this.default](results);
  }

  vote(results) {
    const votes = new Map();
    for (const item of results) {
      const key = this.normalize(item.result?.content || "");
      const entry = votes.get(key) || { count: 0, original: item.result?.content, voters: [] };
      entry.count++;
      votes.set(key, entry);
    }

    let winner = null, maxVotes = 0;
    for (const [key, entry] of votes) {
      if (entry.count > maxVotes) {
        maxVotes = entry.count;
        winner = entry;
      }
    }

    return {
      content: winner?.original || null,
      confidence: maxVotes / results.length,
      method: "vote"
    };
  }

  weighted(results) {
    const weighted = results.map(item => ({
      ...item,
      weight: (item.agentStats?.successRate || 0.5) * 0.7 +
              (item.duration ? Math.exp(-item.duration / 10000) : 0.5) * 0.3
    }));
    weighted.sort((a, b) => b.weight - a.weight);

    return {
      content: weighted[0].result?.content || null,
      confidence: weighted[0].weight,
      method: "weighted"
    };
  }

  defer(results) {
    return {
      content: results[0].result?.content || null,
      confidence: 1 / results.length,
      method: "defer"
    };
  }

  normalize(text) {
    return text.toLowerCase()
      .replace(/[^\w\s]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200);
  }

  similarity(a, b) {
    const setA = new Set(a.toLowerCase().split(/\s+/));
    const setB = new Set(b.toLowerCase().split(/\s+/));
    const intersection = new Set([...setA].filter(x => setB.has(x)));
    const union = new Set([...setA, ...setB]);
    return intersection.size / union.size;
  }
}

module.exports = Consensus;
