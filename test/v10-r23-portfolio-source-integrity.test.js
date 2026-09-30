import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const shell=fs.readFileSync(new URL('../v10/index.html',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));

test('r23 COMMAND consumes canonical private Pionex equity snapshot',()=>{
  assert.match(v9,/import \{[^}]*authoritativePionexEquitySnapshot[^}]*\} from '\.\.\/portfolio-data-contract\.js\?v=10\.0-r\d+'/);
  assert.ok(v9.includes("portfolio-data-contract.js?v="+release.terminalBuild));
  const block=v9.slice(v9.indexOf('function portfolioModel'),v9.indexOf('function pick'));
  assert.match(block,/resolvedPionex=authoritativePionexEquitySnapshot\(d,now\)/);
  assert.match(block,/strictPortfolio=.*authorityMode:'STRICT_VENUE_SNAPSHOT'/s);
  assert.match(block,/canonicalInput=resolvedPionex\.found\?.*pionexEquityUsd:resolvedPionex\.value.*:.*pionexEquityUsd:state\.manual\.pionex/s);
  assert.match(block,/pionex=resolvedPionex\.found\?snapshot\.tradingUsd:null/);
  assert.match(block,/pionexSource:resolvedPionex\.source/);
  assert.match(block,/pionexProvenance:resolvedPionex\.source/);
});

test('r23 removes magnitude-based account-total promotion',()=>{
  const block=v9.slice(v9.indexOf('function portfolioModel'),v9.indexOf('function pick'));
  assert.doesNotMatch(block,/apiLooksLikeAccountTotal/);
  assert.doesNotMatch(block,/verifiedPionexTotal\*\.8/);
  assert.doesNotMatch(block,/pionexRisk\?\.accountEquityUsd/);
  assert.doesNotMatch(block,/pionexRisk\?\.totalEquityUsd/);
  assert.doesNotMatch(block,/PRIVATE_ACCOUNT_TOTAL/);
});

test('r23 labels canonical Pionex source explicitly without magnitude inference',()=>{
  assert.match(v9,/PRIVATE SNAPSHOT/);
  assert.match(v9,/WALLET API/);
  assert.match(v9,/SCREENSHOT SNAPSHOT/);
});

test('r23 release identity is canonical and browser adapters parse',()=>{
  assert.match(release.terminalBuild,/^10\.0-r\d+$/);
  assert.ok(Number(release.terminalBuild.split('-r')[1])>=23);
  assert.ok(shell.includes(release.terminalBuild));
  assert.ok(v10.includes("const BUILD='"+release.terminalBuild+"'"));
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});
