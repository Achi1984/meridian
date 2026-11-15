import {SPOT_PAPER_RESEARCH_LIMITS} from '../scripts/spot-paper-research/three-way-comparison.mjs';
import {isSpotPaperThreeWayDashboardEnvelope} from '../scripts/spot-paper-research/three-way-dashboard-contract.mjs';

export function createOfflineThreeWayReportReader({readText, maxBytes = SPOT_PAPER_RESEARCH_LIMITS.maxInputBytes} = {}) {
  if (typeof readText !== 'function') throw new TypeError('readText must be an injected local reader');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > SPOT_PAPER_RESEARCH_LIMITS.maxInputBytes) {
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
