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
test('net CRV policy rejects absent, weaker, gross-only and misleading runtime contracts', () => {
  const changes = [
    d=>delete d.payoffPolicy,d=>d.payoffPolicy=null,
    d=>d.payoffPolicy.minimumPlannedNetRewardRisk=2.99,
    d=>d.payoffPolicy.minimumPlannedNetRewardRisk='3',
    d=>d.payoffPolicy.minimumPlannedNetRewardRisk=Infinity,
    d=>d.payoffPolicy.rewardBasis='GROSS_TARGET',
    d=>d.payoffPolicy.riskBasis='MARGIN_ONLY',
    d=>d.payoffPolicy.scope='DIRECTIONAL_ONLY',
    d=>d.payoffPolicy.runtimeEnforcementImplemented=true,
    d=>d.payoffPolicy.evaluationStage='RUNTIME',
    d=>d.payoffPolicy.minimumPlannedNetRewardRisk=4
  ];
  for (const change of changes) {
    const d=draft();change(d);const r=validateCampaignDraft(d);
    assert.equal(r.valid,false);assert.equal(r.executionAuthorized,false);
  }
});
test('both payoff scenarios include conservative costs and every leg; missing or waived costs fail', () => {
  for (const key of Object.keys(source.payoffPolicy.costs)) {
    for (const value of [undefined,null,'IGNORE',false]) {
      const d=draft();d.payoffPolicy.costs[key]=value;
      assert.equal(validateCampaignDraft(d).valid,false,`${key}:${String(value)}`);
    }
  }
  const d=draft();d.payoffPolicy.costs.discountedFees=true;
  assert.equal(validateCampaignDraft(d).valid,false);
});
test('partial exit, residual, risk and stop-policy bypasses cannot qualify a draft', () => {
  for (const [key,value] of [
    ['partialExits','FINAL_TARGET_ONLY'],['undeclaredResidual','ASSUME_TARGET'],
    ['unknownOrUnboundedRisk','ALLOW'],['stopRelocationToQualify','ALLOW'],
    ['unsupportedFinitePayoff','EXEMPT'],['exemptions',['CARRY']],
    ['exemptions',['HEDGE']],['exemptions',['SPOT']],
    ['frozenReferenceTreatment','APPLY_TO_EXISTING_LOWVOL']
  ]) {
    const d=draft();d.payoffPolicy[key]=value;
    assert.equal(validateCampaignDraft(d).valid,false,key);
  }
});
test('all families including event, hedge, carry and allocator stay payoff-unverified with no exemptions', () => {
  for (let index=0;index<source.families.length;index++) {
    for (const change of [f=>delete f.payoffPolicyId,f=>f.payoffPolicyId='EXEMPT',f=>f.payoffReadiness='QUALIFIED']) {
      const d=draft();change(d.families[index]);assert.equal(validateCampaignDraft(d).valid,false,source.families[index].id);
    }
  }
});
test('exact payoff policy ignores property ordering but rejects undeclared bypass fields', () => {
  const d=draft();d.payoffPolicy=Object.fromEntries(Object.entries(d.payoffPolicy).reverse());
  assert.equal(validateCampaignDraft(d).valid,true);
  d.payoffPolicy.allowCarryException=false;assert.equal(validateCampaignDraft(d).valid,false);
});
