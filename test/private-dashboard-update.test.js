import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePrivateDashboardPatch,mergePrivateDashboard,privateDashboardPublicReceipt} from '../private-dashboard-update.js';

test('accepts allowed private dashboard sections',()=>{
  const x=validatePrivateDashboardPatch({patch:{portfolio:{holdings:[]},pionexRisk:{bots:[]}},source:'manual_verified'});
  assert.equal(x.ok,true);
  assert.deepEqual(x.keys,['portfolio','pionexRisk']);
});

test('rejects forbidden top-level sections',()=>{
  const x=validatePrivateDashboardPatch({patch:{paper:{equity:1}}});
  assert.equal(x.ok,false);
  assert.equal(x.error,'section_not_allowed');
});

test('merges allowed sections and increments revision',()=>{
  const current={privateRevision:4,portfolio:{total:10,holdings:[{symbol:'BTC'}]},other:{keep:true}};
  const x=mergePrivateDashboard(current,{expectedRevision:4,patch:{portfolio:{total:20}},source:'verified_screenshots'},{now:'2026-09-03T04:40:00.000Z'});
  assert.equal(x.ok,true);
  assert.equal(x.data.privateRevision,5);
  assert.equal(x.data.portfolio.total,20);
  assert.deepEqual(x.data.portfolio.holdings,[{symbol:'BTC'}]);
  assert.deepEqual(x.data.other,{keep:true});
  assert.equal(x.data.privateUpdateSource,'verified_screenshots');
});

test('revision guard rejects stale write',()=>{
  const x=mergePrivateDashboard({privateRevision:2},{expectedRevision:1,patch:{portfolio:{total:20}}});
  assert.equal(x.ok,false);
  assert.equal(x.error,'revision_conflict');
  assert.equal(x.currentRevision,2);
});

test('receipt does not echo private payload',()=>{
  const merged=mergePrivateDashboard({}, {patch:{portfolio:{total:20}}},{now:'2026-09-03T04:40:00.000Z'});
  const receipt=privateDashboardPublicReceipt(merged,{dryRun:true});
  assert.deepEqual(receipt,{ok:true,dryRun:true,revision:1,previousRevision:0,updatedSections:['portfolio'],updatedAt:'2026-09-03T04:40:00.000Z'});
});
