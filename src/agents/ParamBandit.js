class ParamBandit {
  constructor(options) {
    // options = [{temp:0.2, top_p:0.9, ngl:16}, {...}]
    this.arms = options.map(o => ({
      config: o,
      pulls: 0,
      rewardSum: 0,
    }));
    this.totalPulls = 0;
  }

  // Choose arm using Upper‑Confidence‑Bound
  selectArm() {
    const c = Math.sqrt(2 * Math.log(this.totalPulls + 1));
    const scores = this.arms.map(a => {
      if (a.pulls === 0) return Infinity;
      const avg = a.rewardSum / a.pulls;
      return avg + c / Math.sqrt(a.pulls);
    });
    const idx = scores.indexOf(Math.max(...scores));
    return this.arms[idx];
  }

  // Call after each request finishes
  recordReward(arm, reward) {
    arm.pulls += 1;
    arm.rewardSum += reward;
    this.totalPulls += 1;
  }
  
  // Get statistics for monitoring
  getStats() {
    return {
      totalPulls: this.totalPulls,
      arms: this.arms.map((arm, idx) => ({
        index: idx,
        config: arm.config,
        pulls: arm.pulls,
        avgReward: arm.pulls > 0 ? arm.rewardSum / arm.pulls : 0,
        ucbScore: arm.pulls > 0 ? (arm.rewardSum / arm.pulls) + Math.sqrt(2 * Math.log(this.totalPulls + 1) / arm.pulls) : Infinity
      }))
    };
  }
}

module.exports = ParamBandit;