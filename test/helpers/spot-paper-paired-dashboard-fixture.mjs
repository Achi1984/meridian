import {
  createUnknownSpotPaperPairedDashboard,
  projectSpotPaperPairedDashboard,
  SPOT_PAPER_PAIRED_EXPECTED_IDENTITY_SCHEMA
} from '../../scripts/spot-paper-paired-report/contract.mjs';

export function syntheticExpectedPairedIdentity() {
  return {
    schemaVersion: SPOT_PAPER_PAIRED_EXPECTED_IDENTITY_SCHEMA,
    runId: 'paired-synthetic-test-only',
    pair: 'BTC/EUR',
    sourceSha256: '1'.repeat(64),
    configSha256: '2'.repeat(64),
    researchSourceSha256: '3'.repeat(64),
    feedSourceId: 'SYNTHETIC_TEST_ONLY',
    comparisonEngineId: 'SYNTHETIC_TEST_ONLY',
    models: [
      {role: 'baseline', modelId: 'BTC_EUR_SMA5_SMA20_V1',
        accountId: 'baseline-test-account'},
      {role: 'challenger', modelId: 'BTC_EUR_RESEARCH_TEST_V1',
        accountId: 'challenger-test-account'},
      {role: 'cash', modelId: 'CASH_CONTROL_V1', accountId: 'cash-test-account'}
    ]
  };
}

export function syntheticPairedDashboard(identity = syntheticExpectedPairedIdentity()) {
  const report = createUnknownSpotPaperPairedDashboard('SYNTHETIC_TEST_ONLY');
  report.evidenceStatus = 'RUNNING_SNAPSHOT';
  report.reasonCode = 'SYNTHETIC_TEST_ONLY';
  report.syntheticFixture = true;
  report.identity = {
    runId: identity.runId,
    pair: identity.pair,
    sourceSha256: identity.sourceSha256,
    configSha256: identity.configSha256,
    researchSourceSha256: identity.researchSourceSha256,
    models: identity.models.map(({role, modelId}) => ({role, modelId}))
  };
  for (const model of identity.models) report.arms[model.role].modelId = model.modelId;
  return projectSpotPaperPairedDashboard(report);
}
