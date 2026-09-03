import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { evaluateResearchGate } from '../research-gate-v770.js';

test('v7.70 selects 0.25% risk and keeps promotion disabled', () => {
  const candlePath = JSON.parse(fs.readFileSync(new URL('../research/candle-path-evidence-v769.json', import.meta.url)));
  const challengerEvidence = { summary: { avgRBetterPeriods: 4, periods: 4, equalCoverage: true } };
  const out = evaluateResearchGate({ candlePath, challengerEvidence });
  assert.equal(out.preferredRisk, 'risk_0.25');
  assert.equal(out.risks['risk_0.25'].lowerAdversePeriods, 4);
  assert.equal(out.risks['risk_0.50'].lowerAdversePeriods, 2);
  assert.equal(out.readyForProspectiveShadow, true);
  assert.equal(out.promotionAllowed, false);
  assert.equal(out.nextRequiredEvidence, 'SIDE_REGIME_ATTRIBUTION');
});
