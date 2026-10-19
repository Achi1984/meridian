export const MAX_HISTORICAL_FIXTURE_BYTES = 1_048_576;

const SCHEMA = 'MERIDIAN_B1_HISTORICAL_UI_FIXTURE_V1';
const PROFILE = 'MERIDIAN-B1-7-HISTORICAL-ONE-SHOT-R1';
const JOB_KEYS = [
  'trialId','trialKey','state','attempts','owner','fence','profile','protocolSha256','sourceSha256',
  'dataSha256','manifestSha256','pathIds','computationPathIds','timestamps','paths','controls',
  'controlBindings','result','resultSha256','summarySha256','reason','unresolved',
  'executionAuthorized','promotionAuthorized','profitabilityInferred'
];
const RESULT_KEYS = [
  'attemptedPaths','authority','budget','completedPaths','computedPaths','controlRealization','evidence',
  'executionId','failure','identity','implementationId','implementationSha256','plannedPaths',
  'protocolId','protocolReview','protocolSha256','schema','screen','status','controlDefinitions','paths'
];
const RESULT_PROPERTY_KEYS = new Set([
  ...RESULT_KEYS, ...JOB_KEYS, 'pathId','kind','variantId','scenarioId','segmentId','status','attempts',
  'computed','rows','dailyReturnCount','dailyReturns','dailyHeldTarget','quarterlyReturns','quarter','netReturn',
  'dailyReturnSd','startEquity','endEquity','turnoverNotional','turnoverOnInitialEquity','meanHeldTarget',
  'meanRealizedExposure','meanTargetRealizedMismatch','meanAbsoluteTargetMismatch','maxAbsoluteTargetMismatch',
  'maxConcentration','maxDrawdownDuration','sampledDrawdown','totalCosts','targetExposure','fillCosts',
  'fillCostCount','date','kind','turnover','cost','cumulativeCost','equityAfterFees','cashAfterFees',
  'conservationResidual','cancelledInstructions','cancelledInstructionCount','decisionIndex','fillIndex','target',
  'decisionTimestamp','reason','observationClass','diagnosticRescaling','tradeCRV','value','promotionEligible',
  'researchOnly','strategyPnlAuthorized','discoveryAuthorized','validationAuthorized','holdoutAuthorized',
  'paperAuthorized','liveAuthorized','limits','paths','pathMs','totalMs','outputBytes','attemptsPerPath',
  'attemptsPerStartedPath','automaticRetry','interpretation','comparisonSegment','neighbourStressScenario',
  'checks','primaryDiagnosticNetPositive','primaryDiagnosticDrawdownAtMost25Percent',
  'primaryReturnAtLeastBothFrozenControls','primaryDrawdownAtMostBothFrozenControls',
  'relativeDrawdownReductionAtLeast20Percent','primaryNetPositiveAt30bpNonDelayed',
  'primaryNetPositiveAt30bpPlusDelay','atLeastThreeOfFourNeighboursPositiveAt15bp',
  'atLeastThreeOfFourNeighboursPositiveAt30bpNonDelayed','neighbourPositiveCounts','base15bp','stress30bp',
  'stopPolicy','survivorship','historyLabel','candidateInterpretation','costModel','executionEvidence',
  'sourceAuthenticity','syntheticFixture','priceSource','holdoutClaim','trialLedger','stoppedPolicy','crv',
  'identity','datasetKind','sourceCommit','sourceProvenance','canonicalSeriesSha256','inputSha256',
  'normalizedFileSha256','syntheticFixtureSeriesSha256','XBTUSD','ETHUSD','SOLUSD','XRPUSD','LINKUSD','AVAXUSD',
  'SUIUSD','protocolReview','r1RequestId','r1ResponseComment','r1Verdict','r2RequestId',
  'r2ResponseComment','r2Verdict','r2Scope','r3Review','executionId','implementationId','protocolId',
  'pathId','variantId','scenarioId','segmentId','frozenTargetExposure','meanRealizedExposure',
  'meanTargetRealizedMismatch','meanAbsoluteTargetMismatch','maxAbsoluteTargetMismatch','diagnosticRescaling',
  'failure','NOT_RUN_INSUFFICIENT_EVIDENCE','FULL_BASKET','FIXED_CONTROL','CASH','CANDIDATE',
  'COMPLETED','INSUFFICIENT_EVIDENCE','NOT_RUN_INSUFFICIENT_EVIDENCE','FROZEN_DEVELOPMENT_ONLY',
  'UNDEFINED_NO_FINITE_STOP','researchOnly','meanExposure','riskExposure','primaryDevelopmentSd',
  'fullBasketDevelopmentSd','calibration',
  'ok','primarySd','benchmarkSd','ordinal','phase','startedAt','completedAt','payloadSha256'
]);
const HASH = /^[a-f0-9]{64}$/;
const STATES = new Set(['queued','unknown','completed','rejected','failed','timed_out','partial']);
const invalid = () => ({
  status:'INVALID',
  message:'Historische UI-Fixture abgelehnt · Format, Identität oder Status widersprüchlich.'
});
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => record(value) && Object.keys(value).length === keys.length &&
  keys.every(key => Object.hasOwn(value,key));
