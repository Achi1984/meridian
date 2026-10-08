// MERIDIAN11-A0-SHELL-CONTRACT-R1 — static contract checks; public-safe non-production preview.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const html=readFileSync(new URL('../v11/index.html',import.meta.url),'utf8');
const keys=['command','depot','bots','market','research'];
const labels=['COMMAND','DEPOT','BOTS','FORECAST','SCANNER'];
const nav=html.match(/<nav\b[^>]*id="nav"[^>]*>([\s\S]*?)<\/nav>/i)?.[1];
const buttons=[...(nav||'').matchAll(/<button\b([^>]*data-v="([^"]+)"[^>]*)>([\s\S]*?)<\/button>/g)];
const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];

test('A0: five accessible linked tabs, unique IDs and initial view',()=>{
 assert.ok(nav,'navigation exists');
 assert.deepEqual(buttons.map(m=>m[2]),keys);
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
 assert.equal(new Set(ids).size,ids.length,'duplicate ids');
 keys.forEach((key,i)=>{
   assert.ok(buttons[i][3].includes('<span>'+labels[i]+'</span>'));
   assert.match(buttons[i][1],new RegExp('aria-controls="view-'+key+'"'));
   const section=html.match(new RegExp('<section\\b([^>]*id="view-'+key+'"[^>]*)>'))?.[1];
   assert.ok(section,'missing view '+key);
   assert.equal(/\bhidden\b/.test(section),key!=='command','hidden state '+key);
 });
 assert.match(html,/#nav button\{[^}]*min-height:5[0-9]px/);
 assert.match(html,/safe-area-inset-bottom/);
 assert.match(html,/focus-visible/);
});

test('A0: exactly one decision and unknown data fail closed',()=>{
 assert.equal((html.match(/data-decision-owner=/g)||[]).length,1);
 assert.match(html,/data-preview-mode="static-no-live-data"/);
 assert.match(html,/data-execution-impact="false"/);
 assert.match(html,/JETZT WICHTIG[\s\S]*?UNGEKLÄRT/);
 assert.match(html,/<div class="portfolio-value"[^>]*>—<\/div>/);
 assert.match(html,/Gesamtwert nicht verifiziert/);
 assert.match(html,/Fehlende Daten sind keine Entwarnung/);
 assert.equal((html.match(/class="command-source-details"/g)||[]).length,1);
 assert.match(html,/NICHT PRODUKTIV/);
});

test('A0: no live imports, network, credentials, orders or PWA bootstrap',()=>{
 assert.equal((html.match(/<script\\b/gi)||[]).length,1,'exactly one script element');
 assert.match(html,/<script>/,'script must have no attributes');
 assert.doesNotMatch(html,/<(?:img|base|object|embed|source|video|audio|link)\b|<meta[^>]*http-equiv=["']refresh|\bon[a-z]+\s*=|javascript:|url\s*\(/i);
 assert.equal(scripts.length,1,'navigation-only inline script');
 assert.doesNotMatch(html,/<script\b[^>]*\bsrc\s*=|<iframe\b|<form\b|@import\b/i);
 assert.doesNotMatch(html,/<link\b[^>]*rel=["']manifest/i);
 const js=scripts[0][1].replace(/\/\*[\s\S]*?\*\//g,'');
 assert.doesNotMatch(js,/\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts|localStorage|sessionStorage|indexedDB|serviceWorker|readToken|MERIDIAN_V10_BRIDGE)\b/);
 assert.doesNotMatch(js,/\b(import|require|eval|Function|setInterval|setTimeout)\s*\(/);
 assert.doesNotMatch(js,/window\.location|document\.cookie|postMessage|\.submit\s*\(/);
 assert.match(js,/nav\.addEventListener\('click'/);
 assert.match(js,/view\.hidden = key !== name/);
 assert.match(js,/setAttribute\('aria-current', 'page'\)/);
});
