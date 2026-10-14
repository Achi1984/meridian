import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotPublicationWindow,checkPublicationWindow} from '../scripts/publication-time-window.mjs';
const now=1800000000000;
const iso=ms=>new Date(ms).toISOString().replace('.000Z','Z');
const window=()=>({reservedAtMs:now-2000,sendStartedAtMs:now-1000,responseReceivedAtMs:now});
test('valid bounded window includes exact timestamp boundaries',()=>{
 assert.equal(checkPublicationWindow(window(),iso(now-1000),now),true);
 assert.equal(checkPublicationWindow(window(),iso(now),now+30000),true);
});
test('missing extra non-integer and invalid ordered windows reject',()=>{
 for(const raw of [null,{}, {...window(),extra:0}, {...window(),reservedAtMs:NaN},
  {...window(),sendStartedAtMs:0}, {...window(),responseReceivedAtMs:now+.5},
  {...window(),reservedAtMs:now}, {...window(),sendStartedAtMs:now+1},
  {...window(),reservedAtMs:now-901001}, {...window(),reservedAtMs:now-6000,sendStartedAtMs:now-4501}])
  assert.throws(()=>snapshotPublicationWindow(raw));
});
test('stale future old and malformed timestamp evidence rejects',()=>{
 for(const [created,clock] of [[iso(now-2000),now],[iso(now+1000),now],
  [iso(now),now-1],[iso(now),now+30001],[iso(now),NaN],['2026-02-30T00:00:00Z',now],
  [iso(now).replace('Z','.000Z'),now]])assert.throws(()=>checkPublicationWindow(window(),created,clock));
});
test('window snapshot is frozen and independent from later host mutation',()=>{
 const raw=window(),copy=snapshotPublicationWindow(raw);raw.sendStartedAtMs=now+10000;
 assert.equal(checkPublicationWindow(copy,iso(now),now),true);assert.equal(Object.isFrozen(copy),true);
});
test('seconds precision permits same-second timestamps but not previous second',()=>{
 const raw={reservedAtMs:now-2000,sendStartedAtMs:now-500,responseReceivedAtMs:now+400};
 assert.equal(checkPublicationWindow(raw,iso(now-1000),now+400),true);
 assert.throws(()=>checkPublicationWindow(raw,iso(now-2000),now+400));
});
