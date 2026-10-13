// Offline draft validation only. No runner, persistence, networking or authority.
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const PERMISSIONS = ['network', 'dispatch', 'canonicalResearch', 'paperOrders', 'liveOrders'];
const REGIMES = new Set(['BULL', 'BEAR', 'RANGE', 'HYBRID', 'STRESS']);
const INSTRUMENTS = new Set(['SPOT', 'PERPETUAL', 'MULTI_LEG', 'EVENT_STUDY', 'ALLOCATOR']);
const DEFAULTS = Object.freeze({startingEquityEUR:10000,maxFuturesLeverage:10,spotLeverage:1,riskPerTradePct:0.25,maxRiskPerTradePct:0.5,maxOpenRiskPct:0.75,maxClusterRiskPct:0.5,maxGrossExposure:1.5,maxDailyLossPct:2,maxWeeklyLossPct:4,maxDrawdownPct:10});
// Exact configuration contract only: deliberately not a trade payoff evaluator.
const PAYOFF_POLICY = {
  policyId:'PLANNED_NET_CRV_MIN_3_V1', scope:'ALL_NEW_CANDIDATE_TRADES',
  minimumPlannedNetRewardRisk:3, rewardBasis:'CONSERVATIVE_NET_TARGET_OUTCOME',
  riskBasis:'POSITIVE_FINITE_CONSERVATIVE_NET_STOP_LOSS',
  costs:{entry:'BOTH_TARGET_AND_STOP_OUTCOMES',exit:'SCENARIO_SPECIFIC_TARGET_AND_STOP',
    spread:'BOTH_TARGET_AND_STOP_OUTCOMES',slippage:'CONSERVATIVE_SCENARIO_SPECIFIC',
    fundingAndBorrow:'ADVERSE_HOLDING_HORIZON_BOUND',allLegs:true,unknownCosts:'REJECT'},
  partialExits:'QUANTITY_WEIGHTED_ALL_EXITS_INCLUDING_DECLARED_RESIDUAL',
  undeclaredResidual:'REJECT',unknownOrUnboundedRisk:'REJECT',stopRelocationToQualify:'FORBIDDEN',
  unsupportedFinitePayoff:'RESEARCH_ONLY',exemptions:[],frozenReferenceTreatment:'UNCHANGED_OUT_OF_SCOPE',
  evaluationStage:'DRAFT_CONTRACT_ONLY',runtimeEnforcementImplemented:false
};
function exactContract(value, expected) {
  if (Array.isArray(expected)) return Array.isArray(value) && value.length === expected.length && expected.every((item,index) => exactContract(value[index],item));
  if (object(expected)) return object(value) && Object.keys(value).length === Object.keys(expected).length && Object.entries(expected).every(([key,item]) => Object.hasOwn(value,key) && exactContract(value[key],item));
  return value === expected;
}

export function validateCampaignDraft(input) {
  const errors = [];
  const check = (condition, message) => { if (!condition) errors.push(message); };
  const result = () => ({valid:errors.length === 0,errors,executionAuthorized:false,phase:'DRAFT_ONLY'});
  if (!object(input)) { errors.push('campaign must be an object'); return result(); }
  check(input.schemaVersion === 'MERIDIAN_STRATEGY_CAMPAIGN_DRAFT_V1', 'unsupported schemaVersion');
  check(input.campaignId === 'paper-strategy-lab-20261013', 'unexpected campaignId');
  check(input.status === 'DRAFT' && input.sourceOnly === true, 'only source-only DRAFT is supported');
  check(exactContract(input.payoffPolicy,PAYOFF_POLICY), 'payoffPolicy must preserve the exact planned net CRV >=3 draft contract');
  check(object(input.permissions), 'permissions must be explicit');
  for (const key of PERMISSIONS) check(input.permissions?.[key] === false, `permission ${key} must be false`);
  if (object(input.permissions)) for (const key of Object.keys(input.permissions)) check(PERMISSIONS.includes(key), `unknown permission ${key}`);
  const limits = {maxFamilies:12,maxVariantsPerFamily:3,maxCandidates:36,maxFinalists:3};
  for (const [key,value] of Object.entries(limits)) check(input.budget?.[key] === value, `budget ${key} must equal ${value}`);
  for (const [key,value] of Object.entries(DEFAULTS)) check(input.defaults?.[key] === value, `default ${key} must equal ${value}`);
  const refs = input.frozenReferences;
  check(Array.isArray(refs) && refs.length === 1, 'exactly one frozen reference is expected');
  check(refs?.[0]?.ruleset === 'LOW-VOLATILITY-RANK-WEIGHTED-V2-FROZEN' && refs?.[0]?.mutable === false, 'frozen Lowvol reference must remain immutable');
  const families = input.families;
  if (!Array.isArray(families)) { errors.push('families must be an array'); return result(); }
  check(families.length === 12, 'campaign requires twelve hypothesis cards');
  const ids = new Set(), priorities = new Set();
  for (const [index, family] of families.entries()) {
    const label = `family[${index}]`;
    if (!object(family)) { errors.push(`${label} must be an object`); continue; }
    check(typeof family.id === 'string' && /^H(?:[1-9]|1[0-2])$/.test(family.id), `${label} has invalid id`);
    check(!ids.has(family.id), `${label} duplicates an id`); ids.add(family.id);
    check(text(family.name) && text(family.hypothesis), `${label} needs name and hypothesis`);
    check(family.status === 'DRAFT', `${label} must remain DRAFT`);
    check(family.payoffPolicyId === PAYOFF_POLICY.policyId && family.payoffReadiness === 'RESEARCH_ONLY_PAYOFF_UNVERIFIED', `${label} must inherit net CRV policy and remain payoff-unverified research only`);
    check(Number.isInteger(family.priority) && family.priority >= 1 && family.priority <= 12 && !priorities.has(family.priority), `${label} priority must be unique in 1..12`);
    priorities.add(family.priority);
    check(INSTRUMENTS.has(family.instrument), `${label} has unsupported instrument`);
    check(Array.isArray(family.regimes) && family.regimes.length > 0 && family.regimes.every(x => REGIMES.has(x)) && new Set(family.regimes).size === family.regimes.length, `${label} needs unique valid regimes`);
    check(Array.isArray(family.prerequisites) && family.prerequisites.length > 0 && family.prerequisites.every(text), `${label} needs explicit prerequisites`);
    // A hypothesis card is not a tested candidate. Runtime variant registration
    // requires a separately reviewed contract, including the actual data split.
    check(Array.isArray(family.variants) && family.variants.length === 0, `${label} cannot contain executable or evaluated variants in this draft`);
  }
  return result();
}
