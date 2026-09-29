import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {timingSafeToken,sanitizeSnapshot} from '../api/asset-watch-relay.js';

test('relay token uses sha256 and timing-safe comparison semantics',()=>{
  const token='example-token';
  const hash=crypto.createHash('sha256').update(token).digest('hex');
  assert.equal(timingSafeToken(token,hash),true);
  assert.equal(timingSafeToken(token+'x',hash),false);
  assert.equal(timingSafeToken('',hash),false);
  assert.equal(timingSafeToken(token,'not-a-hash'),false);
});

test('relay snapshot remains read-only and strips unexpected fields',()=>{
  const out=sanitizeSnapshot({
    schemaVersion:'MERIDIAN-ASSET-WATCH-BRIDGE-V1',
    readOnly:true,
    executionImpact:false,
    generatedAt:'2026-09-29T03:00:00Z',
    source:'PIONEX_BOT_API',
    sourceSnapshotAt:'2026-09-29T02:59:00Z',
    sourceAgeMs:60000,
    freshnessLimitMs:900000,
    detailsComplete:true,
    sourceStatusOk:true,
    fresh:true,
    usableForOverwrite:true,
    overwriteRule:'ONLY_WHEN_usableForOverwrite_IS_TRUE',
    botCount:1,
    snapshotFingerprint:'abc',
    secret:'must-not-leak',
    bots:[{
      botRef:'safe-ref',
      rawBotId:'raw-id-must-not-leak',
      symbol:'hbar',
      side:'long',
      leverage:4,
      limits:{lower:.05,upper:.15,liquidationPrice:.06089,takeProfit:.15,stopLoss:null},
      grid:{grids:287},
      position:{size:35829.92,positionOpenPrice:.11576,breakEvenPrice:null,breakEvenSource:'NOT_EXPOSED_BY_PIONEX_BOT_API'},
      margin:{extraMargin:0,riskStatus:'OK',marginStatus:'OK'},
      investment:{usd:4000,currency:'HBAR',quoteAmount:35829.92},
      pnl:{usd:20,totalProfitPct:.5},
      source:'PIONEX_BOT_API'
    }],
    fieldSemantics:{positionOpenPrice:'ENTRY',breakEvenPrice:'NONE',screenshotBreakEven:'KEEP'}
  });
  assert.equal(out.readOnly,true);
  assert.equal(out.executionImpact,false);
  assert.equal(out.botCount,1);
  assert.equal(out.bots[0].symbol,'HBAR');
  assert.equal(out.bots[0].limits.liquidationPrice,.06089);
  const raw=JSON.stringify(out);
  assert.doesNotMatch(raw,/raw-id-must-not-leak/);
  assert.doesNotMatch(raw,/must-not-leak/);
});

test('relay caps bot array and derives botCount from sanitized rows',()=>{
  const bots=Array.from({length:150},(_,i)=>({botRef:'b'+i,symbol:'BTC',side:'LONG'}));
  const out=sanitizeSnapshot({bots});
  assert.equal(out.bots.length,100);
  assert.equal(out.botCount,100);
});
