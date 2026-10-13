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
