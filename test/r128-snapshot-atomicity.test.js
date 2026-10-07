import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const v9=read('v9/v9.js');
const v10=read('v10/v10.js');

test('R128 keeps the last-known-good bot snapshot until a complete candidate is accepted',()=>{
  assert.match(v9,/botRefreshStatus:'IDLE'.*lastGoodBotSnapshot:null/s);
  assert.match(v9,/candidateValid=trustedTs&&monotonicTs&&live\.length>0&&actionComplete&&identityComplete&&feedComplete/);
  assert.match(v9,/if\(candidateValid\)\{[\s\S]*Object\.assign\(state,snapshot\);[\s\S]*state\.lastGoodBotSnapshot=\{\.\.\.snapshot,bots:candidateBots\.map\(b=>\(\{\.\.\.b\}\)\),publishedAt:now\}/);
});

test('R128 partial and fetch-error refreshes do not revoke trust from the last good bot snapshot',()=>{
  const partial=v9.match(/\}else\{\n   const reasons=\[\];[\s\S]*?state\.botRefreshStatus='PARTIAL';[\s\S]*?\n  \}/)?.[0]||'';
  const catcher=v9.match(/\}catch\(e\)\{[\s\S]*?return false;\n \}finally/)?.[0]||'';
  assert.ok(partial);
  assert.ok(catcher);
  assert.doesNotMatch(partial,/botFeedTimestampTrusted\s*=\s*false|state\.source\s*=\s*'REFERENCE'/);
  assert.doesNotMatch(catcher,/botFeedTimestampTrusted\s*=\s*false|state\.source\s*=\s*'REFERENCE'/);
  assert.match(catcher,/state\.botRefreshStatus='ERROR'/);
});

test('R128 candidate timestamp must be trusted and monotonic before replacing the visible snapshot',()=>{
  assert.match(v9,/trustedTs=specificTs!=null&&specificTs<=now\+5\*60\*1000/);
  assert.match(v9,/monotonicTs=!state\.botFeedTimestampTrusted\|\|state\.botFeedUpdatedAt==null\|\|specificTs>=state\.botFeedUpdatedAt/);
  assert.match(v9,/botFeedUpdatedAt:specificTs,[\s\S]*botFeedTimestampTrusted:true/);
  assert.match(v9,/if\(!trustedTs\)reasons\.push\('UNTRUSTED_TIMESTAMP'\)/);
  assert.match(v9,/if\(trustedTs&&!monotonicTs\)reasons\.push\('OLDER_THAN_LAST_GOOD'\)/);
});

test('R128 keeps fresh last-good bot and market state READY while refresh is in flight',()=>{
  const market=v10.match(/function marketReadiness\(m\)\{[\s\S]*?\n\}/)?.[0]||'';
  const bot=v10.match(/function botReadiness\(g\)\{[\s\S]*?\n\}/)?.[0]||'';
  assert.ok(market);
  assert.ok(bot);
  assert.ok(market.indexOf("if(m.fresh&&m.coverageComplete)return{label:'READY',tone:'safe'}") < market.indexOf("if(m.syncing)return{label:'SYNCING',tone:'watch'}"));
  assert.match(bot,/if\(!g\.fresh\)return\{label:g\.lastGoodAvailable\?'STALE':'REF'/);
  assert.match(v10,/AKTUALISIERUNG LÄUFT · letzter gültiger Stand/);
  assert.match(v10,/refreshDegraded&&g\.lastGoodAvailable&&g\.fresh/);
});

test('R128 never extends freshness on refresh attempts and still fails closed after 15 minutes or on cold start',()=>{
  assert.match(v9,/return t\.trusted&&!t\.future&&t\.ageMs!=null&&t\.ageMs<=15\*60\*1000/);
  assert.doesNotMatch(v9,/botFeedUpdatedAt\s*=\s*Date\.now\(\)/);
  assert.match(v10,/if\(!g\.fresh\)return\{label:g\.lastGoodAvailable\?'STALE':'REF'/);
  assert.match(v10,/else if\(g\.refreshing\)detail='AKTUALISIERUNG LÄUFT · noch kein vollständiger Stand'/);
});
