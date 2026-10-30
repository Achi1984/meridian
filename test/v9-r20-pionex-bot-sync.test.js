import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mergePionexSyncState} from '../pionex-bot-auto-sync.js';
import {
  selectPionexRisk,pionexFeedComplete,pionexCandidateValid,publishPionexSnapshot
} from '../v9/pionex-risk-snapshot.js';

const js=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8').replaceAll('\r\n','\n');
const html=fs.readFileSync(new URL('../v9/index.html',import.meta.url),'utf8').replaceAll('\r\n','\n');
const start=fs.readFileSync(new URL('../scripts/start-gateway.mjs',import.meta.url),'utf8').replaceAll('\r\n','\n');

test('r20 starts the read-only Pionex bot synchronizer',()=>{
  assert.match(start,/startPionexBotAutoSync/);
  assert.match(start,/pionex-bot-auto-sync\.js/);
});

test('r20 Data Truth exposes Pionex bot API health and coverage',()=>{
  assert.match(js,/DATA TRUTH · r20/);
  assert.match(js,/PIONEX API/);
  assert.match(js,/BOT ROWS/);
  assert.match(js,/BOT API/);
  assert.match(js,/BOT SOURCE/);
  assert.match(js,/DISABLED_MISSING_CREDENTIALS/);
  assert.match(js,/Pionex Bot API Sync-Fehler/);
  assert.match(js,/EMPTY_GUARD/);
  assert.match(js,/alter Snapshot wurde aus Sicherheitsgründen nicht überschrieben/);
});

test('r20 frontend accepts normalized Pionex Bot API field aliases',()=>{
  assert.match(js,/\['lower','lowerRange'/);
  assert.match(js,/\['upper','upperRange'/);
  assert.match(js,/\['liq','pionexLiquidationPrice'/);
  assert.match(js,/investUsd=pick\(x,\['investmentUsd'/);
  assert.match(js,/investAny=investUsd\?\?/);
  assert.match(js,/\['pnl','totalProfitUsd'/);
  assert.match(js,/\['sl','stopLoss'/);
  assert.match(js,/replace\(\/\\\.PERP\$\//);
});

test('r20+ uses selected Pionex source and raw source row count',()=>{
  assert.match(js,/botApiRows:num\(feed\?\.apiRows\)\?\?live\.length/);
  assert.match(js,/state\.pionexBotSync=d\?\.pionexBotSync\|\|null/);
  assert.match(js,/botFeedSource:String\(feed\?\.source/);
});

test('r20 selection and last-good publication reject incomplete primary coverage behaviorally',()=>{
  const now=Date.parse('2026-09-28T20:45:00.000Z'),stamp=new Date(now-60000).toISOString();
  const complete={source:'PIONEX_BOT_API',updatedAt:stamp,snapshotAt:stamp,detailsComplete:true,
    paginationComplete:true,coverage:{status:'DOCUMENTED',paginationComplete:true},
    bots:[{id:'synthetic-a'},{id:'synthetic-b'}],botCount:2};
  const base={pionexRisk:complete,pionexBotSync:{status:'OK',lastSuccessAt:stamp,truncated:false}};
  const partial={...complete,updatedAt:new Date(now-1000).toISOString(),
    paginationComplete:true,coverage:{status:'DOCUMENTED',paginationComplete:false},
    bots:[{id:'synthetic-page-only'}],botCount:1};
  const merged=mergePionexSyncState(base,{risk:partial,status:'OK',attemptAt:partial.updatedAt,
    successAt:partial.updatedAt,configured:true,pages:20,truncated:true});
  const selected=selectPionexRisk(merged,now);
  assert.equal(selected.risk,merged.pionexRisk);
  assert.equal(selected.status,'PARTIAL');
  assert.equal(pionexFeedComplete(selected.risk,selected.status),false);
  assert.equal(pionexCandidateValid({trustedTs:true,monotonicTs:true,liveLength:2,
    actionComplete:true,identityComplete:true,feed:selected.risk,selectedStatus:selected.status}),false);

  const state={bots:[{id:'last-good-a'},{id:'last-good-b'}],lastGoodBotSnapshot:{
    bots:[{id:'last-good-a'},{id:'last-good-b'}],publishedAt:now-5000
  }};
  const before=structuredClone(state);
  assert.equal(publishPionexSnapshot(state,{bots:[{id:'partial-replacement'}]},now,false),false);
  assert.deepEqual(state,before,'rejected partial feed cannot replace visible or last-good bots');

  const refreshed={...complete,updatedAt:new Date(now).toISOString(),snapshotAt:new Date(now).toISOString(),
    bots:[{id:'synthetic-a'},{id:'synthetic-b'},{id:'synthetic-c'}],botCount:3};
  const recovered=mergePionexSyncState(merged,{risk:refreshed,status:'OK',attemptAt:refreshed.updatedAt,
    successAt:refreshed.updatedAt,configured:true,pages:3});
  const freshSelection=selectPionexRisk(recovered,now);
  assert.equal(freshSelection.status,'BOT_API_OK');
  assert.equal(pionexCandidateValid({trustedTs:true,monotonicTs:true,liveLength:3,
    actionComplete:true,identityComplete:true,feed:freshSelection.risk,selectedStatus:freshSelection.status}),true);
  assert.equal(publishPionexSnapshot(state,{bots:freshSelection.risk.bots},now,true),true);
  assert.deepEqual(state.bots,refreshed.bots);
  assert.deepEqual(state.lastGoodBotSnapshot.bots,refreshed.bots);
});

test('r20 nested pagination flags fail closed for both primary and wallet selection',()=>{
  const now=Date.parse('2026-09-28T20:45:00.000Z'),stamp=new Date(now-1000).toISOString();
  const risk={updatedAt:stamp,detailsComplete:true,paginationComplete:true,
    coverage:{status:'DOCUMENTED',paginationComplete:false},bots:[{id:'synthetic'}]};
  const primary=selectPionexRisk({pionexRisk:risk,pionexBotSync:{status:'OK'}},now);
  assert.equal(primary.status,'PARTIAL');
  assert.equal(pionexFeedComplete(primary.risk,primary.status),false);
  const wallet=selectPionexRisk({pionexAccount:{walletBotRisk:risk},
    pionexAccountSync:{status:'OK'}},now);
  assert.notEqual(wallet.status,'WALLET_DETAIL_OK');
  assert.equal(pionexFeedComplete(wallet.risk,wallet.status),false);
});

test('r20 production consumer delegates selection, completeness, and last-good publication to tested logic',()=>{
  assert.match(js,/import \{selectPionexRisk,pionexFeedComplete,pionexCandidateValid,publishPionexSnapshot\}/);
  assert.match(js,/candidateValid=pionexCandidateValid\(/);
  assert.match(js,/publishPionexSnapshot\(state,snapshot,now,candidateValid\)/);
});

test('r20 production version is consistent',()=>{
  assert.match(html,/v9 · r20 · COIN-M COMMAND CENTER/);
  assert.match(html,/9\.0-r20/);
});
