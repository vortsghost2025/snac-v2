const os = require("os");

class HealthMonitor {
  constructor(o = {}) {
    this.thresholds = { rssWarn: o.rssWarn || 0.7, rssCrit: o.rssCrit || 0.85, cpuWarn: o.cpuWarn || 0.7, cpuCrit: o.cpuCrit || 0.9 };
    this.history = [];
    this.maxHistory = o.maxHistory || 100;
    this.interval = null;
    this.cb = { warn: o.onWarn || (() => {}), crit: o.onCrit || (() => {}), recov: o.onRecov || (() => {}) };
    this.lastState = "healthy";
  }

  start(ms = 5000) { this.interval = setInterval(() => this.check(), ms); return this; }
  stop() { if (this.interval) clearInterval(this.interval); this.interval = null; }

  check() {
    const snap = this.snap();
    this.history.push(snap);
    if (this.history.length > this.maxHistory) this.history = this.history.slice(-this.maxHistory);
    const state = this.eval(snap);
    if (state !== this.lastState) {
      if (state === "critical") this.cb.crit(snap);
      else if (state === "warning") this.cb.warn(snap);
      else if (this.lastState !== "healthy") this.cb.recov(snap);
      this.lastState = state;
    }
    return snap;
  }

  snap() {
    const mem = process.memoryUsage();
    return { ts: Date.now(), mem: { rss: mem.rss, heap: mem.heapUsed }, cpu: os.loadavg() };
  }

  eval(snap) {
    if (snap.mem.rss > this.thresholds.rssCrit * 1024 * 1024 * 1024) return "critical";
    if (snap.mem.rss > this.thresholds.rssWarn * 1024 * 1024 * 1024) return "warning";
    return "healthy";
  }

  status() { const s = this.eval(this.history[this.history.length - 1] || this.snap()); return { state: s, last: this.lastState }; }
  shouldThrottle() { return this.lastState === "critical"; }
}

module.exports = HealthMonitor;
