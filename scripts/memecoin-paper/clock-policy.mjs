// Admission mechanics only: neither an injected port nor a source label authenticates UTC.
export const CLOCK_POLICY_VERSION = "anchored-clock-v1";
const ID = /^[A-Za-z0-9._:-]{1,120}$/;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const utc = value => integer(value) && Number.isFinite(new Date(value).getTime());
function exact(value, keys) {
  return value && Object.getPrototypeOf(value) === Object.prototype &&
    Reflect.ownKeys(value).length === keys.length && keys.every(key => {
      const d = Object.getOwnPropertyDescriptor(value, key);
      return d && Object.hasOwn(d, "value") && d.enumerable;
    });
}
export function pinClockPolicy(value, startedAt) {
  const keys = ["version", "mode", "sourceId", "anchorUtcMs", "anchorMonotonicMs", "anchorUncertaintyMs", "maxAnchorUncertaintyMs", "maxSkewMs", "maxObservationGapMs"];
  if (!exact(value, keys) || value.version !== CLOCK_POLICY_VERSION ||
      !["synthetic", "external"].includes(value.mode) || typeof value.sourceId !== "string" ||
      !ID.test(value.sourceId) || !utc(value.anchorUtcMs) ||
      value.anchorUtcMs !== startedAt || !integer(value.anchorMonotonicMs) ||
      !integer(value.anchorUncertaintyMs) || !integer(value.maxAnchorUncertaintyMs) ||
      value.anchorUncertaintyMs > value.maxAnchorUncertaintyMs ||
      !integer(value.maxSkewMs) || !integer(value.maxObservationGapMs) || value.maxObservationGapMs === 0) {
    throw new TypeError("complete explicit anchored clock policy and bounded anchor are required");
  }
  return Object.freeze(Object.fromEntries(keys.map(key => [key, value[key]])));
}
export function normalizeClockSample(value) {
  if (!exact(value, ["sourceId", "mode", "wallUtcMs", "monotonicMs"]) ||
      typeof value.sourceId !== "string" || !ID.test(value.sourceId) ||
      !["synthetic", "external"].includes(value.mode) || !utc(value.wallUtcMs) || !integer(value.monotonicMs)) return null;
  return {sourceId: value.sourceId, mode: value.mode, wallUtcMs: value.wallUtcMs, monotonicMs: value.monotonicMs};
}
export function admitClock(policy, previousMonotonicMs, sample, requestedNow) {
  const reject = reason => ({status: "FAULT", reason, sample, effectiveUtcMs: null});
  if (!sample) return reject("CLOCK_SAMPLE_INVALID");
  if (sample.sourceId !== policy.sourceId || sample.mode !== policy.mode) return reject("CLOCK_SOURCE_MISMATCH");
  if (sample.monotonicMs < previousMonotonicMs || sample.monotonicMs < policy.anchorMonotonicMs) return reject("CLOCK_MONOTONIC_REGRESSION");
  if (sample.monotonicMs - previousMonotonicMs > policy.maxObservationGapMs) return reject("CLOCK_OBSERVATION_GAP");
  const effectiveUtcMs = policy.anchorUtcMs + (sample.monotonicMs - policy.anchorMonotonicMs);
  if (!utc(effectiveUtcMs)) return reject("CLOCK_TIME_OVERFLOW");
  if (Math.abs(sample.wallUtcMs - effectiveUtcMs) > policy.maxSkewMs) return reject("CLOCK_WALL_DIVERGENCE");
  if (requestedNow !== effectiveUtcMs) return reject("CLOCK_CALLER_TIME_MISMATCH");
  return {status: "ADMIT", reason: null, sample, effectiveUtcMs};
}
