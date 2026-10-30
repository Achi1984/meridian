import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

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

test('r20 refuses explicitly incomplete primary and wallet bot coverage as authoritative',()=>{
  const selector=js.match(/function selectPionexRisk\(d=\{\}\)\{[\s\S]*?\n\}/)?.[0]||'';
  assert.ok(selector);
  assert.match(selector,/d\?\.pionexBotSync\?\.truncated!==true/);
  assert.match(selector,/primary\?\.paginationComplete!==false/);
  assert.match(selector,/primary\?\.coverage\?\.status!=='PARTIAL'/);
  assert.match(selector,/wallet\?\.paginationComplete!==false/);
  assert.match(selector,/wallet\?\.coverage\?\.status!=='PARTIAL'/);
  assert.match(js,/feedComplete=feed\?\.detailsComplete===true&&feed\?\.paginationComplete!==false&&feed\?\.coverage\?\.status!=='PARTIAL'/);
});

test('r20 production version is consistent',()=>{
  assert.match(html,/v9 · r20 · COIN-M COMMAND CENTER/);
  assert.match(html,/9\.0-r20/);
});
