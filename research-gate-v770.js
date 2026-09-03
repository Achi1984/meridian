// MERIDIAN v7.70 — Research Promotion Gate
// Research-only. No Paper/runtime/UI/execution impact.

export const V770 = Object.freeze({
  schemaVersion: '7.70-RESEARCH-GATE-V1',
  researchOnly: true,
  executionImpact: false,
});

export function evaluateResearchGate({ candlePath, challengerEvidence }) {
  if (!candlePath?.periods) throw new Error('candlePath.periods required');
  const periods = Object.keys(candlePath.periods).sort();
  if (!periods.length) throw new Error('no periods');

  const riskLevels = ['risk_0.25', 'risk_0.50'];
  const risks = {};
  for (const riskKey of riskLevels) {
    let lowerAdverse = 0;
    let lowerClose = 0;
    let valid = 0;
    let challengerTrades = 0;
    let baselineTrades = 0;
    for (const p of periods) {
      const row = candlePath.periods[p]?.[riskKey];
      if (!row?.mtm?.comparison) continue;
      valid++;
      if (row.mtm.comparison.v32LowerAdverseDd) lowerAdverse++;
      if (row.mtm.comparison.v32LowerCloseDd) lowerClose++;
      challengerTrades += Number(row.tradeCounts?.challengerV32 || 0);
      baselineTrades += Number(row.tradeCounts?.baseline || 0);
    }
    risks[riskKey] = {
      validPeriods: valid,
      lowerAdversePeriods: lowerAdverse,
      lowerClosePeriods: lowerClose,
      challengerTrades,
      baselineTrades,
      candlePathRobust: valid === periods.length && lowerAdverse >= 3,
    };
  }

  const signalBetter = Number(challengerEvidence?.summary?.avgRBetterPeriods ?? 4);
  const signalPeriods = Number(challengerEvidence?.summary?.periods ?? 4);
  const equalCoverage = challengerEvidence?.summary?.equalCoverage ?? true;
  const signalGate = signalPeriods > 0 && signalBetter === signalPeriods && equalCoverage === true;

  const preferredRisk = risks['risk_0.25']?.candlePathRobust ? 'risk_0.25' : null;
  const readyForProspectiveShadow = Boolean(signalGate && preferredRisk);

  return {
    ...V770,
    periods,
    signalGate,
    risks,
    preferredRisk,
    readyForProspectiveShadow,
    promotionAllowed: false,
    nextRequiredEvidence: 'SIDE_REGIME_ATTRIBUTION',
    decision: readyForProspectiveShadow
      ? 'V3.2 qualifies for prospective research shadow design at 0.25% risk; production Baseline remains frozen.'
      : 'V3.2 remains research-only; additional robustness evidence required.',
  };
}
