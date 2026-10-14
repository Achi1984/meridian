import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validateCampaignDraft} from '../docs/strategy-lab/validate-campaign.mjs';

const source = JSON.parse(fs.readFileSync(new URL('../docs/strategy-lab/campaign-20261013.json', import.meta.url), 'utf8'));
const draft = () => structuredClone(source);
test('real campaign is a valid inert draft and is not an execution authorization', () => {
  assert.deepEqual(validateCampaignDraft(draft()), {valid:true,errors:[],executionAuthorized:false,phase:'DRAFT_ONLY'});
});
test('each authority flag must be explicitly false; unknown authority is rejected', () => {
  for (const key of Object.keys(source.permissions)) for (const value of [true, 'false', 0, null, undefined]) {
    const d=draft(); d.permissions[key]=value;
    assert.equal(validateCampaignDraft(d).valid,false,`${key}:${String(value)}`);
    assert.equal(validateCampaignDraft(d).executionAuthorized,false);
  }
  const d=draft(); d.permissions.allowOrders=false; assert.equal(validateCampaignDraft(d).valid,false);
});
test('capital, leverage and risk changes cannot silently reuse this draft contract', () => {
  for (const key of Object.keys(source.defaults)) {
    const d=draft(); d.defaults[key] *= 2; assert.equal(validateCampaignDraft(d).valid,false,key);
  }
});
test('budget inflation, duplicates and mutable legacy references are rejected', () => {
  const mutations=[d=>d.budget.maxCandidates=37,d=>d.budget.maxVariantsPerFamily=4,d=>d.budget.maxFinalists=4,d=>d.families[1].id=d.families[0].id,d=>d.families[1].priority=d.families[0].priority,d=>d.frozenReferences[0].mutable=true,d=>d.frozenReferences=[]];
  for (const mutate of mutations) { const d=draft();mutate(d);assert.equal(validateCampaignDraft(d).valid,false); }
});
test('adding a variant or claiming a later stage is never an implicit promotion', () => {
  for (const mutate of [d=>d.families[0].variants.push({status:'VALIDATED'}),d=>d.status='PAPER',d=>d.families[0].status='VALIDATED',d=>d.sourceOnly=false]) {
    const d=draft();mutate(d); const r=validateCampaignDraft(d);assert.equal(r.valid,false);assert.equal(r.executionAuthorized,false);
  }
});
test('incomplete cards, invalid data shapes and absent prerequisites fail closed', () => {
  for (const x of [null,[],true,'DRAFT',{}, {families:null}]) assert.equal(validateCampaignDraft(x).valid,false);
  for (const mutate of [d=>d.families.pop(),d=>d.families[0]=null,d=>d.families[0].prerequisites=[],d=>d.families[0].regimes=['MAGIC'],d=>d.families[0].instrument='LIVE']) {
    const d=draft();mutate(d);assert.equal(validateCampaignDraft(d).valid,false);
  }
});
test('validation does not mutate caller input or register variants', () => {
  const d=draft(), before=JSON.stringify(d);validateCampaignDraft(d);assert.equal(JSON.stringify(d),before);
});
test('JSON-shaped object and array identifiers are rejected without coercion', () => {
  for (const id of [{toString:1}, ['H1'], null, 1]) {
    const d=draft();d.families[0].id=id;
    assert.equal(validateCampaignDraft(d).valid,false);
  }
});
test('V2 replaces universal ratio policy and rejects changed or runtime contracts', () => {
  for (const change of [d=>d.schemaVersion='MERIDIAN_STRATEGY_CAMPAIGN_DRAFT_V1',d=>delete d.payoffPolicy,d=>d.payoffPolicy.universalMinimumRewardRisk=3,d=>d.payoffPolicy.runtimeEnforcementImplemented=true,d=>d.payoffPolicy.promotion='AUTOMATIC',d=>d.payoffPolicy.ratioTreatment='ACCEPT_ABOVE_3']) {
    const d=draft();change(d);const r=validateCampaignDraft(d);assert.equal(r.valid,false);assert.equal(r.executionAuthorized,false);
  }
});
test('time and rebalance designs need no invented finite target; event studies have no orders', () => {
  for (const [id,mode] of [['H1','TRAILING_OR_TIME'],['H7','REBALANCE'],['H12','REBALANCE'],['H2','EVENT_STUDY'],['H6','MULTI_LEG'],['H5','FIXED_TARGET']]) {
    const f=source.families.find(f=>f.id===id);assert.equal(f.payoffEvaluationMode,mode);
    assert.equal(f.prerequisites.some(p=>p.includes('finite payoff')||p.includes('>=3')),false);
  }
  assert.equal(source.payoffPolicy.universalMinimumRewardRisk,null);
  assert.match(source.payoffPolicy.evaluationModes.TRAILING_OR_TIME,/NO_INVENTED_FINITE_TARGET/);
  assert.match(source.payoffPolicy.evaluationModes.EVENT_STUDY,/NO_ORDERS/);
  assert.equal(validateCampaignDraft(draft()).valid,true);
});
test('legacy lower ratio is not universal rejection and high ratio never authorizes V2', async () => {
  const {evaluateTradePlan}=await import('../docs/strategy-lab/evaluate-trade-plan.mjs');
  for (const [target,qualifies] of [[120,false],[150,true]]) {
    const plan={schemaVersion:'MERIDIAN_LINEAR_TRADE_PLAN_V1',instrument:'LINEAR_SPOT',direction:'LONG',quantity:1,entryPrice:100,stopPrice:90,exits:[{price:target,portionBps:10000}],targetCosts:{fee:0,spread:0,slippage:0,fundingBorrow:0},stopCosts:{fee:0,spread:0,slippage:0,fundingBorrow:0}};
    const ratio=evaluateTradePlan(plan);assert.equal(ratio.valid,true);assert.equal(ratio.qualifiesPlannedCRV,qualifies);assert.equal(ratio.executionAuthorized,false);
    // Campaign does not consume a legacy scenario score or implicitly register a trial.
    const result=validateCampaignDraft(draft());assert.equal(result.valid,true);assert.equal(result.executionAuthorized,false);
  }
});
test('unknown costs, risk, residuals and unsupported models remain research-only without promotion', () => {
  for (const key of ['unknownOrUnsupportedModel','unknownOrUnboundedRisk','undeclaredResidual']) {
    assert.equal(source.payoffPolicy[key],'RESEARCH_ONLY_NO_PROMOTION');
    const d=draft();d.payoffPolicy[key]='ALLOW';assert.equal(validateCampaignDraft(d).valid,false);
  }
  assert.equal(source.payoffPolicy.costs.unknownCosts,'RESEARCH_ONLY_NO_PROMOTION');
  for (const key of Object.keys(source.payoffPolicy.costs)) for (const value of [undefined,null,'IGNORE',false]) {
    const d=draft();d.payoffPolicy.costs[key]=value;assert.equal(validateCampaignDraft(d).valid,false);
  }
  for (const f of source.families) assert.equal(f.validationStatus,'UNVALIDATED');
  const d=draft();d.families[0].validationStatus='VALIDATED';assert.equal(validateCampaignDraft(d).valid,false);
});
test('all family modes and research-only statuses are enforced and cannot inherit reference PASS', () => {
  for (let i=0;i<source.families.length;i++) for (const change of [f=>delete f.payoffPolicyId,f=>f.payoffReadiness='QUALIFIED',f=>f.payoffEvaluationMode='EXEMPT']) {
    const d=draft();change(d.families[i]);assert.equal(validateCampaignDraft(d).valid,false);
  }
  for (const [key,value] of [['partialExits','FINAL_TARGET_ONLY'],['stopRelocationToQualify','ALLOW'],['frozenReferenceTreatment','APPLY_TO_EXISTING_LOWVOL'],['leverageTreatment','MANDATORY_10X']]) {
    const d=draft();d.payoffPolicy[key]=value;assert.equal(validateCampaignDraft(d).valid,false);
  }
});
test('historical mandate is superseded, H5 restores proposed shock-open benchmark, no new trials', () => {
  assert.equal(source.userMandate.payoffUpdate.status,'SUPERSEDED');
  assert.match(source.userMandate.payoffUpdate.requirement,/3:1/);
  assert.match(source.families.find(f=>f.id==='H5').exitSketch,/target the shock-bar open/);
  assert.equal(source.validationPrerequisites.instrumentSpecificMarginSimulatorValidated,null);
  assert.equal(Object.hasOwn(source.validationPrerequisites,'tenTimesMarginSimulatorValidated'),false);
  assert.equal(source.defaults.maxFuturesLeverage,10);
  assert.match(source.payoffPolicy.leverageTreatment,/NOT_TARGET_OR_AUTHORITY/);
  assert.equal(source.families.flatMap(f=>f.variants).length,0);
});
test('exact payoff policy ignores property order and rejects undeclared bypass fields', () => {
  const d=draft();d.payoffPolicy=Object.fromEntries(Object.entries(d.payoffPolicy).reverse());assert.equal(validateCampaignDraft(d).valid,true);
  d.payoffPolicy.allowCarryException=false;assert.equal(validateCampaignDraft(d).valid,false);
});
