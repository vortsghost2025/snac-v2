class Decay {
  constructor(o = {}) {
    this.halfLife = o.halfLife || 168; // 7 days
    this.minConf = o.minConf || 0.05;
    this.protected = o.protected || ["decision", "core"];
    this.stats = { decayed: 0, demoted: 0 };
  }

  run(caps) {
    const now = Date.now();
    const results = { decayed: [], demoted: [], unchanged: [] };
    for (const cap of caps) {
      if (this.protected.includes(cap.type)) { results.unchanged.push(cap.id); continue; }
      const hrs = (now - cap.last_activated) / (1000 * 60 * 60);
      const decay = Math.pow(0.5, hrs / this.halfLife);
      const effective = decay + (1 - decay) * cap.stability;
      const old = cap.confidence;
      cap.confidence = Math.max(this.minConf, cap.confidence * effective);
      if (cap.confidence < old) { results.decayed.push({ id: cap.id, from: old, to: cap.confidence }); this.stats.decayed++; }
      if (cap.confidence < 0.3 && cap.thermal_state === "hot") { cap.thermal_state = "warm"; results.demoted.push(cap.id); this.stats.demoted++; }
      else if (cap.confidence < 0.1 && cap.thermal_state === "warm") { cap.thermal_state = "cold"; results.demoted.push(cap.id); this.stats.demoted++; }
    }
    return results;
  }

  project(cap, hrs) {
    const decay = Math.pow(0.5, hrs / this.halfLife);
    const effective = decay + (1 - decay) * cap.stability;
    const projConf = cap.confidence * effective;
    let projTherm = cap.thermal_state;
    if (projConf < 0.1) projTherm = "cold"; else if (projConf < 0.3) projTherm = "warm";
    return { currConf: cap.confidence, projConf, currTherm: cap.thermal_state, projTherm, willDemote: projTherm !== cap.thermal_state };
  }
}

module.exports = Decay;
