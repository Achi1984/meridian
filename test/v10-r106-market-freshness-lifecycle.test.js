import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {marketKlinesSnapshot,clearMarketFeedCache,MARKET_FEED_POLICY} from '../market-feed-gateway.js';

const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));

function okxRows(count=30,start=1700000000000,step=15*60*1000){
  return Array.from({length:count},(_,i)=>{
    const t=start+i*step,p=100+i;
    return [String(t),String(p-1),String(p+2),String(p-2),String(p),'0','0','0','1'];
  }).reverse();
}

test('r106 release identity is coherent and execution neutral',()=>{
  assert.equal(release.terminalBuild,'10.0-r106');
  assert.equal(release.terminalExecutionImpact,false);
  assert.match(String(release.dashboardShell||''),/MARKET-FRESHNESS-LIFECYCLE/);
  assert.equal(manifest.start_url,'./v10/?build=r106&fresh=r106');
  assert.ok(v10.includes("const BUILD='10.0-r106'"));
});

test('r106 reserves freshness margin below the 3 minute decision boundary',async()=>{
  assert.equal(MARKET_FEED_POLICY.staleFallbackMs,90*1000);
  clearMarketFeedCache();
  const now=1800000000000;
  const first=await marketKlinesSnapshot({symbol:'BTC',interval:'15m',limit:30},{
    now,
    fetchImpl:async()=>({ok:true,status:200,json:async()=>({code:'0',data:okxRows(30)})})
  });
  assert.equal(first.ok,true);
  const shortFallback=await marketKlinesSnapshot({symbol:'BTC',interval:'15m',limit:30},{
    now:now+60*1000,
    fetchImpl:async()=>{throw new Error('upstream down')}
  });
  assert.equal(shortFallback.ok,true);
  assert.equal(shortFallback.cache,'STALE_FALLBACK');
  const tooOld=await marketKlinesSnapshot({symbol:'BTC',interval:'15m',limit:30},{
    now:now+100*1000,
    fetchImpl:async()=>{throw new Error('upstream down')}
  });
  assert.equal(tooOld.ok,false);
  assert.equal(tooOld.status,502);
});

test('r106 client rejects over-age gateway fallback before using technical data',()=>{
  assert.match(v9,/gatewayCache==='STALE_FALLBACK'&&gatewayAge!=null&&gatewayAge>90\*1000/);
  assert.match(v9,/GATEWAY_STALE_FALLBACK_TOO_OLD/);
  assert.match(v9,/rows\.gatewayAgeMs=gatewayAge/);
});

test('r106 market refresh exposes an explicit lifecycle instead of reporting stale while running',()=>{
  assert.match(v9,/marketSyncStatus:'IDLE'/);
  assert.match(v9,/state\.marketSyncStatus='RUNNING';state\.marketSyncStartedAt=Date\.now\(\);notifyData\(\)/);
  assert.match(v9,/state\.marketSyncStatus=btcRows\?\(errors\.length\?'PARTIAL':'OK'\):'ERROR'/);
  assert.match(v10,/if\(m\.syncing\)return\{label:'SYNCING',tone:'watch'\}/);
  assert.match(v10,/Technischer Markt-Refresh läuft; alter Stand bleibt fail-closed/);
});

test('r106 preserves fail-closed bot and market decision guards',()=>{
  assert.match(v10,/if\(!intelFresh\(s\.assetIntel\?\.\[symbol\]\)\)return\{code:'MARKET_STALE'/);
  assert.match(v10,/if\(g\.safetyReady>0\)return\{label:'SAFETY',tone:'watch'\}/);
  assert.doesNotMatch(v10,/(?:submitOrder|placeOrder|createOrder|cancelOrder|\/trade\/order|method\s*:\s*['"]POST['"])/);
});
