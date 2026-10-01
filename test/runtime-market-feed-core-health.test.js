import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const gateway=fs.readFileSync(new URL('../server-gateway.js',import.meta.url),'utf8');
const smoke=fs.readFileSync(new URL('../scripts/runtime-smoke.mjs',import.meta.url),'utf8');

test('gateway health probes the same BTC core intervals and limits used by the dashboard',()=>{
  assert.match(gateway,/marketKlinesSnapshot\(\{symbol:'BTC',interval:'15m',limit:180\}\)/);
  assert.match(gateway,/marketKlinesSnapshot\(\{symbol:'BTC',interval:'1h',limit:200\}\)/);
  assert.match(gateway,/marketKlinesSnapshot\(\{symbol:'BTC',interval:'4h',limit:240\}\)/);
  assert.match(gateway,/marketKlinesSnapshot\(\{symbol:'BTC',interval:'1d',limit:240\}\)/);
  assert.match(gateway,/marketFeedCore=marketFeedCoreSummary/);
});

test('marketFeedCore exposes only health metadata, not candle prices or private state',()=>{
  const start=gateway.indexOf('function marketFeedCoreReceipt(');
  const end=gateway.indexOf('function marketFeedCoreSummary(',start);
  assert.ok(start>=0&&end>start);
  const block=gateway.slice(start,end);
  for(const token of ['cache','ageMs','source','transport','fetchedAt','rowCount','minimumRows','sufficientRows','error'])assert.ok(block.includes(token));
  assert.doesNotMatch(block,/\b(?:open|high|low|close|price|quantity|portfolio|bot)\b/i);
  assert.doesNotMatch(block,/rows\s*:/);
});

test('marketFeedCore uses the r106 90-second freshness reserve and conservative row minima',()=>{
  assert.match(gateway,/x\.ageMs<=90\*1000/);
  assert.match(gateway,/freshnessLimitMs:90\*1000/);
  assert.match(gateway,/'15m':\{snapshot:m15,minRows:20\}/);
  assert.match(gateway,/'1h':\{snapshot:h1,minRows:61\}/);
  assert.match(gateway,/'4h':\{snapshot:h4,minRows:101\}/);
  assert.match(gateway,/'1d':\{snapshot:d1,minRows:211\}/);
});

test('runtime smoke fails closed when marketFeedCore is not ready, stale, or undersized',()=>{
  assert.match(smoke,/if\(marketFeedCore\.ready!==true\)fail\('Gateway marketFeedCore not ready'\)/);
  assert.match(smoke,/marketFreshnessLimit!==90\*1000/);
  assert.match(smoke,/for\(const key of \['15m','1h','4h','1d'\]\)/);
  assert.match(smoke,/item\.sufficientRows!==true/);
  assert.match(smoke,/age>marketFreshnessLimit/);
  assert.match(smoke,/marketFeedCore:true/);
});
