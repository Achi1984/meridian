import {isSpotPaperThreeWayDashboardEnvelope} from '../scripts/spot-paper-research/three-way-dashboard-contract.mjs?v=B20-M11-FIX3';

const MAX_REPORT_BYTES = 64 * 1024 * 1024;

export function createOfflineThreeWayReportReader({readText, maxBytes = MAX_REPORT_BYTES} = {}) {
  if (typeof readText !== 'function') throw new TypeError('readText must be an injected local reader');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_REPORT_BYTES) {
    throw new RangeError('maxBytes must be a bounded offline input limit');
  }
  return Object.freeze({
    async readReport() {
      let raw;
      try { raw = await readText(); } catch { return null; }
      if (typeof raw !== 'string') return null;
      if (new TextEncoder().encode(raw).byteLength > maxBytes) return null;
      let envelope;
      try { envelope = JSON.parse(raw); } catch { return null; }
      return isSpotPaperThreeWayDashboardEnvelope(envelope) ? envelope : null;
    }
  });
}
