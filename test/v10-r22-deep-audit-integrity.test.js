import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const shell=fs.readFileSync(new URL('../v10/index.html',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));

test('r22 header status colors match runtime semantics',()=>{
  assert.ok(css.includes('.live.safe{color:var(--green)}'));
  assert.ok(css.includes('.live.watch{color:var(--amber)}'));
  assert.ok(css.includes('.live.danger{color:var(--red)}'));
  assert.ok(css.includes('.live.muted{color:var(--muted)}'));
});

test('r22 two-source coverage is scoped to the rendered market universe',()=>{
  const block=v10.slice(v10.indexOf('function renderMarket(force=false)'),v10.indexOf('function scannerCard'));
  assert.ok(block.includes("verified=syms.filter(symbol=>{const x=s?.priceChecks?.[symbol];return x?.verified&&freshTs(x.updatedAt)}).length"));
  assert.ok(!block.includes('Object.values(s?.priceChecks||{})'));
});

test('r22 forced live refresh preserves expandable UI state',()=>{
  const bots=v10.slice(v10.indexOf('function renderBots(force=false)'),v10.indexOf('function marketUniverse'));
  assert.ok(bots.includes("snapshotOpen=force?$('.v10-snapshot-details',view)?.open:null"));
  assert.ok(bots.includes('snapshotDetails(snapshotOpen??!g.fresh)'));
  const scanner=v10.slice(v10.indexOf('function renderScanner(force=false)'),v10.indexOf('function skNum'));
  assert.ok(scanner.includes("moreOpen=force?!!$('.scanner-more:not(.scanner-stale)',view)?.open:false"));
  assert.ok(scanner.includes("staleOpen=force?!!$('.scanner-more.scanner-stale',view)?.open:false"));
  assert.ok(scanner.includes("(moreOpen?'open':'')"));
  assert.ok(scanner.includes("(staleOpen?'open':'')"));
});

test('r22 conflict and neutral scanner diagnostics include both side reason sets',()=>{
  const card=v10.slice(v10.indexOf('function scannerCard'),v10.indexOf('function renderScanner'));
  assert.ok(card.includes("bearReasons=i.longReasons||[],bullReasons=i.shortReasons||[]"));
  assert.ok(card.includes("[bearReasons[0],bullReasons[0],...bearReasons.slice(1),...bullReasons.slice(1)].filter(Boolean)"));
  assert.ok(card.includes('reasons=[...new Set(reasonSet)]'));
});

test('r22 release identity is canonical and adapter parses',()=>{
  assert.equal(release.terminalBuild,'10.0-r22');
  assert.ok(shell.includes(release.terminalBuild));
  assert.ok(v10.includes("const BUILD='"+release.terminalBuild+"'"));
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});
