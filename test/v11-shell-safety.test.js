// MERIDIAN11-A0-SHELL-CONTRACT-R1 — static contract checks; public-safe non-production preview.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const html=readFileSync(new URL('../v11/index.html',import.meta.url),'utf8');
const keys=['command','depot','bots','market','strategies'];
const labels=['COMMAND','DEPOT','BOTS','FORECAST','STRATEGIEN'];
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
 assert.match(html,/data-preview-mode="manual-bot-depot-read-only"/);
 assert.match(html,/data-execution-impact="false"/);
 const decision=html.match(/<section\b(?=[^>]*\bdata-decision-owner=)[^>]*>[\s\S]*?<\/section>/)?.[0];
 assert.ok(decision,'single risk decision section exists');
 assert.match(decision,/RISIKOSTATUS[\s\S]*?UNBEKANNT/);
 assert.match(decision,/Keine bestätigte Risikoprüfung/);
 assert.match(decision,/Fehlende Daten sind keine Entwarnung/);
 assert.match(html,/<div class="portfolio-value"[^>]*>—<\/div>/);
 assert.match(html,/Gesamtwert nicht verifiziert/);
 assert.match(html,/Fehlende Daten sind keine Entwarnung/);
 assert.equal((html.match(/class="command-source-details"/g)||[]).length,1);
 assert.match(html,/NICHT PRODUKTIV/);
});

test('A0: no live imports, network, credentials, orders or PWA bootstrap',()=>{
 assert.deepEqual([...html.matchAll(/<script\b[^>]*>/gi)].map(match=>match[0]),[
   '<script>',
   '<script type="module" src="./app-access-bootstrap.js?v=B16-M11-FIX1">',
   '<script type="module" src="./bot-read-bootstrap.js?v=B16-M11-FIX1">',
   '<script type="module" src="./depot-read-bootstrap.js?v=B16-M11-FIX1">',
   '<script type="module" src="./strategy-workspace-bootstrap.js?v=B16-M11-FIX1">',
   '<script type="module" src="./agent-status-bootstrap.js?v=B16-M11-FIX1">'
 ],'one unchanged navigation script and five exact approved module entries');
 assert.match(html,/<script>/,'script must have no attributes');
 const agentStatusStylesheet='<link rel="stylesheet" href="../public/css/m11-agent-status.css">';
 assert.equal(html.split(agentStatusStylesheet).length-1,1,'one exact approved agent-status stylesheet');
 assert.doesNotMatch(html.replace(agentStatusStylesheet,''),/<(?:img|base|object|embed|source|video|audio|link)\b|<meta[^>]*http-equiv=["']refresh|\bon[a-z]+\s*=|javascript:|url\s*\(/i);
 assert.equal(scripts.length,1,'navigation-only inline script');
 for(const module of ['app-access-bootstrap.js','bot-read-bootstrap.js','depot-read-bootstrap.js','strategy-workspace-bootstrap.js','agent-status-bootstrap.js'])
  assert.ok(html.includes(`<script type="module" src="./${module}?v=B16-M11-FIX1"></script>`));
 assert.equal((html.match(/<form\b/g)||[]).length,1,'one app-opening form');
 assert.equal((html.match(/type="password"/g)||[]).length,1,'one masked app password input');
 const withoutGate=html.replace(/<form id="app-access-form">[\s\S]*?<\/form>/,'')
   .replace(/<script type="module" src="[^"]+"><\/script>/g,'');
 assert.doesNotMatch(withoutGate,/<script\b[^>]*\bsrc\s*=|<iframe\b|<form\b|@import\b/i);
 assert.match(html,/id="view-strategies"/);
 assert.doesNotMatch(html,/href="\.\.\/v10\/"/);
 assert.doesNotMatch(html,/<link\b[^>]*rel=["']manifest/i);
 const js=scripts[0][1].replace(/\/\*[\s\S]*?\*\//g,'');
 assert.doesNotMatch(js,/\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts|localStorage|sessionStorage|indexedDB|serviceWorker|readToken|MERIDIAN_V10_BRIDGE)\b/);
 assert.doesNotMatch(js,/\b(import|require|eval|Function|setInterval|setTimeout)\s*\(/);
 assert.doesNotMatch(js,/window\.location|document\.cookie|postMessage|\.submit\s*\(/);
 assert.match(js,/nav\.addEventListener\('click'/);
 assert.match(js,/view\.hidden = key !== name/);
 assert.match(js,/setAttribute\('aria-current', 'page'\)/);
});
