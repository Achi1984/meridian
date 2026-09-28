import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));

test('r59 command layer removes legacy repaint duplicates before early return',()=>{
  assert.match(v10,/const legacyCommandSelectors=\[[^\]]*\.data-truth[^\]]*\]/s);
  assert.match(v10,/legacyCommandPresent=legacyCommandSelectors\.some/);
  assert.match(v10,/!force&&!legacyCommandPresent&&\$\('\.command-source-strip'/);
  assert.match(css,/#view-command \.data-truth,[\s\S]*#view-command \.command-bots\{display:none!important\}/);
});

test('r59 live exposure labels explicitly identify leveraged notional',()=>{
  assert.match(v10,/KNOWN LONG NOTIONAL/);
  assert.match(v10,/KNOWN SHORT NOTIONAL/);
  assert.match(v10,/KNOWN NET NOTIONAL/);
  assert.doesNotMatch(v10,/KNOWN LONG USD/);
});

test('r59 uses fresh Pionex Wallet total before screenshot equity fallback',()=>{
  assert.match(v9,/walletEquity=num\(d\?\.pionexAccount\?\.wallet\?\.totalInUsdt\)/);
  assert.match(v9,/source:'PIONEX_WALLET_READ_API'/);
  assert.match(v9,/resolvedPionex=walletPionex&&\(!privateFresh\|\|walletTs>=privateTs\)\?walletPionex:privatePionex\.found\?privatePionex:/);
  assert.match(v9,/pionexEquityUsd:resolvedPionex\.value/);
  assert.match(v9,/return'WALLET API'/);
});

test('r59 keeps decision readiness fail closed when PnL is missing',()=>{
  assert.match(v9,/function decisionReadyBot\(b\).*livePnlAvailable/s);
  assert.match(v10,/mangels PnL oder Marktfeed nicht decision-ready/);
  assert.equal(release.terminalExecutionImpact,false);
});
