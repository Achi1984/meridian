import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {marketKlinesSnapshot,clearMarketFeedCache,MARKET_FEED_POLICY} from '../market-feed-gateway.js';

const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const gateway=fs.readFileSync(new URL('../server-gateway.js',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));

function okxRows(count=30,start=1700000000000,step=15*60*1000){
  return Array.from({length:count},(_,i)=>{
    const t=start+i*step,p=100+i;
    return [String(t),String(p-1),String(p+2),String(p-2),String(p),'0','0','0','1'];
  }).reverse();
}
function binanceRows(count=30,start=1700000000000,step=15*60*1000){
  return Array.from({length:count},(_,i)=>{
    const t=start+i*step,p=100+i;
    return [t,String(p-1),String(p+2),String(p-2),String(p),'0',t+step-1];
  });
}

test('r65 gateway prefers OKX and returns normalized timestamped candles',async()=>{
  clearMarketFeedCache();
  const fetchImpl=async url=>({
    ok:true,status:200,
    json:async()=>({code:'0',data:okxRows(30)})
  });
  const now=1800000000000;
  const out=await marketKlinesSnapshot({symbol:'btc',interval:'15m',limit:30},{fetchImpl,now});
  assert.equal(out.ok,true);
  assert.equal(out.source,'OKX USDT-SWAP');
  assert.equal(out.transport,'MERIDIAN_GATEWAY');
  assert.equal(out.fetchedAt,now);
  assert.equal(out.rows.length,30);
  assert.ok(out.rows.every(x=>Number.isFinite(x.openTime)&&Number.isFinite(x.closeTime)&&Number.isFinite(x.close)));
});

test('r65 gateway falls back to Binance when OKX fails',async()=>{
  clearMarketFeedCache();
  const fetchImpl=async url=>{
    if(String(url).includes('okx.com'))return{ok:false,status:503,json:async()=>({})};
    return{ok:true,status:200,json:async()=>binanceRows(30)};
  };
  const out=await marketKlinesSnapshot({symbol:'ETH',interval:'1h',limit:30},{fetchImpl,now:1800000000000});
  assert.equal(out.ok,true);
  assert.equal(out.source,'BINANCE USD-M FUTURES');
  assert.equal(out.rows.length,30);
});

test('r65 gateway can reuse recent cached candles without forging a new timestamp',async()=>{
  clearMarketFeedCache();
  const first=await marketKlinesSnapshot({symbol:'SOL',interval:'4h',limit:30},{
    now:1800000000000,
    fetchImpl:async()=>({ok:true,status:200,json:async()=>({code:'0',data:okxRows(30,1700000000000,4*60*60*1000)})})
  });
  assert.equal(first.ok,true);
  const stale=await marketKlinesSnapshot({symbol:'SOL',interval:'4h',limit:30},{
    now:1800000000000+60*1000,
    fetchImpl:async()=>{throw new Error('network down')}
  });
  assert.equal(stale.ok,true);
  assert.equal(stale.cache,'STALE_FALLBACK');
  assert.equal(stale.fetchedAt,first.fetchedAt);
  assert.equal(stale.ageMs,60*1000);
  assert.ok(MARKET_FEED_POLICY.staleFallbackMs>=stale.ageMs);
});

test('r65 gateway rejects unsafe market query values',async()=>{
  clearMarketFeedCache();
  const badSymbol=await marketKlinesSnapshot({symbol:'BTC/../../x',interval:'15m',limit:20},{fetchImpl:async()=>{throw new Error('must not fetch')}});
  assert.equal(badSymbol.ok,false);
  assert.equal(badSymbol.status,400);
  const badInterval=await marketKlinesSnapshot({symbol:'BTC',interval:'5s',limit:20},{fetchImpl:async()=>{throw new Error('must not fetch')}});
  assert.equal(badInterval.ok,false);
  assert.equal(badInterval.status,400);
});

test('r65 browser technical feed uses authenticated gateway first and preserves upstream age',()=>{
  assert.match(v9,/getJson\('\/api\/private\/market-klines\?'/);
  assert.match(v9,/rows\.transport='MERIDIAN_GATEWAY'/);
  assert.match(v9,/rows\.fetchedAt=num\(j\.fetchedAt\)\|\|Date\.now\(\)/);
  assert.match(v9,/function marketRowsTimestamp\(\.\.\.sets\)/);
  assert.match(v9,/state\.marketSyncedAt=num\(state\.intel\?\.updatedAt\)\|\|Date\.now\(\)/);
  assert.match(v9,/DIRECT_FALLBACK/);
});

test('r65 gateway route is protected by the existing private API authorization boundary',()=>{
  assert.match(gateway,/u\.pathname==="\/api\/private\/market-klines"/);
  const authIndex=gateway.indexOf('if(isProtected(u.pathname)&&!authorizedRead(req))');
  const routeIndex=gateway.indexOf('u.pathname==="/api/private/market-klines"');
  assert.ok(authIndex>=0&&routeIndex>authIndex);
});

test('r65 exposes transport/error diagnostics without changing execution safety',()=>{
  assert.match(v10,/transport:String\(s\?\.marketTransport\|\|s\?\.intel\?\.transport\|\|'UNKNOWN'\)/);
  assert.match(v10,/m\.transport/);
  assert.equal(release.terminalBuild,'10.0-r65');
  assert.equal(release.terminalExecutionImpact,false);
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});
