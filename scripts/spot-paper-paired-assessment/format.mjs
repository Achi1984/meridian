import {projectSpotPaperPairedDashboard} from '../spot-paper-paired-report/contract.mjs';

const ROLES = ['baseline', 'challenger', 'cash'];
const NOT_REPORTED = 'NOT_REPORTED_BY_REPORT_SCHEMA';

function metric(arm, name) {
  return {
    value: arm[name],
    reason: arm.metricReasons[name] ?? (arm[name] === null ? 'UNKNOWN' : null)
  };
}

function createSummary(dto) {
  const dashboard = projectSpotPaperPairedDashboard(dto);
  if (!dashboard) throw new TypeError('PAIRED_DASHBOARD_INVALID');

  return {
    evidence: {
      status: dashboard.evidenceStatus,
      qualification: dashboard.evidenceQualification,
      reasonCode: dashboard.reasonCode,
      syntheticFixture: dashboard.syntheticFixture,
      independentAuthentication: dashboard.independentAuthentication
    },
    identity: dashboard.identity,
    timing: dashboard.timing,
    assumptions: dashboard.assumptions,
    activityDiagnostic: dashboard.trendActivityDiagnostic ?? null,
    comparison: {
      status: dashboard.deltas.status,
      reason: dashboard.deltas.reason,
      decision: dashboard.decision
    },
    arms: Object.fromEntries(ROLES.map(role => {
      const arm = dashboard.arms[role];
      return [role, {
        modelId: arm.modelId,
        netPnlCents: metric(arm, 'netPnlCents'),
        bookedFeesCents: metric(arm, 'bookedFeesCents'),
        modeledSlippageCents: metric(arm, 'modeledSlippageCents'),
        sampledDrawdownCents: metric(arm, 'sampledDrawdownCents'),
        relativeDrawdownBps: metric(arm, 'relativeDrawdownBps'),
        fillCount: metric(arm, 'fillCount'),
        roundTripCount: {value: null, reason: NOT_REPORTED},
        exposureCents: metric(arm, 'exposureCents'),
        inventoryStatus: arm.inventoryStatus,
        noTradeReason: {value: null, reason: NOT_REPORTED}
      }];
    }))
  };
}

function euro(cents) {
  if (cents === null) return 'unbekannt';
  const amount = BigInt(cents);
  const sign = amount < 0n ? '−' : '';
  const absolute = amount < 0n ? -amount : amount;
  const euros = (absolute / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const fraction = (absolute % 100n).toString().padStart(2, '0');
  return `${sign}${euros},${fraction} EUR`;
}

function value(metricValue, format) {
  return metricValue.value === null ?
    `unbekannt (${metricValue.reason ?? 'UNKNOWN'})` :
    format(metricValue.value);
}

function markdown(summary) {
  const {evidence, identity, timing, assumptions, activityDiagnostic,
    comparison, arms} = summary;
  const lines = [
    '# Gepaarte Paper-Auswertung',
    '',
    `- Evidenz: **${evidence.status}**; ${evidence.qualification}`,
    `- Grundcode: ${evidence.reasonCode}; synthetisch: ${evidence.syntheticFixture ? 'ja' : 'nein'}; unabhängige Authentifizierung: ${evidence.independentAuthentication}`,
    `- Identität: Lauf ${identity.runId}, Markt ${identity.pair}; Baseline ${identity.models[0].modelId}; Challenger ${identity.models[1].modelId}; Cash ${identity.models[2].modelId}`,
    `- Dauer: angefordert ${timing.requestedDurationMs} ms; tatsächlich ${timing.actualElapsedMs ?? 'unbekannt'} ms; Abdeckung ${timing.observedCoverageMs ?? 'unbekannt'} ms; Zyklen abgeschlossen/versucht ${timing.completedCycles ?? 'unbekannt'}/${timing.attemptedCycles ?? 'unbekannt'}; Stoppgrund ${timing.stopReason}`,
    `- Gemeinsamer Horizont: ${timing.commonHorizonAvailable === undefined ? 'nicht im DTO berichtet' : timing.commonHorizonAvailable ? 'verfügbar' : 'nicht verfügbar'}${timing.commonHorizonReason ? ` (${timing.commonHorizonReason})` : ''}; Vergleich ${comparison.status}${comparison.reason ? ` (${comparison.reason})` : ''}`,
    `- Kostenannahmen je Seite: Gebühr ${assumptions.feeBpsPerSide} bp, Slippage ${assumptions.slippageBpsPerSide} bp; Sätze verifiziert: ${assumptions.ratesVerified ? 'ja' : 'nein'}`,
    '',
    '| Arm | Netto-PnL | Gebühren | modellierte Slippage | Drawdown | relativer Drawdown | Fills | Roundtrips | Exposure | Positionen | Grund bei null Fills |',
    '|---|---:|---:|---:|---:|---:|---:|---|---:|---|---|'
  ];
  for (const role of ROLES) {
    const arm = arms[role];
    lines.push(`| ${role} | ${value(arm.netPnlCents, euro)} | ${value(arm.bookedFeesCents, euro)} | ${value(arm.modeledSlippageCents, euro)} | ${value(arm.sampledDrawdownCents, euro)} | ${value(arm.relativeDrawdownBps, bps => `${bps} bp`)} | ${value(arm.fillCount, count => String(count))} | unbekannt (${arm.roundTripCount.reason}) | ${value(arm.exposureCents, euro)} | ${arm.inventoryStatus} | unbekannt (${arm.noTradeReason.reason}) |`);
  }
  lines.push(
    '',
    `- Aktivitätsdiagnose: ${activityDiagnostic ? `${activityDiagnostic.status}; ${activityDiagnostic.completedRoundTripCount} abgeschlossene Roundtrips im Diagnosefeld; Abdeckung ${activityDiagnostic.observedCoverageMs}/${activityDiagnostic.requiredCoverageMs} ms; Profitabilität ${activityDiagnostic.profitability}` : 'nicht berichtet'}. Dieser Diagnosewert ersetzt keine Roundtrip-Zählung je Arm.`,
    '- Netto-PnL wird unverändert aus dem DTO übernommen; Gebühren oder Slippage werden nicht erneut abgezogen.',
    '- Keine Gewinner-, Profitabilitäts-, Live- oder Handelsabstinenz-Aussage. Fills sind keine Roundtrips; nicht berichtete Werte bleiben unbekannt.'
  );
  return `${lines.join('\n')}\n`;
}

export function createSpotPaperPairedAssessmentSummary(dto) {
  return createSummary(dto);
}

export function formatSpotPaperPairedAssessment(dto, format = 'markdown') {
  const summary = createSummary(dto);
  if (format === 'json') return `${JSON.stringify(summary, null, 2)}\n`;
  if (format === 'markdown') return markdown(summary);
  throw new TypeError('ASSESSMENT_FORMAT_INVALID');
}