const hash = value => typeof value === 'string' && HASH.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const stamp = value => value === null || typeof value === 'string' && value.length <= 64 &&
  /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value.slice(0,10)).toISOString().slice(0,10) === value.slice(0,10);

function boundedJson(value, depth=0, budget={nodes:0}) {
  if (depth > 12 || ++budget.nodes > 50_000) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return value.length <= 4096;
  if (Array.isArray(value)) {
    return value.length <= 1000 && value.every(item => boundedJson(item,depth+1,budget));
  }
  if (!record(value) || Object.keys(value).some(key =>
    key.length > 80 || !RESULT_PROPERTY_KEYS.has(key))) return false;
  return Object.values(value).every(item => boundedJson(item,depth+1,budget));
}

function parseSerialized(text, limit, keys) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > limit) return null;
  try {
    const value = JSON.parse(text);
    return boundedJson(value) && exact(value,keys) ? value : null;
  } catch {
    return null;
  }
}

function validControls(text, progress) {
  if (text === null) return null;
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > 8192 ||
      progress.length < 19 || progress.slice(0,18).some(item => item.state !== 'completed')) return null;
  let controls;
  try { controls = JSON.parse(text); } catch { return null; }
  if (!boundedJson(controls) || !record(controls)) return null;
  if (controls.status === 'FROZEN_DEVELOPMENT_ONLY') {
    const keys = ['status','meanExposure','riskExposure','primaryDevelopmentSd','fullBasketDevelopmentSd','calibration'];
    if (!exact(controls,keys) || controls.calibration !==
        'DEVELOPMENT_15BP_DAILY_NET_RETURNS_AND_HELD_TARGETS' ||
        !['meanExposure','riskExposure','primaryDevelopmentSd','fullBasketDevelopmentSd']
          .every(key => Number.isFinite(controls[key])) ||
        !['meanExposure','riskExposure'].every(key => controls[key] >= 0 && controls[key] <= 1) ||
        progress[18].state !== 'completed') return null;
  } else if (controls.status === 'INSUFFICIENT_EVIDENCE') {
    const keys = ['ok','status','reason','primarySd','benchmarkSd'];
    if (!exact(controls,keys) || controls.ok !== false ||
        controls.reason !== 'INVALID_OR_ZERO_DEVELOPMENT_RISK_DENOMINATOR' ||
        !['primarySd','benchmarkSd'].every(key =>
          controls[key] === null || Number.isFinite(controls[key]))) return null;
  } else return null;
  return controls;
}

