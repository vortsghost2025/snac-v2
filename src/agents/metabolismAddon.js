/**
 * GPU Accelerated Metabolism Functions for SNAC v2
 * Safe hybrid implementation:
 * - Tries native addon first
 * - Falls back to CPU implementation if unavailable
 */

const gpuGuard = require('../../utils/gpuGuard');
const logger = require('../../utils/logger');

function validateTripletInputs(xs, ys, zs) {
  if (!(xs instanceof Float32Array) || !(ys instanceof Float32Array) || !(zs instanceof Float32Array)) {
    throw new Error('Inputs must be Float32Array');
  }

  if (xs.length !== ys.length || xs.length !== zs.length) {
    throw new Error('All input arrays must have the same length');
  }
}

function cpuScoreBatch(a, b, c, xs, ys, zs) {
  validateTripletInputs(xs, ys, zs);

  const N = xs.length;
  const out = new Float32Array(N);

  for (let i = 0; i < N; i++) {
    const val = a * xs[i] + b * ys[i] + c * zs[i];
    out[i] = Number.isFinite(val) ? val : 0;
  }

  return out;
}

function cpuRankTopK(scores, k) {
  if (!(scores instanceof Float32Array)) {
    throw new Error('Scores must be Float32Array');
  }

  if (!Number.isInteger(k) || k < 1) {
    throw new Error('k must be a positive integer');
  }

  const N = scores.length;
  const effectiveK = Math.min(k, N);

  const indices = Array.from({ length: N }, (_, i) => i);
  indices.sort((a, b) => scores[b] - scores[a]);

  return indices.slice(0, effectiveK);
}

function cpuSoftmax(input) {
  if (!(input instanceof Float32Array)) {
    throw new Error('Input must be Float32Array');
  }

  if (input.length === 0) {
    return new Float32Array(0);
  }

  const N = input.length;
  const output = new Float32Array(N);

  let maxVal = input[0];
  for (let i = 1; i < N; i++) {
    if (input[i] > maxVal) maxVal = input[i];
  }

  let sum = 0;
  for (let i = 0; i < N; i++) {
    output[i] = Math.exp(input[i] - maxVal);
    sum += output[i];
  }

  if (sum === 0) sum = 1e-6;
  for (let i = 0; i < N; i++) {
    output[i] /= sum;
  }

  return output;
}

function loadNativeAddon() {
  const candidates = [
    './cuda/metabolismAddon',
    './metabolismAddon.original'
  ];

  for (const candidate of candidates) {
    try {
      // eslint-disable-next-line import/no-dynamic-require, global-require
      const maybeModule = require(candidate);
      if (typeof maybeModule === 'function') {
        const instance = new maybeModule();
        if (instance && typeof instance.scoreBatch === 'function' && typeof instance.rankTopK === 'function' && typeof instance.softmax === 'function') {
          logger.info({ candidate }, 'Metabolism native addon loaded');
          return instance;
        }
      }
    } catch (err) {
      logger.warn({ err: err.message, candidate }, 'Metabolism native addon candidate failed to load');
    }
  }

  logger.warn('No metabolism native addon available; using CPU fallback');
  return null;
}

class MetabolismAddon {
  constructor() {
    this.nativeAddon = loadNativeAddon();
    this.fallbackMode = !this.nativeAddon;
    this.loaded = true;

    this._safeScoreBatch = gpuGuard.withFallback(
      (a, b, c, xs, ys, zs) => {
        if (!this.nativeAddon) {
          throw new Error('Native addon unavailable');
        }
        return this.nativeAddon.scoreBatch(a, b, c, xs, ys, zs);
      },
      (a, b, c, xs, ys, zs) => cpuScoreBatch(a, b, c, xs, ys, zs),
      { name: 'metabolism.scoreBatch', timeout: 4000, retries: 2 }
    );

    this._safeRankTopK = gpuGuard.withFallback(
      (scores, k) => {
        if (!this.nativeAddon) {
          throw new Error('Native addon unavailable');
        }
        return this.nativeAddon.rankTopK(scores, k);
      },
      (scores, k) => cpuRankTopK(scores, k),
      { name: 'metabolism.rankTopK', timeout: 4000, retries: 2 }
    );

    this._safeSoftmax = gpuGuard.withFallback(
      (input) => {
        if (!this.nativeAddon) {
          throw new Error('Native addon unavailable');
        }
        return this.nativeAddon.softmax(input);
      },
      (input) => cpuSoftmax(input),
      { name: 'metabolism.softmax', timeout: 4000, retries: 2 }
    );
  }

  /**
   * Synchronous-compatible API for existing callers.
   * Internally starts guarded execution and returns CPU fallback immediately.
   */
  scoreBatch(a, b, c, xs, ys, zs) {
    // fire-and-forget guarded attempt for telemetry/fallback tracking
    this._safeScoreBatch(a, b, c, xs, ys, zs).catch((err) => {
      logger.warn({ err: err.message }, 'Guarded scoreBatch failed, CPU fallback already returned');
    });

    return cpuScoreBatch(a, b, c, xs, ys, zs);
  }

  rankTopK(scores, k) {
    this._safeRankTopK(scores, k).catch((err) => {
      logger.warn({ err: err.message }, 'Guarded rankTopK failed, CPU fallback already returned');
    });

    return cpuRankTopK(scores, k);
  }

  softmax(input) {
    this._safeSoftmax(input).catch((err) => {
      logger.warn({ err: err.message }, 'Guarded softmax failed, CPU fallback already returned');
    });

    return cpuSoftmax(input);
  }

  isGpuAvailable() {
    return gpuGuard.gpuAvailable === true;
  }
}

module.exports = MetabolismAddon;
