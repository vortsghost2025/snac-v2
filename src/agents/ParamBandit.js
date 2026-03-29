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

  // Choose arm using Upper-Confidence-Bound
  selectArm() {
    // If any arm hasn't been pulled, explore it (randomized order)
    const unpulled = this.arms.filter(a => a.pulls === 0);
    if (unpulled.length > 0) {
      // Return a random unpulled arm for fair initial exploration
      const idx = Math.floor(Math.random() * unpulled.length);
      return unpulled[idx];
    }

    const c = Math.sqrt(2 * Math.log(this.totalPulls + 1));
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < this.arms.length; i++) {
      const a = this.arms[i];
      const avg = a.rewardSum / a.pulls;
      const score = avg + c / Math.sqrt(a.pulls);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    return this.arms[bestIdx];
  }

  // Call after each request finishes
  recordReward(arm, reward) {
    if (typeof reward !== 'number' || !isFinite(reward)) {
      return; // Ignore invalid rewards
    }
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