function validateResult(text, job, controls) {
  if (text === null) return null;
  const result = parseSerialized(text,MAX_HISTORICAL_FIXTURE_BYTES,RESULT_KEYS);
  if (!result || result.schema !== 'MERIDIAN_B1_7_ENGINE_RESULT_R3' ||
      !['COMPLETED','INSUFFICIENT_EVIDENCE'].includes(result.status) ||
      result.plannedPaths !== 44 || !Array.isArray(result.paths) || result.paths.length !== 44 ||
      !record(result.controlDefinitions) || !record(result.authority) ||
      !exact(result.authority,['researchOnly','executionAuthorized','strategyPnlAuthorized',
        'discoveryAuthorized','validationAuthorized','holdoutAuthorized','paperAuthorized','liveAuthorized']) ||
      result.authority.researchOnly !== true ||
      Object.entries(result.authority).some(([key,value]) => key !== 'researchOnly' && value !== false)) return null;
  if (!['attemptedPaths','completedPaths','computedPaths'].every(key => integer(result[key]) && result[key] <= 44) ||
      result.attemptedPaths !== result.completedPaths || result.completedPaths !== result.computedPaths) return null;
  if (result.status === 'COMPLETED' &&
      (result.attemptedPaths !== 44 || job.state !== 'completed')) return null;
  if (result.status === 'INSUFFICIENT_EVIDENCE' && ![19,44].includes(result.completedPaths)) return null;
  if (result.controlDefinitions.status !== controls?.status) return null;

  const progressById = new Map(job.paths.map(item => [item.pathId,item]));
  const seen = new Set();
  for (let index=0; index<result.paths.length; index++) {
    const path = result.paths[index];
    if (!record(path) || !hash(path.pathId) || path.pathId !== job.pathIds[index] || seen.has(path.pathId)) return null;
    seen.add(path.pathId);
    if (path.status === 'COMPLETED') {
      if (path.computed !== true || progressById.get(path.pathId)?.state !== 'completed') return null;
    } else if (path.status === 'NOT_RUN_INSUFFICIENT_EVIDENCE') {
      if (result.status !== 'INSUFFICIENT_EVIDENCE' || path.computed !== false ||
          path.attempts !== 0 || progressById.has(path.pathId)) return null;
    } else return null;
  }
  if (result.completedPaths !== job.paths.filter(item => item.state === 'completed').length) return null;
  if (result.status === 'COMPLETED' && result.paths.some(path => path.status !== 'COMPLETED')) return null;
  return result;
}

