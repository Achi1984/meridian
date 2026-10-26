import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../v11/index.html',import.meta.url),'utf8');
const strip=html.match(/<details id="autonomy-status"[\s\S]*?<\/details>/)?.[0];
test('autonomy status is persistent and unknown without telemetry',()=>{
 assert.ok(strip);
 assert.ok(html.indexOf(strip)<html.indexOf('<main '));
 assert.match(strip,/data-state="unknown" data-source="none"/);
 assert.match(strip,/Kein aktuelles Betriebssignal/);
 assert.match(strip,/Aktuelle Aufgabe:<\/b> Nicht verifiziert/);
 assert.match(strip,/Letztes Lebenszeichen:<\/b> Nicht verfügbar/);
 assert.doesNotMatch(strip,/data-state="(?:active|waiting|blocked|paused)"|role="status"/);
});
test('historical UI evidence is separate from current operation and draft revision',()=>{
 assert.match(strip,/Diese Vorschau · B14/);
 assert.match(html,/<li><strong>Meridian 11 · B12<\/strong><span class="version-status">Entwurf<\/span>/);
 assert.match(strip,/Vorige Vorschau · B11/);
 assert.match(strip,/Vorige Vorschau · B10/);
 assert.match(strip,/Kontrollierte Testvorschau · Geräteabnahme ausstehend/);
 assert.match(strip,/https:\/\/github.com\/Achi1984\/meridian\/issues\/766/);
 assert.doesNotMatch(strip,/Integrationszeit und Änderungsnachweis stehen|Noch nicht veröffentlicht/);
 assert.match(strip,/Zuletzt belegte UI-Änderung · B1/);
 assert.match(strip,/datetime="2026-10-11T19:30:28Z"/);
 assert.match(strip,/https:\/\/github.com\/Achi1984\/meridian\/pull\/702/);
 assert.match(strip,/Versionsstand ist kein Lebenszeichen/);
 assert.match(html,/>11 · Vorschau B14<small>/);
});
