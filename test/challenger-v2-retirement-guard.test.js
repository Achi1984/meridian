import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Execute only the actual named functions: never import/start the HTTP server.
const source = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
function declaration(name) {
  const start = source.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, `missing ${name}`);
  const tail = source.slice(start);
  const end = tail.search(/\n(?:async )?function /);
  assert.ok(end > 0, `missing boundary after ${name}`);
  return tail.slice(0, end);
}
const flag = source.match(/^const NO_EDGE_DIRECTIONAL_NEW_ENTRIES_ALLOWED=.*$/m)?.[0];
assert.ok(flag, 'missing source retirement flag');
function harness(names, bindings = {}) {
  const context = vm.createContext(bindings);
  vm.runInContext([flag, ...names.map(declaration)].join('\n'), context);
  return context;
}
const signal = {symbol:'BTCUSDT',side:'LONG',status:'READY',entry:100,sl:98,tp1:103,tp2:105,candidate:90,technical:90};

test('retired V2 rejects before reading or mutating any ledger', async () => {
  const touched = [];
  const bindings = Object.fromEntries(['loadChallengerV2','saveChallengerV2','openChallengerPosition','challengerDecision','rollover','addEvent'].map(name => [name, () => {
    touched.push(name);
    throw new Error(`unexpected ${name}`);
  }]));
  const ctx = harness(['submitChallengerV2'], bindings);
  const result = await ctx.submitChallengerV2(signal);
  assert.equal(result.accepted, false);
  assert.deepEqual(Array.from(result.reasons), ['RETIRED_NO_DEMONSTRATED_EDGE']);
  assert.deepEqual(touched, []);
});

test('scanner fallback with no V3 cannot reopen V2', async () => {
  const events = [], writes = [], submissions = [];
  let observations = 0;
  const ctx = harness(['submitChallengerV2','signalScanUnlocked'], {
    config:{symbols:['BTCUSDT']}, status:{signalScans:0,errors:0}, scannerCache:{},
    BOT_LIFECYCLE:{SHADOW_V1:{active:false},REGIME_V1:{active:false}},
    analyzeSymbol:async () => signal,
    setState:async key => { writes.push(key); },
    observeAlphaLabR43:async () => {}, ensureChallengerV3:async () => null,
    observeChallengerV2Scan:async () => { observations++; },
    submitSignal:async () => ({accepted:false,reasons:['REFERENCE_FROZEN']}),
    addEvent:async type => { events.push(type); },
    loadChallengerV2:async () => { throw new Error('retired ledger load'); },
    saveChallengerV2:async () => { throw new Error('retired ledger save'); },
    openChallengerPosition:() => { throw new Error('retired position open'); }
  });
  const actualSubmit = ctx.submitChallengerV2;
  ctx.submitChallengerV2 = async input => {
    const result = await actualSubmit(input);
    submissions.push(result);
    return result;
  };
  await ctx.signalScanUnlocked();
  assert.equal(observations, 1);
  assert.equal(submissions.length, 1, 'must exercise V2 fallback');
  assert.equal(submissions[0].accepted, false);
  assert.deepEqual(Array.from(submissions[0].reasons), ['RETIRED_NO_DEMONSTRATED_EDGE']);
  assert.deepEqual(writes, ['scanner']);
  assert.deepEqual(events, ['SIGNAL_SCAN_READY']);
  assert.equal(ctx.status.errors, 0);
});

test('retirement still allows existing V2 positions to close', async () => {
  const position = {...signal,status:'OPEN',qty:1,riskPct:1,feeOpen:1};
  const state = {account:{cash:9999,realizedPnl:-1,equity:9999,peakEquity:10000},positions:[position],trades:[],equityCurve:[],counterfactuals:[]};
  const events = [];
  let saved;
  const ctx = harness(['challengerV2Cycle'], {
    config:{marketStaleMs:120000}, CHALLENGER_V2_RULESET:'6.99-CHALLENGER-V2',
    loadChallengerV2:async () => state, rollover:s => s,
    markPositionBookedOpenFee:(p,price) => ({...p,livePrice:price}),
    exitReason:(p,price) => price <= p.sl ? 'SL' : null,
    closePaperPosition:(p,price,reason) => ({...p,status:'CLOSED',exit:price,exitReason:reason,realized:-4}),
    last:rows => rows.at(-1), round:x => x,
    saveChallengerV2:async s => { saved = s; },
    addEvent:async type => { events.push(type); }
  });
  await ctx.challengerV2Cycle({quotes:{BTCUSDT:{price:97,ts:Date.now()}}});
  assert.equal(saved.positions.length, 0);
  assert.equal(saved.trades.length, 1);
  assert.equal(saved.trades[0].exitReason, 'SL');
  assert.equal(saved.account.cash, 9996);
  assert.equal(saved.account.realizedPnl, -4);
  assert.deepEqual(events, ['CHALLENGER_V2_POSITION_CLOSED']);
});