function validJob(job) {
  if (!exact(job,JOB_KEYS) || !hash(job.trialId) ||
      typeof job.trialKey !== 'string' || !/^trial-[a-z0-9][a-z0-9-]{0,47}$/.test(job.trialKey) ||
      !STATES.has(job.state) || !integer(job.attempts) || job.attempts > 1 ||
      !(job.owner === null || typeof job.owner === 'string' &&
        /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(job.owner)) ||
      !integer(job.fence) || job.profile !== PROFILE ||
      !['protocolSha256','sourceSha256','dataSha256','manifestSha256']
        .every(key => hash(job[key])) ||
      !Array.isArray(job.pathIds) || job.pathIds.length !== 44 ||
      !Array.isArray(job.computationPathIds) || job.computationPathIds.length !== 44 ||
      !job.pathIds.every(hash) || !job.computationPathIds.every(hash) ||
      new Set(job.pathIds).size !== 44 || new Set(job.computationPathIds).size !== 44 ||
      job.pathIds.some(id => !job.computationPathIds.includes(id)) ||
      !exact(job.timestamps,['createdAt','startedAt','finishedAt']) ||
      !Object.values(job.timestamps).every(stamp) || job.timestamps.createdAt === null ||
      !Array.isArray(job.paths) || job.paths.length > 44 ||
      !(job.reason === null || typeof job.reason === 'string' && job.reason.length <= 256) ||
      typeof job.unresolved !== 'boolean' ||
      job.executionAuthorized !== false || job.promotionAuthorized !== false ||
      job.profitabilityInferred !== false) return null;

  for (let index=0; index<job.paths.length; index++) {
    const item = job.paths[index];
    const completed = item?.state === 'completed';
    const keys = completed
      ? ['pathId','ordinal','phase','state','startedAt','payloadSha256','completedAt']
      : ['pathId','ordinal','phase','state','startedAt'];
    if (!exact(item,keys) || item.pathId !== job.computationPathIds[index] ||
        item.ordinal !== index+1 || item.phase !== (index < 19 ? 'DEVELOPMENT' : 'DIAGNOSTIC') ||
        !['started','completed'].includes(item.state) || !stamp(item.startedAt) ||
        item.startedAt === null ||
        (completed && (!hash(item.payloadSha256) || !stamp(item.completedAt) ||
          item.completedAt === null || Date.parse(item.completedAt) < Date.parse(item.startedAt))) ||
        (!completed && index !== job.paths.length-1)) return null;
  }

  const notAttempted = ['queued','rejected'].includes(job.state);
  if (job.attempts !== (notAttempted ? 0 : 1) ||
      job.fence === 0 !== notAttempted ||
      (notAttempted ? job.owner !== null : job.owner === null) ||
      (job.unresolved && job.state !== 'unknown') ||
      (job.state === 'unknown' && job.unresolved !== (job.timestamps.finishedAt === null)) ||
      (job.unresolved && (job.timestamps.finishedAt !== null || job.result !== null)) ||
      (job.state === 'queued' && (job.paths.length !== 0 || job.timestamps.startedAt !== null ||
        job.timestamps.finishedAt !== null)) ||
      (job.state === 'rejected' && job.timestamps.finishedAt === null) ||
      (job.state === 'completed' && (job.paths.length !== 44 ||
        job.paths.some(item => item.state !== 'completed') || job.timestamps.startedAt === null ||
        job.timestamps.finishedAt === null)) ||
      (['failed','timed_out','partial'].includes(job.state) && job.timestamps.finishedAt === null) ||
      (job.paths.length > 0 && job.timestamps.startedAt === null)) return null;
  const {createdAt,startedAt,finishedAt} = job.timestamps;
  if (startedAt !== null && Date.parse(startedAt) < Date.parse(createdAt) ||
      finishedAt !== null && Date.parse(finishedAt) < Date.parse(startedAt ?? createdAt)) return null;

  const noResult = job.result === null;
  if ((job.resultSha256 === null) !== noResult || (job.summarySha256 === null) !== noResult ||
      (!noResult && (!hash(job.resultSha256) || !hash(job.summarySha256))) ||
      (job.state === 'completed' && noResult) ||
      (notAttempted && !noResult)) return null;
  if ((job.controls === null) !== (job.controlBindings === null)) return null;
  let controls = null;
  if (job.controls !== null) {
    controls = validControls(job.controls,job.paths);
    if (!controls || !exact(job.controlBindings,['primaryDevelopmentSha256','fullBasketDevelopmentSha256']) ||
        !hash(job.controlBindings.primaryDevelopmentSha256) ||
        !hash(job.controlBindings.fullBasketDevelopmentSha256)) return null;
  }
  const result = validateResult(job.result,job,controls);
  if (job.result !== null && (!result ||
      (job.state === 'completed' && result.completedPaths !== 44) ||
      (result.status === 'INSUFFICIENT_EVIDENCE' &&
        result.completedPaths !== job.paths.filter(item => item.state === 'completed').length))) return null;
  if (job.result === null && job.state === 'completed') return null;
  return {controls,result};
}

export function parseArenaHistoricalResultFixture(text) {
  if (typeof text !== 'string') return invalid();
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > MAX_HISTORICAL_FIXTURE_BYTES) return invalid();
  let value;
  try { value = JSON.parse(text); } catch { return invalid(); }
  if (!exact(value,['schema','evidenceClass','purpose','job']) ||
      value.schema !== SCHEMA || value.evidenceClass !== 'SYNTHETIC_ONLY' ||
      value.purpose !== 'UI_FIXTURE_NOT_PRODUCER_EXPORT') return invalid();
  const projection = validJob(value.job);
  if (!projection) return invalid();
  return {
    status:'PRESENT_UNVERIFIED',
    message:'Synthetische UI-Fixture · keine Echtheits-, Zulassungs- oder Berechtigungsbestätigung.',
    job:value.job,
    result:projection.result
  };
}
