class Consensus {
  constructor(o = {}) {
    this.s = { vote: this.vote.bind(this), weighted: this.w.bind(this), defer: this.d.bind(this), triad: this.triad.bind(this) };
    this.default = o.default || "triad";
  }

  // Form trinities from agent pool
  formTrinities(agents) {
    const trinities = [];
    const spares = [];
    const byRole = { worker: [], critic: [], integrator: [] };

    for (const a of agents) {
      if (a.role === "worker") byRole.worker.push(a);
      else if (a.role === "critic") byRole.critic.push(a);
      else if (a.role === "integrator") byRole.integrator.push(a);
      else spares.push(a);
    }

    const maxTriads = Math.min(byRole.worker.length, byRole.critic.length, byRole.integrator.length);
    for (let i = 0; i < maxTriads; i++) {
      trinities.push({
        id: "trinity_" + i,
        worker: byRole.worker[i],
        critic: byRole.critic[i],
        integrator: byRole.integrator[i],
        status: "active"
      });
    }

    // Remaining agents become spares
    for (let i = maxTriads; i < byRole.worker.length; i++) spares.push(byRole.worker[i]);
    for (let i = maxTriads; i < byRole.critic.length; i++) spares.push(byRole.critic[i]);
    for (let i = maxTriads; i < byRole.integrator.length; i++) spares.push(byRole.integrator[i]);

    return { trinities, spares };
  }

  aggregate(r, o = {}) {
    if (!r || !r.length) return { c: null, conf: 0, m: "none" };
    if (r.length == 1) return { c: r[0].result?.c || r[0], conf: 1, m: "single", src: r[0].agentId };
    return this.s[o.strategy || this.default](r, o);
  }

  triad(r, o = {}) {
    const worker = r.find(x => x.role === "worker" || x.type === "observation");
    const critic = r.find(x => x.role === "critic" || x.type === "critique");
    const integrator = r.find(x => x.role === "integrator" || x.type === "synthesis");
    if (critic?.result?.issues?.length > 0) {
      return { c: integrator?.result?.c || worker?.result?.c || null, conf: 0.3, m: "vetoed", issues: critic.result.issues, vetoed: true };
    }
    return { c: integrator?.result?.c || worker?.result?.c || null, conf: 0.9, m: "triad" };
  }

  vote(r) {
    const v = new Map();
    for (const x of r) {
      const k = this.norm(x.result?.c || "");
      const e = v.get(k) || { cnt: 0, orig: x.result?.c };
      e.cnt++;
      v.set(k, e);
    }
    let w = null, mx = 0;
    for (const [d, x] of v) if (x.cnt > mx) { mx = x.cnt; w = x; }
    return { c: w?.orig || null, conf: mx / r.length, m: "vote" };
  }

  w(r) {
    const wt = r.map(x => ({ ...x, w: (x.agentStats?.sr || 0.5) * 0.7 + (x.duration ? Math.exp(-x.duration / 10000) : 0.5) * 0.3 }));
    wt.sort((a, b) => b.w - a.w);
    return { c: wt[0].result?.c || null, conf: wt[0].w, m: "weighted" };
  }

  d(r) { return { c: r[0].result?.c || null, conf: 1 / r.length, m: "defer" }; }

  norm(t) { try { return t.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim().slice(0, 200); } catch(e) { return ""; } }
  sim(a, b) {
    try {
      const A = new Set(a.toLowerCase().split(/\s+/));
      const B = new Set(b.toLowerCase().split(/\s+/));
      const i = new Set([...A].filter(x => B.has(x)));
      const u = new Set([...A, ...B]);
      return i.size / u.size;
    } catch(e) { return 0; }
  }
}

module.exports = Consensus;
