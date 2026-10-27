import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {readFileSync, existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {join} from 'node:path';
import {withMobileChrome} from './helpers/v11-cdp.mjs';

const html=readFileSync(new URL('../v11/index.html',import.meta.url),'utf8');
const globalHtml=html;
const terminal=readFileSync(new URL('../v10/index.html',import.meta.url),'utf8');
// PR #677: base a5ba7eca2004ce51ec98720955b5fcc3716f09ef + history-close delta.
// Scope approved in #571 comment 6107229650; terminal-entry insertions removed
// for this baseline. PR #699 additionally reverses only the viewport fallback
// pair below before hashing. B10 is reversed from exact literal presentation
// deltas; the Depot packet reverses its exact asserted markup below as well.
// All other bytes and browser assertions stay guarded.
const preimageBlob='e7fe56dd456641e40b54f5d5b047176523c27592';
const css=`    /* Fixed packet A: visible terminal entry; no data or execution changes. */
    .terminal-entry{max-width:var(--container);margin:12px auto 0;display:flex;justify-content:flex-start;min-width:0}
    .terminal-entry-link{display:inline-flex;align-items:center;justify-content:center;min-height:44px;min-width:44px;max-width:100%;padding:10px 14px;border:1px solid #44607b;border-radius:10px;background:#142235;color:#d7e6f6;font-size:13px;line-height:1.5;font-weight:650;text-underline-offset:3px;overflow-wrap:anywhere}
    .terminal-entry-link:focus-visible{outline:3px solid #9bc9ff;outline-offset:3px}
`;
const entry=`    <nav class="terminal-entry" aria-label="Terminal-Zugang">
      <a class="terminal-entry-link" href="../v10/">Terminal öffnen</a>
    </nav>
`;
// Exact Depot-only delta; no wildcard removal and the original baseline hash stays fixed.
const depotBefore=`      <div class="card view-placeholder"><h2>Portfolio mit Herkunft statt Schätzungen.</h2><p>Für die nächste Ausbaustufe vorgesehen: bestätigter Gesamtwert, Vermögensstruktur und geprüfter Verlauf über 1h / 1d / 1w. In dieser Vorschau sind keine Daten verbunden.</p></div>`;
const depotAfter=`      <section class="card" aria-labelledby="depot-summary-heading">
        <div class="card-head"><h2 id="depot-summary-heading">Depotübersicht</h2><span class="limited">Statische Vorschau</span></div>
        <div class="portfolio-row"><div><p class="caption">Gesamtwert</p><div class="portfolio-value" aria-label="Gesamtwert unbekannt">—</div><p class="portfolio-description">Unbekannt</p></div></div>
        <p class="caption">Keine Depotdaten verbunden. Der Wert ist unbekannt – nicht null.</p>
        <div class="trust-grid" aria-label="Datenstatus des Depots">
          <div class="trust-cell"><strong>Quelle</strong><span>Nicht verbunden</span></div>
          <div class="trust-cell"><strong>Aktualität</strong><span>Keine bestätigten Daten</span></div>
          <div class="trust-cell"><strong>Verlauf</strong><span>Nicht verfügbar</span></div>
        </div>
      </section>
      <section class="card card-muted" aria-labelledby="depot-holdings-heading">
        <h2 id="depot-holdings-heading">Deine Bestände</h2>
        <p class="caption">Ohne bestätigte Daten lassen sich Bestände und Verteilung nicht anzeigen.</p>
      </section>
      <p class="caption">Diese Vorschau hat keinen Kontozugriff. „Terminal öffnen“ führt zum separaten Terminal.</p>`;
// Exact preview revision delta; the historical baseline remains unchanged.
const revisionBefore="11 · Vorschau<small>Versionsverlauf ▾</small>";
const revisionAfter="11 · Vorschau #700<small>Versionsverlauf ▾</small>";
const revisionRow="        <li><strong>Meridian 11 · #700</strong><span class=\"version-status\">Vorschaustand</span><p>Depotübersicht mit klar gekennzeichnetem Gesamtwert, Datenquelle und Aktualität. Ohne Live-Daten. <a href=\"https://github.com/Achi1984/meridian/pull/700\">Änderungsnachweis #700</a></p></li>\n";
// Exact Bots B1 preview delta; do not relax the historical source guard.
const botsBefore='      <div class="card view-placeholder"><h2>Jeder Bot. Klarer Status.</h2><p>Geplant sind verifizierte Bot-Karten mit Quelle, Gebühren, Risikopuffer und Schutzstatus. Ohne Live-Belege wird nichts als sicher oder profitabel markiert.</p></div>';
const botsAfter=`      <section class="card view-placeholder" aria-labelledby="bots-summary-heading">
        <div class="card-head"><h2 id="bots-summary-heading">Botübersicht</h2><span class="limited">Statische Vorschau</span></div>
        <div class="portfolio-row"><div><p class="caption">Aktive Bots</p><div class="portfolio-value" aria-label="Anzahl aktiver Bots unbekannt">—</div><p class="portfolio-description">Unbekannt</p></div></div>
        <p class="caption">Keine Botdaten verbunden. Die Anzahl ist unbekannt – nicht null.</p>
        <div class="trust-grid" aria-label="Datenstatus der Bots">
          <div class="trust-cell"><strong>Quelle</strong><span>Nicht verbunden</span></div>
          <div class="trust-cell"><strong>Aktualität</strong><span>Keine bestätigten Daten</span></div>
          <div class="trust-cell"><strong>Risiko</strong><span>Nicht bestimmbar</span></div>
        </div>
      </section>
      <section class="card card-muted" aria-labelledby="bots-status-heading">
        <h2 id="bots-status-heading">Deine Bots</h2>
        <p class="caption">Ohne bestätigte Botdaten sind Gebühren, Risikopuffer und Schutzstatus unbekannt. Fehlende Daten sind keine Entwarnung.</p>
      </section>
      <p class="caption">Diese Vorschau hat keinen Kontozugriff und steuert keine Bots. „Terminal öffnen“ führt zum separaten Terminal.</p>`;
const botPresentationMarkupBefore=`      <section class="card view-placeholder" aria-labelledby="bots-summary-heading">
        <div class="card-head"><h2 id="bots-summary-heading">Botübersicht</h2><span class="limited">Nur lesend</span></div>
        <div class="portfolio-row"><div><p class="caption">Aktive Bots</p><div class="portfolio-value" aria-label="Anzahl aktiver Bots unbekannt">—</div><p class="portfolio-description">Unbekannt</p></div></div>
        <p class="caption">Aktive Bot-Prozesse werden nicht überwacht. Die Anzahl im gelesenen Snapshot erscheint unten.</p>
        <div class="trust-grid" aria-label="Datenstatus der Bots">
          <div class="trust-cell"><strong>Quelle</strong><span>Snapshot unten</span></div>
          <div class="trust-cell"><strong>Aktualität</strong><span>Je manueller Abfrage</span></div>
          <div class="trust-cell"><strong>Risiko</strong><span>Nicht bestimmbar</span></div>
        </div>
      </section>
      <section class="card card-muted" aria-labelledby="bots-status-heading">
        <h2 id="bots-status-heading">Deine Bots</h2>
        <div id="bot-read-root"></div>
        <p class="caption">Ohne bestätigte Botdaten sind Gebühren, Risikopuffer und Schutzstatus unbekannt. Fehlende Daten sind keine Entwarnung.</p>
      </section>
      <p class="caption">Nur manuelle Leseabfragen. Diese Ansicht steuert keine Bots. Strategieforschung ist von deinen Pionex-Snapshots getrennt.</p>`;
const compactBotsMarkup=`      <section class="card card-muted" aria-labelledby="bots-status-heading">
        <h2 id="bots-status-heading">Deine Bots</h2>
        <div id="bot-read-root"></div>
        <p class="caption">Ohne bestätigte Botdaten sind Gebühren, Risikopuffer und Schutzstatus unbekannt. Fehlende Daten sind keine Entwarnung.</p>
      </section>
      <p class="caption">Nur manuelle Leseabfragen. Diese Ansicht steuert keine Bots. Strategieforschung ist von deinen Pionex-Snapshots getrennt.</p>`;
const botsRevisionLabel='11 · Vorschau B1<small>Versionsverlauf ▾</small>';
const botsRevisionRow='        <li><strong>Meridian 11 · B1</strong><span class="version-status">Vorschaustand</span><p>Botübersicht mit unbekannter Anzahl, Datenquelle, Aktualität und Risikostatus. Statische Vorschau ohne Kontozugriff.</p></li>\n';
// Exact B2 additions: reverse only these literal bytes; preserve the historical hash.
const autonomyCss="    .autonomy-strip{max-width:var(--container);margin:12px auto 0;padding:12px 14px;border:1px solid #776346;border-radius:12px;background:#171e29;overflow-wrap:anywhere}\n    .autonomy-strip h2{font-size:13px;margin-bottom:4px}\n    .autonomy-strip p,.autonomy-strip summary{font-size:12px;letter-spacing:0}\n    .autonomy-strip strong{color:var(--state-unknown)}\n    .autonomy-strip details{margin:8px 0 0;background:transparent}\n    .autonomy-strip a{color:#a9d4ff;text-underline-offset:3px}\n";
const autonomyStrip="    <section id=\"autonomy-status\" class=\"autonomy-strip\" aria-labelledby=\"autonomy-heading\" data-state=\"unknown\" data-source=\"none\">\n      <h2 id=\"autonomy-heading\">Autonome Entwicklung · <strong>Unbekannt</strong></h2>\n      <p>Kein aktuelles Betriebssignal verbunden. Ob ein Agent arbeitet oder warum er wartet, ist hier nicht feststellbar.</p>\n      <details>\n        <summary><span>Betrieb &amp; letzte Änderung</span><span aria-hidden=\"true\">+</span></summary>\n        <div class=\"details-body\">\n          <p><b>Aktuelle Aufgabe:</b> Nicht verifiziert.</p>\n          <p><b>Letztes Lebenszeichen:</b> Nicht verfügbar. Diese Anzeige überwacht den Betrieb noch nicht.</p>\n          <p><b>Diese Vorschau · B2:</b> Statusleiste ergänzt. Integrationszeit und Änderungsnachweis stehen für diesen Entwurf noch aus.</p>\n          <p><b>Zuletzt belegte UI-Änderung · B1:</b> Botübersicht mit Quellen- und Risikostatus. Integriert am <time datetime=\"2026-10-11T19:30:28Z\">11.10.2026, 21:30 Uhr Wien</time> · <a href=\"https://github.com/Achi1984/meridian/pull/702\">Änderungsnachweis #702</a>.</p>\n          <p>Der Versionsstand ist kein Lebenszeichen eines Entwicklungsagenten.</p>\n        </div>\n      </details>\n    </section>\n";
const autonomyRevisionRow="        <li><strong>Meridian 11 · B2</strong><span class=\"version-status\">Vorschaustand</span><p>Statusleiste für autonome Entwicklung mit ausdrücklich unbekanntem Betriebsstatus. Noch ohne Betriebssignal.</p></li>\n";
const autonomyRevisionLabel="11 · Vorschau B2<small>Versionsverlauf ▾</small>";
const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium'].find(path=>path&&existsSync(path));

function gitBlob(content){
  return createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest('hex');
}

// Exact B3 source deltas; reverse only these literal bounded blocks.
const b3Deltas=[
  [
    "  <meta http-equiv=\"Cache-Control\" content=\"no-cache, no-store, must-revalidate\">\n  <title>MERIDIAN 11 — Next Generation · Entwurf</title>\n  <!-- GATE A0: Standalone public source preview. No manifest, API, token, data engine, storage, orders or service worker.\n       The v9 engine is intentionally NOT loaded until the single-engine / lifecycle / safety tests exist.\n       Noindex does not make this private: any future Pages publication makes the source publicly accessible. -->\n",
    "  <meta http-equiv=\"Cache-Control\" content=\"no-cache, no-store, must-revalidate\">\n  <title>MERIDIAN 11 — Next Generation · Entwurf</title>\n  <!-- B3 DRAFT: Manual read-only bot access; no persistence, automatic request, engine, orders or service worker.\n       The v9 engine is intentionally NOT loaded until the single-engine / lifecycle / safety tests exist.\n       Noindex does not make this private: any future Pages publication makes the source publicly accessible. -->\n"
  ],
  [
    "    .autonomy-strip details{margin:8px 0 0;background:transparent}\n    .autonomy-strip a{color:#a9d4ff;text-underline-offset:3px}\n  </style>\n</head>\n<body>\n<a class=\"skip-link\" href=\"#app-main\">Zum Inhalt</a>\n<div id=\"app\" class=\"app-shell v11-shell\" data-ui-generation=\"11\" data-preview-mode=\"static-no-live-data\" data-execution-impact=\"false\">\n  <header class=\"topbar\">\n    <div class=\"header-inner\">\n",
    "    .autonomy-strip details{margin:8px 0 0;background:transparent}\n    .autonomy-strip a{color:#a9d4ff;text-underline-offset:3px}\n    .bot-access-controls{display:grid;gap:10px;margin:14px 0}\n    .bot-access-controls input{width:100%;min-width:0;min-height:44px;font-size:16px;color:var(--text);background:#101b28;border:1px solid #567a9f;border-radius:8px;padding:8px}\n    .bot-access-controls button,.bot-read-view button{min-width:44px;min-height:44px;white-space:normal;border:1px solid #567a9f;border-radius:8px;padding:10px;background:#142235;color:var(--text);margin:4px 4px 4px 0}\n    .bot-access-controls input:focus-visible{outline:3px solid #9bc9ff;outline-offset:3px}\n    .bot-access-controls p,.bot-read-view p,.bot-read-view time{overflow-wrap:anywhere;font-size:13px}\n    .bot-read-view li{margin:12px 0}.bot-read-view ul{padding-left:20px}\n  </style>\n</head>\n<body>\n<a class=\"skip-link\" href=\"#app-main\">Zum Inhalt</a>\n<div id=\"app\" class=\"app-shell v11-shell\" data-ui-generation=\"11\" data-preview-mode=\"manual-bot-read-only\" data-execution-impact=\"false\">\n  <header class=\"topbar\">\n    <div class=\"header-inner\">\n"
  ],
  [
    "        <div class=\"brand\">MERIDIAN <span aria-label=\"Version 11\">11</span><small>NEXT GENERATION</small></div>\n      </div>\n      <button id=\"version-toggle\" type=\"button\" class=\"preview-pill version-toggle\" aria-expanded=\"false\" aria-controls=\"version-panel\">11 · Vorschau B2<small>Versionsverlauf ▾</small></button>\n    </div>\n    <nav class=\"terminal-entry\" aria-label=\"Terminal-Zugang\">\n",
    "        <div class=\"brand\">MERIDIAN <span aria-label=\"Version 11\">11</span><small>NEXT GENERATION</small></div>\n      </div>\n      <button id=\"version-toggle\" type=\"button\" class=\"preview-pill version-toggle\" aria-expanded=\"false\" aria-controls=\"version-panel\">11 · Vorschau B3<small>Versionsverlauf ▾</small></button>\n    </div>\n    <nav class=\"terminal-entry\" aria-label=\"Terminal-Zugang\">\n"
  ],
  [
    "          <p><b>Aktuelle Aufgabe:</b> Nicht verifiziert.</p>\n          <p><b>Letztes Lebenszeichen:</b> Nicht verfügbar. Diese Anzeige überwacht den Betrieb noch nicht.</p>\n          <p><b>Diese Vorschau · B2:</b> Statusleiste ergänzt. Integrationszeit und Änderungsnachweis stehen für diesen Entwurf noch aus.</p>\n          <p><b>Zuletzt belegte UI-Änderung · B1:</b> Botübersicht mit Quellen- und Risikostatus. Integriert am <time datetime=\"2026-10-11T19:30:28Z\">11.10.2026, 21:30 Uhr Wien</time> · <a href=\"https://github.com/Achi1984/meridian/pull/702\">Änderungsnachweis #702</a>.</p>\n          <p>Der Versionsstand ist kein Lebenszeichen eines Entwicklungsagenten.</p>\n",
    "          <p><b>Aktuelle Aufgabe:</b> Nicht verifiziert.</p>\n          <p><b>Letztes Lebenszeichen:</b> Nicht verfügbar. Diese Anzeige überwacht den Betrieb noch nicht.</p>\n          <p><b>Diese Vorschau · B3:</b> Kontrollierte Testvorschau · Geräteabnahme ausstehend. Manueller, temporärer Lesezugang für Bot-Snapshots · <a href=\"https://github.com/Achi1984/meridian/pull/740\">Änderungsnachweis #740</a>.</p>\n          <p><b>Zuletzt belegte UI-Änderung · B1:</b> Botübersicht mit Quellen- und Risikostatus. Integriert am <time datetime=\"2026-10-11T19:30:28Z\">11.10.2026, 21:30 Uhr Wien</time> · <a href=\"https://github.com/Achi1984/meridian/pull/702\">Änderungsnachweis #702</a>.</p>\n          <p>Der Versionsstand ist kein Lebenszeichen eines Entwicklungsagenten.</p>\n"
  ],
  [
    "      <p>Veröffentlichtes Terminal und Designvorschau sind getrennte Stände.</p>\n      <ul class=\"version-history-list\">\n        <li><strong>Meridian 11 · B2</strong><span class=\"version-status\">Vorschaustand</span><p>Statusleiste für autonome Entwicklung mit ausdrücklich unbekanntem Betriebsstatus. Noch ohne Betriebssignal.</p></li>\n        <li><strong>Meridian 11 · B1</strong><span class=\"version-status\">Vorschaustand</span><p>Botübersicht mit unbekannter Anzahl, Datenquelle, Aktualität und Risikostatus. Statische Vorschau ohne Kontozugriff.</p></li>\n",
    "      <p>Veröffentlichtes Terminal und Designvorschau sind getrennte Stände.</p>\n      <ul class=\"version-history-list\">\n        <li><strong>Meridian 11 · B3</strong><span class=\"version-status\">Entwurf</span><p>Manueller Bot-Lesezugang ohne Speicherung oder automatische Abfragen. Kontrollierte Testvorschau · Geräteabnahme ausstehend. <a href=\"https://github.com/Achi1984/meridian/pull/740\">Änderungsnachweis #740</a>.</p></li>\n        <li><strong>Meridian 11 · B2</strong><span class=\"version-status\">Vorschaustand</span><p>Statusleiste für autonome Entwicklung mit ausdrücklich unbekanntem Betriebsstatus. Noch ohne Betriebssignal.</p></li>\n        <li><strong>Meridian 11 · B1</strong><span class=\"version-status\">Vorschaustand</span><p>Botübersicht mit unbekannter Anzahl, Datenquelle, Aktualität und Risikostatus. Statische Vorschau ohne Kontozugriff.</p></li>\n"
  ],
  [
    "        <div class=\"card-head\"><span class=\"card-kicker\">JETZT WICHTIG</span><span class=\"limited\">UNGEKLÄRT</span></div>\n        <h2>Datenanbindung steht noch aus</h2>\n        <p>In dieser Vorschau liegen keine verifizierten Depot-, Bot- oder Marktdaten vor. Es wird keine Aussage über Liquidationsgefahr oder Handelsschutz getroffen.</p>\n        <div class=\"footnote\">Keine Handlungsempfehlung · Keine automatische Order · Vorschau ohne Kontozugriff</div>\n      </section>\n      <section class=\"card\" aria-label=\"Portfolio\">\n",
    "        <div class=\"card-head\"><span class=\"card-kicker\">JETZT WICHTIG</span><span class=\"limited\">UNGEKLÄRT</span></div>\n        <h2>Datenanbindung steht noch aus</h2>\n        <p>Diese Übersicht verarbeitet keine Depot- oder Marktdaten. Bot-Snapshots können ausschließlich im Bots-Tab manuell gelesen werden. Es wird keine Aussage über Liquidationsgefahr oder Handelsschutz getroffen.</p>\n        <div class=\"footnote\">Keine Handlungsempfehlung · Keine automatische Order · Manueller Bot-Lesezugang separat</div>\n      </section>\n      <section class=\"card\" aria-label=\"Portfolio\">\n"
  ],
  [
    "        <summary><span>DATEN &amp; QUELLEN</span><span aria-hidden=\"true\">+</span></summary>\n        <div class=\"details-body\">\n          <p><b>Modus:</b> Statische, öffentliche Entwicklungs-Vorschau.</p>\n          <p><b>Daten:</b> Keine Live-Feeds, keine private Kontoanbindung, keine Handelsfreigabe.</p>\n          <p><b>Grundlage:</b> MERIDIAN 11 Architekturentscheid #603. Die geprüfte v10-Engine bleibt separat.</p>\n          <section id=\"data-state-preview\" class=\"data-state-preview\" aria-labelledby=\"state-preview-heading\">\n",
    "        <summary><span>DATEN &amp; QUELLEN</span><span aria-hidden=\"true\">+</span></summary>\n        <div class=\"details-body\">\n          <p><b>Modus:</b> Öffentliche Entwicklungs-Vorschau mit optionalem manuellem Bot-Lesezugang.</p>\n          <p><b>Daten:</b> Keine automatischen Abfragen, keine Handelsfreigabe. Bot-Snapshots erst nach ausdrücklicher manueller Abfrage.</p>\n          <p><b>Grundlage:</b> MERIDIAN 11 Architekturentscheid #603. Die geprüfte v10-Engine bleibt separat.</p>\n          <section id=\"data-state-preview\" class=\"data-state-preview\" aria-labelledby=\"state-preview-heading\">\n"
  ],
  [
    "        <p class=\"caption\">Ohne bestätigte Daten lassen sich Bestände und Verteilung nicht anzeigen.</p>\n      </section>\n      <p class=\"caption\">Diese Vorschau hat keinen Kontozugriff. „Terminal öffnen“ führt zum separaten Terminal.</p>\n    </section>\n    <section id=\"view-bots\" class=\"view\" aria-labelledby=\"bots-heading\" hidden>\n      <div class=\"eyebrow\">RISIKO &amp; KONTROLLE</div><h1 id=\"bots-heading\">Bots</h1>\n      <section class=\"card view-placeholder\" aria-labelledby=\"bots-summary-heading\">\n        <div class=\"card-head\"><h2 id=\"bots-summary-heading\">Botübersicht</h2><span class=\"limited\">Statische Vorschau</span></div>\n        <div class=\"portfolio-row\"><div><p class=\"caption\">Aktive Bots</p><div class=\"portfolio-value\" aria-label=\"Anzahl aktiver Bots unbekannt\">—</div><p class=\"portfolio-description\">Unbekannt</p></div></div>\n        <p class=\"caption\">Keine Botdaten verbunden. Die Anzahl ist unbekannt – nicht null.</p>\n        <div class=\"trust-grid\" aria-label=\"Datenstatus der Bots\">\n          <div class=\"trust-cell\"><strong>Quelle</strong><span>Nicht verbunden</span></div>\n          <div class=\"trust-cell\"><strong>Aktualität</strong><span>Keine bestätigten Daten</span></div>\n          <div class=\"trust-cell\"><strong>Risiko</strong><span>Nicht bestimmbar</span></div>\n        </div>\n",
    "        <p class=\"caption\">Ohne bestätigte Daten lassen sich Bestände und Verteilung nicht anzeigen.</p>\n      </section>\n      <p class=\"caption\">Diese Depotansicht ist nicht angebunden. „Terminal öffnen“ führt zum separaten Terminal.</p>\n    </section>\n    <section id=\"view-bots\" class=\"view\" aria-labelledby=\"bots-heading\" hidden>\n      <div class=\"eyebrow\">RISIKO &amp; KONTROLLE</div><h1 id=\"bots-heading\">Bots</h1>\n      <section class=\"card view-placeholder\" aria-labelledby=\"bots-summary-heading\">\n        <div class=\"card-head\"><h2 id=\"bots-summary-heading\">Botübersicht</h2><span class=\"limited\">Nur lesend</span></div>\n        <div class=\"portfolio-row\"><div><p class=\"caption\">Aktive Bots</p><div class=\"portfolio-value\" aria-label=\"Anzahl aktiver Bots unbekannt\">—</div><p class=\"portfolio-description\">Unbekannt</p></div></div>\n        <p class=\"caption\">Aktive Bot-Prozesse werden nicht überwacht. Die Anzahl im gelesenen Snapshot erscheint unten.</p>\n        <div class=\"trust-grid\" aria-label=\"Datenstatus der Bots\">\n          <div class=\"trust-cell\"><strong>Quelle</strong><span>Snapshot unten</span></div>\n          <div class=\"trust-cell\"><strong>Aktualität</strong><span>Je manueller Abfrage</span></div>\n          <div class=\"trust-cell\"><strong>Risiko</strong><span>Nicht bestimmbar</span></div>\n        </div>\n"
  ],
  [
    "      <section class=\"card card-muted\" aria-labelledby=\"bots-status-heading\">\n        <h2 id=\"bots-status-heading\">Deine Bots</h2>\n        <p class=\"caption\">Ohne bestätigte Botdaten sind Gebühren, Risikopuffer und Schutzstatus unbekannt. Fehlende Daten sind keine Entwarnung.</p>\n      </section>\n      <p class=\"caption\">Diese Vorschau hat keinen Kontozugriff und steuert keine Bots. „Terminal öffnen“ führt zum separaten Terminal.</p>\n    </section>\n    <section id=\"view-market\" class=\"view\" aria-labelledby=\"forecast-heading\" hidden>\n",
    "      <section class=\"card card-muted\" aria-labelledby=\"bots-status-heading\">\n        <h2 id=\"bots-status-heading\">Deine Bots</h2>\n        <div class=\"bot-access-controls\">\n          <label for=\"bot-read-token\">Bestehender Meridian-Lesezugang</label>\n          <input id=\"bot-read-token\" type=\"password\" autocomplete=\"off\" autocapitalize=\"none\" spellcheck=\"false\" maxlength=\"4096\" aria-describedby=\"bot-read-access-help\">\n          <p id=\"bot-read-access-help\">Kein Börsen-API-Schlüssel. Der Zugang bleibt nur bis zum Sperren, Verlassen oder Ausblenden dieser Seite im Arbeitsspeicher.</p>\n          <button id=\"bot-read-provide\" type=\"button\">Lesezugang übernehmen</button>\n          <p id=\"bot-read-access-status\" role=\"status\" aria-live=\"polite\"></p>\n        </div>\n        <div id=\"bot-read-root\"></div>\n        <p class=\"caption\">Ohne bestätigte Botdaten sind Gebühren, Risikopuffer und Schutzstatus unbekannt. Fehlende Daten sind keine Entwarnung.</p>\n      </section>\n      <p class=\"caption\">Nur manuelle Leseabfragen. Diese Ansicht steuert keine Bots. „Terminal öffnen“ führt zum separaten Terminal.</p>\n    </section>\n    <section id=\"view-market\" class=\"view\" aria-labelledby=\"forecast-heading\" hidden>\n"
  ],
  [
    "})();\n</script>\n</body>\n</html>\n\n\n\n",
    "})();\n</script>\n<script type=\"module\" src=\"./bot-read-bootstrap.js\"></script>\n</body>\n</html>\n"
  ]
];
const b4Deltas=[
  [
    "B3 DRAFT: Manual read-only bot access",
    "B4 DRAFT: Scoped share link or private read-only bot access"
  ],
  [
    "11 · Vorschau B3<small>",
    "11 · Vorschau B4<small>"
  ],
  [
    "<p><b>Diese Vorschau · B3:</b> Kontrollierte Testvorschau · Geräteabnahme ausstehend. Manueller, temporärer Lesezugang für Bot-Snapshots · <a href=\"https://github.com/Achi1984/meridian/pull/740\">Änderungsnachweis #740</a>.</p>",
    "<p><b>Diese Vorschau · B4:</b> Asset-Watch-Freigabelink oder Meridian-Lesepasswort für manuelle Bot-Snapshots. Kontrollierte Testvorschau · Geräteabnahme ausstehend. Aufbauend auf <a href=\"https://github.com/Achi1984/meridian/pull/740\">Botanbindung #740</a>.</p>"
  ],
  [
    "      <ul class=\"version-history-list\">\n",
    "      <ul class=\"version-history-list\">\n        <li><strong>Meridian 11 · B4</strong><span class=\"version-status\">Testvorschau</span><p>Bestehende Asset-Watch-Freigabelinks für manuelle Bot-Abfragen unterstützt. Zugang nur im Arbeitsspeicher; Geräteabnahme ausstehend.</p></li>\n"
  ],
  [
    "Bestehender Meridian-Lesezugang</label>",
    "Asset-Watch-Link oder Meridian-Lesepasswort</label>"
  ],
  [
    "Kein Börsen-API-Schlüssel. Der Zugang bleibt",
    "Bestehenden Asset-Watch-Freigabelink aus Meridian 10 oder Meridian-Lesepasswort einfügen. Kein Börsen-API-Schlüssel. Der Zugang bleibt"
  ]
];
const b5Deltas=[
  [
    "  <!-- B4 DRAFT: Scoped share link or private read-only bot access; no persistence, automatic request, engine, orders or service worker.\n",
    "  <!-- B5 DRAFT: Expandable read-only bot snapshot cards; no persistence, automatic request, engine, orders or service worker.\n"
  ],
  [
    "    .bot-read-view li{margin:12px 0}.bot-read-view ul{padding-left:20px}\n",
    "    .bot-read-view .bot-card-list{list-style:none;padding:0;margin:12px 0;display:grid;gap:12px}\n    .bot-card{border:1px solid #39516b;border-radius:12px;background:#111e2c;overflow:hidden}\n    .bot-card summary{display:block;min-height:44px;padding:14px;cursor:pointer;overflow-wrap:anywhere;letter-spacing:normal;font-size:14px;font-weight:400}\n    .bot-card summary:focus-visible{outline:3px solid #53ddc0;outline-offset:-3px}\n    .bot-card-heading{display:block;font-size:17px;font-weight:700}\n    .bot-card-reference{display:block;color:var(--muted);font-size:11px;margin:6px 0;overflow-wrap:anywhere}\n    .bot-card-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,120px),1fr));gap:12px;margin:12px 0}\n    .bot-card-metrics>div,.bot-card-metrics>span{min-width:0}\n    .bot-card-metrics dt{font-size:12px;color:var(--muted)}\n    .bot-card-metrics dd{margin:4px 0 0;font-size:14px;font-weight:600;overflow-wrap:anywhere}\n    .bot-read-view .bot-card summary span:last-child{transform:none;transition:none;color:inherit;font-size:inherit}\n    .bot-card summary .bot-card-metrics>span>span{font-size:12px;color:var(--muted)}\n    .bot-card summary>span:last-child{font-size:12px;color:var(--muted)}\n    .bot-card summary .bot-card-metrics>span>span,.bot-card summary .bot-card-metrics strong{display:block}\n    .bot-card-body{padding:0 14px 14px;border-top:1px solid #39516b}\n"
  ],
  [
    "      <button id=\"version-toggle\" type=\"button\" class=\"preview-pill version-toggle\" aria-expanded=\"false\" aria-controls=\"version-panel\">11 · Vorschau B4<small>Versionsverlauf ▾</small></button>\n",
    "      <button id=\"version-toggle\" type=\"button\" class=\"preview-pill version-toggle\" aria-expanded=\"false\" aria-controls=\"version-panel\">11 · Vorschau B5<small>Versionsverlauf ▾</small></button>\n"
  ],
  [
    "          <p><b>Diese Vorschau · B4:</b> Asset-Watch-Freigabelink oder Meridian-Lesepasswort für manuelle Bot-Snapshots. Kontrollierte Testvorschau · Geräteabnahme ausstehend. Aufbauend auf <a href=\"https://github.com/Achi1984/meridian/pull/740\">Botanbindung #740</a>.</p>\n",
    "          <p><b>Diese Vorschau · B5:</b> Aufklappbare Botkarten mit verfügbaren Kennzahlen und klar gekennzeichneten Datenlücken. Kontrollierte Testvorschau · Geräteabnahme ausstehend. Aufbauend auf <a href=\"https://github.com/Achi1984/meridian/pull/740\">Botanbindung #740</a>.</p>\n"
  ],
  [
    "",
    "        <li><strong>Meridian 11 · B5</strong><span class=\"version-status\">Testvorschau</span><p>Aufklappbare Botkarten mit Hebel, Kapital, P/L laut Quelle und Preisgrenzen. Fehlende oder nicht eindeutig bestätigte Werte bleiben nicht verfügbar.</p></li>\n"
  ]
];
const b6Deltas=[
  [
    "  <!-- B5 DRAFT: Expandable read-only bot snapshot cards; no persistence, automatic request, engine, orders or service worker.\n",
    "  <!-- B6 DRAFT: Semantic P/L colors in read-only bot snapshot cards; no persistence, automatic request, engine, orders or service worker.\n"
  ],
  [
    "",
    "    .bot-read-view .bot-card .bot-pnl-negative{color:#ff9b9b}\n    .bot-read-view .bot-card .bot-pnl-positive{color:#6ee7b7}\n"
  ],
  [
    "      <button id=\"version-toggle\" type=\"button\" class=\"preview-pill version-toggle\" aria-expanded=\"false\" aria-controls=\"version-panel\">11 · Vorschau B5<small>Versionsverlauf ▾</small></button>\n",
    "      <button id=\"version-toggle\" type=\"button\" class=\"preview-pill version-toggle\" aria-expanded=\"false\" aria-controls=\"version-panel\">11 · Vorschau B6<small>Versionsverlauf ▾</small></button>\n"
  ],
  [
    "          <p><b>Diese Vorschau · B5:</b> Aufklappbare Botkarten mit verfügbaren Kennzahlen und klar gekennzeichneten Datenlücken. Kontrollierte Testvorschau · Geräteabnahme ausstehend. Aufbauend auf <a href=\"https://github.com/Achi1984/meridian/pull/740\">Botanbindung #740</a>.</p>\n",
    "          <p><b>Diese Vorschau · B6:</b> P/L-Werte farblich hervorgehoben: Verlust rot, Gewinn grün. Unbestätigte Werte bleiben neutral. Kontrollierte Testvorschau · Geräteabnahme ausstehend. Aufbauend auf <a href=\"https://github.com/Achi1984/meridian/pull/740\">Botanbindung #740</a>.</p>\n"
  ],
  [
    "",
    "        <li><strong>Meridian 11 · B6</strong><span class=\"version-status\">Testvorschau</span><p>P/L-Farben: Verluste rot, Gewinne grün. Nicht bestätigte Werte bleiben neutral; Vorzeichen und Zahlen bleiben lesbar.</p></li>\n"
  ],
  [
    "<script type=\"module\" src=\"./bot-read-bootstrap.js\"></script>\n",
    "<script type=\"module\" src=\"./bot-read-bootstrap.js?v=B6\"></script>\n"
  ]
];
// Exact r130 disclosure delta; preserve every historical baseline hash.
const r130Deltas=[["        <li><strong>Terminal 10.0-r129</strong><span class=\"version-status\">Aktueller Terminal-Stand</span><p>Isolierte H1/H7-Paper-Simulationen mit Kostenstress und Quellbelegen; H9 wartet auf Daten. Kein laufender Paper-Bot und kein Profitabilitätsnachweis.</p></li>\n","        <li><strong>Terminal 10.0-r130</strong><span class=\"version-status\">Terminal-Stand dieses Builds</span><p>Quellbelege und Grenzen der Arena-Ergebnisse mit strenger Datenprüfung und aufklappbaren Details. Kein neuer Strategielauf und kein Profitabilitätsnachweis. <a href=\"https://github.com/Achi1984/meridian/pull/873\">Änderungsnachweis #873</a></p></li>\n        <li><strong>Terminal 10.0-r129</strong><span class=\"version-status\">Historischer Stand</span><p>Isolierte H1/H7-Paper-Simulationen mit Kostenstress und Quellbelegen; H9 wartet auf Daten. Kein laufender Paper-Bot und kein Profitabilitätsnachweis.</p></li>\n"]];
const r129Deltas=[["        <li><strong>Terminal 10.0-r128</strong><span class=\"version-status\">Aktueller Terminal-Stand</span><p>Einmaliger Meridian-Lesezugang f\u00fcr das Erstellen oder Widerrufen von Asset-Watch-Links. Keine Speicherung des eingegebenen Lesepassworts.</p></li>\n", "        <li><strong>Terminal 10.0-r129</strong><span class=\"version-status\">Aktueller Terminal-Stand</span><p>Isolierte H1/H7-Paper-Simulationen mit Kostenstress und Quellbelegen; H9 wartet auf Daten. Kein laufender Paper-Bot und kein Profitabilit\u00e4tsnachweis.</p></li>\n        <li><strong>Terminal 10.0-r128</strong><span class=\"version-status\">Historischer Stand</span><p>Einmaliger Meridian-Lesezugang f\u00fcr das Erstellen oder Widerrufen von Asset-Watch-Links. Keine Speicherung des eingegebenen Lesepassworts.</p></li>\n"]];
const r128Deltas=[
  [
    "        <li><strong>Terminal 10.0-r127</strong><span class=\"version-status\">Veröffentlichter Stand</span><p>Dokumentierter Terminal-Stand am 10.10.2026. Diese Seite zeigt die separate Meridian-11-Vorschau. <a href=\"https://github.com/Achi1984/meridian/blob/7f76c15876cdda132b2c64be727cc48939094608/version.json\">Versionsnachweis</a></p></li>\n",
    "        <li><strong>Terminal 10.0-r128</strong><span class=\"version-status\">Aktueller Terminal-Stand</span><p>Einmaliger Meridian-Lesezugang für das Erstellen oder Widerrufen von Asset-Watch-Links. Keine Speicherung des eingegebenen Lesepassworts.</p></li>\n        <li><strong>Terminal 10.0-r127</strong><span class=\"version-status\">Historischer Stand</span><p>Dokumentierter Terminal-Stand am 10.10.2026. Diese Seite zeigt die separate Meridian-11-Vorschau. <a href=\"https://github.com/Achi1984/meridian/blob/7f76c15876cdda132b2c64be727cc48939094608/version.json\">Versionsnachweis</a></p></li>\n"
  ]
];
const b10Deltas=[
  ["",`    /* B10: compact preview chrome and keep the validated portfolio first. */
    .topbar{padding-top:calc(8px + env(safe-area-inset-top,0px));padding-bottom:8px}
    .topbar{padding-left:max(16px,calc((100% - var(--container))/2));padding-right:max(16px,calc((100% - var(--container))/2))}
    .header-inner{gap:8px}
    .identity{gap:8px}
    .mark{width:32px;height:32px;border-radius:10px;font-size:20px}
    .brand{font-size:16px}
    .terminal-entry{margin-top:8px}
    .autonomy-strip{max-width:var(--container);margin:8px auto 0;padding:0;border:1px solid #34465c;border-radius:12px;background:#101824;overflow-wrap:anywhere}
    .autonomy-strip>summary{min-height:44px;padding:8px 12px;display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;letter-spacing:0;line-height:1.4}
    .autonomy-strip>summary>span:first-child{min-width:0;overflow-wrap:anywhere}
    .autonomy-strip>summary>span:last-child{flex:none}
    .autonomy-strip .disclosure-hint{font-size:10px;color:var(--muted);font-weight:500;letter-spacing:0}
    .autonomy-strip>summary strong{color:var(--state-unknown)}
    .autonomy-strip[open]>summary{border-bottom:1px solid var(--line)}
    .autonomy-strip>.details-body{border:0;padding:10px 12px}
    #nav{padding-left:max(6px,env(safe-area-inset-left,0px),calc((100% - 740px)/2));padding-right:max(6px,env(safe-area-inset-right,0px),calc((100% - 740px)/2))}
    .container{padding-top:14px}
    .section-intro{margin-bottom:12px}
    .card{padding:16px;margin-bottom:10px}
    .view-placeholder{min-height:132px;padding:18px 16px}
    .command-context-details{margin:10px 0 14px}
    .command-context-details>summary{min-height:48px}
    .command-context-details .details-body p{font-size:12px}
    .module-availability{align-self:flex-start;margin-top:4px}
    @media(max-width:350px){.card{padding:14px}.container{padding-top:12px}.autonomy-strip>summary{padding-left:9px;padding-right:9px}}
`],
  ["      <button id=\"version-toggle\" type=\"button\" class=\"preview-pill version-toggle\" aria-expanded=\"false\" aria-controls=\"version-panel\">11 · Vorschau B9<small>Versionsverlauf ▾</small></button>\n",
   "      <button id=\"version-toggle\" type=\"button\" class=\"preview-pill version-toggle\" aria-expanded=\"false\" aria-controls=\"version-panel\">11 · Vorschau B10<small>Versionsverlauf ▾</small></button>\n"],
  [`    <section id="autonomy-status" class="autonomy-strip" aria-labelledby="autonomy-heading" data-state="unknown" data-source="none">
      <h2 id="autonomy-heading">Autonome Entwicklung · <strong>Unbekannt</strong></h2>
      <p>Kein aktuelles Betriebssignal verbunden. Ob ein Agent arbeitet oder warum er wartet, ist hier nicht feststellbar.</p>
      <details>
        <summary><span>Betrieb &amp; letzte Änderung</span><span aria-hidden="true">+</span></summary>
        <div class="details-body">
          <p><b>Aktuelle Aufgabe:</b> Nicht verifiziert.</p>
          <p><b>Letztes Lebenszeichen:</b> Nicht verfügbar. Diese Anzeige überwacht den Betrieb noch nicht.</p>
          <p><b>Diese Vorschau · B9:</b> Geladene Depotbewertung auch in Command. Verlauf mit Zeitachse und ausgewiesenem Messzeitraum. Kontrollierte Testvorschau · Geräteabnahme ausstehend. <a href="https://github.com/Achi1984/meridian/issues/766">B9-Umfang #766</a>.</p>
          <p><b>Zuletzt belegte UI-Änderung · B1:</b> Botübersicht mit Quellen- und Risikostatus. Integriert am <time datetime="2026-10-11T19:30:28Z">11.10.2026, 21:30 Uhr Wien</time> · <a href="https://github.com/Achi1984/meridian/pull/702">Änderungsnachweis #702</a>.</p>
          <p>Der Versionsstand ist kein Lebenszeichen eines Entwicklungsagenten.</p>
        </div>
      </details>
    </section>
`,
   `    <details id="autonomy-status" class="autonomy-strip" aria-labelledby="autonomy-heading" data-state="unknown" data-source="none">
      <summary><span id="autonomy-heading">Autonome Entwicklung · <strong>Unbekannt</strong><small class="disclosure-hint"> · Details</small></span><span aria-hidden="true">+</span></summary>
      <div class="details-body">
        <p>Kein aktuelles Betriebssignal verbunden. Ob ein Agent arbeitet oder warum er wartet, ist hier nicht feststellbar.</p>
        <p><b>Aktuelle Aufgabe:</b> Nicht verifiziert.</p>
        <p><b>Letztes Lebenszeichen:</b> Nicht verfügbar. Diese Anzeige überwacht den Betrieb noch nicht.</p>
        <p><b>Diese Vorschau · B10:</b> Kompakter Header und klarere Command-Hierarchie. Layout-Entwurf ohne neue Datenanbindung; Integration und Geräteabnahme ausstehend.</p>
        <p><b>Vorige Vorschau · B9:</b> Geladene Depotbewertung auch in Command. Verlauf mit Zeitachse und ausgewiesenem Messzeitraum. Kontrollierte Testvorschau · Geräteabnahme ausstehend. <a href="https://github.com/Achi1984/meridian/issues/766">B9-Umfang #766</a>.</p>
        <p><b>Zuletzt belegte UI-Änderung · B1:</b> Botübersicht mit Quellen- und Risikostatus. Integriert am <time datetime="2026-10-11T19:30:28Z">11.10.2026, 21:30 Uhr Wien</time> · <a href="https://github.com/Achi1984/meridian/pull/702">Änderungsnachweis #702</a>.</p>
        <p>Der Versionsstand ist kein Lebenszeichen eines Entwicklungsagenten.</p>
      </div>
    </details>
`],
  ["",`        <li><strong>Meridian 11 · B10</strong><span class="version-status">Entwurf</span><p>Kompaktere Header- und Command-Hierarchie sowie klare Vorbereitungslabels für Forecast und Scanner. Reines Layout; keine neue Datenanbindung oder Funktionsfreigabe.</p></li>
`],
  ["        <div><div class=\"eyebrow\">COMMAND CENTER</div><h1 id=\"command-heading\">Alles Wesentliche.<br>Ein Blick.</h1><p class=\"sub\">Deine zentrale Übersicht mit manuell geladener Depotbewertung.</p></div>\n",
   "        <div><div class=\"eyebrow\">COMMAND CENTER</div><h1 id=\"command-heading\">Command</h1><p class=\"sub\">Depot-, Bot- und Marktstatus auf einen Blick.</p></div>\n"],
  [`      <section class="card decision" data-decision-owner="preview" aria-label="Jetzt wichtig">
        <div class="card-head"><span class="card-kicker">JETZT WICHTIG</span><span class="limited">UNGEKLÄRT</span></div>
        <h2>Depot im Überblick · Risiko ungeklärt</h2>
        <p>Die im Depot manuell geladene Bewertung erscheint auch hier. Bot-Snapshots werden separat im Bots-Tab geladen. Es wird keine Aussage über Liquidationsgefahr oder Handelsschutz getroffen.</p>
        <div class="footnote">Keine Handlungsempfehlung · Keine automatische Order · Manueller Bot-Lesezugang separat</div>
      </section>
      <section id="command-portfolio" class="card" aria-label="Portfolio">
        <div class="card-head"><span class="card-kicker">PORTFOLIO</span><span class="state-label"><span class="state-dot" aria-hidden="true"></span> NICHT VERBUNDEN</span></div>
        <div class="portfolio-row"><div><div class="portfolio-value" aria-label="Portfoliowert unbekannt">—</div><div class="portfolio-description">Gesamtwert nicht verifiziert</div></div></div>
        <p class="caption">Keine Schätzung, kein Ersatzwert und keine simulierte Performance.</p>
        <div class="trust-grid" aria-label="Datenquellenstatus">
          <div class="trust-cell"><strong>DEPOT</strong><span data-command-depot-status>Unbekannt</span></div>
          <div class="trust-cell"><strong>BOTS</strong><span>Unbekannt</span></div>
          <div class="trust-cell"><strong>MARKT</strong><span>Unbekannt</span></div>
        </div>
      </section>
`,
   `      <section id="command-portfolio" class="card" aria-label="Portfolio">
        <div class="card-head"><span class="card-kicker">PORTFOLIO</span><span class="state-label"><span class="state-dot" aria-hidden="true"></span> NICHT VERBUNDEN</span></div>
        <div class="portfolio-row"><div><div class="portfolio-value" aria-label="Portfoliowert unbekannt">—</div><div class="portfolio-description">Gesamtwert nicht verifiziert</div></div></div>
        <p class="caption">Keine Schätzung, kein Ersatzwert und keine simulierte Performance.</p>
        <div class="trust-grid" aria-label="Datenquellenstatus">
          <div class="trust-cell"><strong>DEPOT</strong><span data-command-depot-status>Unbekannt</span></div>
          <div class="trust-cell"><strong>BOTS</strong><span>Unbekannt</span></div>
          <div class="trust-cell"><strong>MARKT</strong><span>Unbekannt</span></div>
        </div>
      </section>
      <section class="card decision" data-decision-owner="preview" aria-label="Jetzt wichtig">
        <div class="card-head"><span class="card-kicker">JETZT WICHTIG</span><span class="limited">UNGEKLÄRT</span></div>
        <h2>Risiko ungeklärt</h2>
        <p>Es wird keine Aussage über Liquidationsgefahr oder Handelsschutz getroffen. Fehlende Daten sind keine Entwarnung.</p>
      </section>
`],
  ["",`      <details class="command-context-details">
        <summary><span>Einordnung &amp; Datenlage</span><span aria-hidden="true">+</span></summary>
        <div class="details-body">
          <p>Die im Depot manuell geladene Bewertung erscheint auch hier. Bot-Snapshots werden separat im Bots-Tab geladen.</p>
          <p>Keine Handlungsempfehlung · Keine automatische Order · Manueller Bot-Lesezugang separat.</p>
        </div>
      </details>
`],
  ["      <div class=\"card view-placeholder\"><h2>Zonen verstehen. Entscheidungen prüfen.</h2><p>FIB-Zonen, Szenarien und Trendwenden werden später mit verifizierten Quellen und erkennbaren Unsicherheiten dargestellt. Keine Live-Signale in dieser Vorschau.</p></div>\n",
   "      <div class=\"card view-placeholder\"><span class=\"limited module-availability\">In Vorbereitung</span><h2>Marktszenarien nachvollziehbar prüfen</h2><p>Geplant sind FIB-Zonen und Szenarien mit verifizierten Quellen und sichtbarer Unsicherheit. Aktuell sind keine Forecast-Daten oder Live-Signale verfügbar.</p></div>\n"],
  ["      <div class=\"card view-placeholder\"><h2>Chancen erst nach Evidenz.</h2><p>Der Opportunity Scanner bleibt eine Research-Oberfläche. Es werden keine Handelsaufträge, Paper-Bots oder freigegebenen Signale vorgetäuscht.</p></div>\n",
   "      <div class=\"card view-placeholder\"><span class=\"limited module-availability\">In Vorbereitung</span><h2>Research-Chancen erst nach Evidenz</h2><p>Der Scanner soll nachvollziehbare Research-Kandidaten zeigen. Aktuell sind keine Research-Ausgaben oder freigegebenen Signale verfügbar; es entstehen keine Handelsaufträge oder Paper-Bots.</p></div>\n"]
];
const b11Deltas=[
  ["      <button id=\"version-toggle\" type=\"button\" class=\"preview-pill version-toggle\" aria-expanded=\"false\" aria-controls=\"version-panel\">11 · Vorschau B10<small>Versionsverlauf ▾</small></button>\n",
   "      <button id=\"version-toggle\" type=\"button\" class=\"preview-pill version-toggle\" aria-expanded=\"false\" aria-controls=\"version-panel\">11 · Vorschau B11<small>Versionsverlauf ▾</small></button>\n"],
  ["        <p><b>Diese Vorschau · B10:</b> Kompakter Header und klarere Command-Hierarchie. Layout-Entwurf ohne neue Datenanbindung; Integration und Geräteabnahme ausstehend.</p>\n",
   "        <p><b>Diese Vorschau · B11:</b> Manuell geladene Bot-Snapshots filtern, ordnen und mit Command teilen. Nur bestätigte Quellwerte; Sprung zur passenden Karte. Draft, Geräteabnahme ausstehend.</p>\n        <p><b>Vorige Vorschau · B10:</b> Kompakter Header und klarere Command-Hierarchie. Layout-Entwurf ohne neue Datenanbindung; Integration und Geräteabnahme ausstehend.</p>\n"],
  ["        <li><strong>Meridian 11 · B10</strong><span class=\"version-status\">Entwurf</span><p>Kompaktere Header- und Command-Hierarchie sowie klare Vorbereitungslabels für Forecast und Scanner. Reines Layout; keine neue Datenanbindung oder Funktionsfreigabe.</p></li>\n",
   "        <li><strong>Meridian 11 · B11</strong><span class=\"version-status\">Entwurf</span><p>Bot-Cockpit mit Suche, Richtung/Kontraktart-Filtern und deterministischer Sortierung. Command zeigt denselben validierten Snapshot und verlinkt bestätigte Quellverluste zur Karte. Reine Testvorschau; keine Risikorangfolge, neue Datenanbindung oder Funktionsfreigabe.</p></li>\n        <li><strong>Meridian 11 · B10</strong><span class=\"version-status\">Testvorschau</span><p>Kompaktere Header- und Command-Hierarchie sowie klare Vorbereitungslabels für Forecast und Scanner. Reines Layout; keine neue Datenanbindung oder Funktionsfreigabe.</p></li>\n"],
  ["    .bot-read-view .bot-card .bot-pnl-positive{color:#6ee7b7}\n",
   "    .bot-read-view .bot-card .bot-pnl-positive{color:#6ee7b7}\n    .bot-overview-filters{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;margin:12px 0}\n    .bot-overview-filters label{display:block;font-size:12px;color:var(--muted);margin-bottom:4px}\n    .bot-overview-filters input,.bot-overview-filters select{width:100%;min-width:0;min-height:45px;padding:8px;border:1px solid #567a9f;border-radius:8px;background:#101b28;color:var(--text);font-size:16px}\n    .bot-overview-filters button,.command-bot-overview button{min-width:44px;min-height:44px;padding:10px;border:1px solid #567a9f;border-radius:8px;background:#142235;color:var(--text);overflow-wrap:anywhere}\n    .bot-overview-filters :focus-visible,.command-bot-overview button:focus-visible{outline:3px solid #9bc9ff;outline-offset:2px}\n    .command-bot-overview{overflow-wrap:anywhere}\n    .command-bot-overview ul{list-style:none;padding:0;margin:8px 0;display:grid;gap:8px}\n    .command-bot-overview li{min-width:0}\n    .bot-read-view [hidden]{display:none!important}\n    @media(min-width:560px){.bot-overview-filters{grid-template-columns:repeat(2,minmax(0,1fr))}.bot-overview-filters>button{grid-column:1/-1}}\n"],
  ["",`      <section class="card" aria-labelledby="command-bots-heading">
        <div class="card-head"><h2 id="command-bots-heading">Bot-Snapshot</h2><span class="limited">Nur lesend</span></div>
        <div id="command-bot-overview" class="command-bot-overview" role="status" aria-live="polite" aria-atomic="true" data-state="locked">
          <p>Gesperrt</p>
        </div>
      </section>
`],
  ["<script type=\"module\" src=\"./bot-read-bootstrap.js?v=B6\"></script>\n",
   "<script type=\"module\" src=\"./bot-read-bootstrap.js?v=B11\"></script>\n"]
];
const botPresentationCssBefore=`    .bot-read-view .bot-card-list{list-style:none;padding:0;margin:12px 0;display:grid;gap:12px}
    .bot-card{border:1px solid #39516b;border-radius:12px;background:#111e2c;overflow:hidden}
    .bot-card summary{display:block;min-height:44px;padding:14px;cursor:pointer;overflow-wrap:anywhere;letter-spacing:normal;font-size:14px;font-weight:400}
    .bot-card summary:focus-visible{outline:3px solid #53ddc0;outline-offset:-3px}
    .bot-card-heading{display:block;font-size:17px;font-weight:700}
    .bot-card-reference{display:block;color:var(--muted);font-size:11px;margin:6px 0;overflow-wrap:anywhere}
    .bot-card-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,120px),1fr));gap:12px;margin:12px 0}
    .bot-card-metrics>div,.bot-card-metrics>span{min-width:0}
    .bot-card-metrics dt{font-size:12px;color:var(--muted)}
    .bot-card-metrics dd{margin:4px 0 0;font-size:14px;font-weight:600;overflow-wrap:anywhere}
    .bot-read-view .bot-card summary span:last-child{transform:none;transition:none;color:inherit;font-size:inherit}
    .bot-card summary .bot-card-metrics>span>span{font-size:12px;color:var(--muted)}
    .bot-card summary>span:last-child{font-size:12px;color:var(--muted)}
    .bot-card summary .bot-card-metrics>span>span,.bot-card summary .bot-card-metrics strong{display:block}
    .bot-read-view .bot-card .bot-pnl-negative{color:#ff9b9b}
    .bot-read-view .bot-card .bot-pnl-positive{color:#6ee7b7}
    .bot-overview-filters{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;margin:12px 0}
    .bot-overview-filters label{display:block;font-size:12px;color:var(--muted);margin-bottom:4px}
    .bot-overview-filters input,.bot-overview-filters select{width:100%;min-width:0;min-height:45px;padding:8px;border:1px solid #567a9f;border-radius:8px;background:#101b28;color:var(--text);font-size:16px}
    .bot-overview-filters button,.command-bot-overview button{min-width:44px;min-height:44px;padding:10px;border:1px solid #567a9f;border-radius:8px;background:#142235;color:var(--text);overflow-wrap:anywhere}
    .bot-overview-filters :focus-visible,.command-bot-overview button:focus-visible{outline:3px solid #9bc9ff;outline-offset:2px}
    .command-bot-overview{overflow-wrap:anywhere}
    .command-bot-overview ul{list-style:none;padding:0;margin:8px 0;display:grid;gap:8px}
    .command-bot-overview li{min-width:0}
    .bot-read-view [hidden]{display:none!important}
    @media(min-width:560px){.bot-overview-filters{grid-template-columns:repeat(2,minmax(0,1fr))}.bot-overview-filters>button{grid-column:1/-1}}
`;
const botPresentationCssAfter=`    .bot-read-view .bot-card-list{list-style:none;padding:0;margin:8px 0;display:grid;gap:8px}
    .bot-read-view .bot-card-list>li{min-width:0;margin:0}
    .bot-card{margin:0;border:1px solid #39516b;border-radius:12px;background:#111e2c;overflow:hidden}
    .bot-card summary{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"top top" "capital disclosure";align-items:center;gap:4px 8px;min-height:64px;padding:5px 10px;cursor:pointer;overflow-wrap:anywhere;letter-spacing:normal;font-size:14px;font-weight:400;list-style:none}
    .bot-card:not([open])>.bot-card-body{display:none}
    .bot-card[open]>.bot-card-body{display:block}
    .bot-card summary::-webkit-details-marker{display:none}
    .bot-card summary::marker{content:""}
    .bot-read-view .bot-card[open] summary span:last-child{transform:none}
    .bot-read-view .bot-card[open] summary .bot-card-disclosure span{transform:rotate(45deg)}
    .bot-card summary:focus-visible{outline:3px solid #53ddc0;outline-offset:-3px}
    .bot-card-top{grid-area:top;display:grid;grid-template-columns:minmax(0,1fr) minmax(92px,40%);gap:8px;align-items:center;min-width:0}
    .bot-card-identity{min-width:0}
    .bot-card-heading{display:block;font-size:17px;font-weight:700;line-height:1.2;overflow-wrap:anywhere}
    .bot-card-badges{display:flex;flex-wrap:wrap;gap:4px;margin-top:3px}
    .bot-card-badge{display:inline-flex;align-items:center;max-width:100%;padding:2px 6px;border:1px solid #567a9f;border-radius:999px;color:#d7e6f6;font-size:11px;line-height:1.25;overflow-wrap:anywhere}
    .bot-card-pnl{display:grid;justify-items:end;align-content:center;width:100%;min-width:0;text-align:right}
    .bot-card-pnl>span{font-size:11px;color:var(--muted);white-space:nowrap}
    .bot-card-pnl strong{font-size:17px;line-height:1.2;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
    .bot-card-capital{grid-area:capital;display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 8px;min-width:0;font-size:12px;color:var(--muted)}
    .bot-card-capital strong{font-size:12px;font-weight:600;color:var(--text);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
    .bot-card-disclosure{grid-area:disclosure;display:inline-flex;align-items:center;justify-content:flex-end;gap:4px;min-width:44px;min-height:44px;padding-left:8px;color:#a9d4ff;font-size:12px;white-space:nowrap}
    .bot-card-disclosure span{font-size:18px;line-height:1;transition:transform .18s ease}
    .bot-card-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,150px),1fr));gap:8px;margin:10px 0}
    .bot-card-metrics>div,.bot-card-metrics dd{min-width:0;overflow-wrap:anywhere}
    .bot-card-metrics dt{font-size:12px;color:var(--muted)}
    .bot-card-metrics dd{margin:2px 0 0;font-size:14px;font-weight:600}
    .bot-read-view .bot-card .bot-pnl-negative{color:#ff9b9b}
    .bot-read-view .bot-card .bot-pnl-positive{color:#6ee7b7}
    .bot-overview-filters{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;margin:10px 0}
    .bot-overview-filters label{display:block;font-size:12px;color:var(--muted);margin-bottom:4px}
    .bot-overview-filters input,.bot-overview-filters select{width:100%;min-width:0;min-height:44px;padding:8px;border:1px solid #567a9f;border-radius:8px;background:#101b28;color:var(--text);font-size:16px}
    .bot-overview-filters button,.command-bot-overview button{min-width:44px;min-height:44px;padding:10px;border:1px solid #567a9f;border-radius:8px;background:#142235;color:var(--text);overflow-wrap:anywhere}
    .bot-overview-filters :focus-visible,.command-bot-overview button:focus-visible{outline:3px solid #9bc9ff;outline-offset:2px}
    .command-bot-overview{overflow-wrap:anywhere}
    .command-bot-overview ul{list-style:none;padding:0;margin:8px 0;display:grid;gap:8px}
    .command-bot-overview li{min-width:0}
    .bot-read-view [hidden]{display:none!important}
    @media(min-width:360px){.bot-overview-filters{grid-template-columns:repeat(2,minmax(0,1fr))}.bot-overview-filters>button{grid-column:1/-1}}
    @media(min-width:760px){.bot-overview-filters{grid-template-columns:repeat(4,minmax(0,1fr))}}
`;
const botReadControls=`        <div class="bot-access-controls">
          <label for="bot-read-token">Asset-Watch-Link oder Meridian-Lesepasswort</label>
          <input id="bot-read-token" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="4096" aria-describedby="bot-read-access-help">
          <p id="bot-read-access-help">Bestehenden Asset-Watch-Freigabelink aus Meridian 10 oder Meridian-Lesepasswort einfügen. Kein Börsen-API-Schlüssel. Der Zugang bleibt nur bis zum Sperren, Verlassen oder Ausblenden dieser Seite im Arbeitsspeicher.</p>
          <button id="bot-read-provide" type="button">Lesezugang übernehmen</button>
          <p id="bot-read-access-status" role="status" aria-live="polite"></p>
        </div>
`;
const compactBotsMarkupWithAccess=compactBotsMarkup.replace('        <div id="bot-read-root"></div>',botReadControls+'        <div id="bot-read-root"></div>');
const botPresentationMarkupBeforeWithAccess=botPresentationMarkupBefore.replace('        <div id="bot-read-root"></div>',botReadControls+'        <div id="bot-read-root"></div>');
const botPresentationDeltas=[[botPresentationCssBefore,botPresentationCssAfter]];
const b9Deltas=[["      <button id=\"version-toggle\" type=\"button\" class=\"preview-pill version-toggle\" aria-expanded=\"false\" aria-controls=\"version-panel\">11 · Vorschau B8<small>Versionsverlauf ▾</small></button>\n", "      <button id=\"version-toggle\" type=\"button\" class=\"preview-pill version-toggle\" aria-expanded=\"false\" aria-controls=\"version-panel\">11 · Vorschau B9<small>Versionsverlauf ▾</small></button>\n"], ["          <p><b>Diese Vorschau · B8:</b> Depotbewertung und Verlauf getrennt laden. Zeiträume 1h, 1 Tag und 1 Woche; Datenlücken bleiben sichtbar. Kontrollierte Testvorschau · Geräteabnahme ausstehend. <a href=\"https://github.com/Achi1984/meridian/issues/764\">B8-Umfang #764</a>.</p>\n", "          <p><b>Diese Vorschau · B9:</b> Geladene Depotbewertung auch in Command. Verlauf mit Zeitachse und ausgewiesenem Messzeitraum. Kontrollierte Testvorschau · Geräteabnahme ausstehend. <a href=\"https://github.com/Achi1984/meridian/issues/766\">B9-Umfang #766</a>.</p>\n"], ["", "        <li><strong>Meridian 11 · B9</strong><span class=\"version-status\">Testvorschau</span><p>Command übernimmt die manuell geladene Depotbewertung und deren Sperre. Verlauf mit Zeitachse und vorhandenem Messzeitraum.</p></li>\n"], ["        <div><div class=\"eyebrow\">COMMAND CENTER</div><h1 id=\"command-heading\">Alles Wesentliche.<br>Ein Blick.</h1><p class=\"sub\">Deine zentrale Übersicht – derzeit als reine Designvorschau.</p></div>\n", "        <div><div class=\"eyebrow\">COMMAND CENTER</div><h1 id=\"command-heading\">Alles Wesentliche.<br>Ein Blick.</h1><p class=\"sub\">Deine zentrale Übersicht mit manuell geladener Depotbewertung.</p></div>\n"], ["        <h2>Datenanbindung steht noch aus</h2>\n        <p>Diese Übersicht verarbeitet keine Depot- oder Marktdaten. Bot-Snapshots können ausschließlich im Bots-Tab manuell gelesen werden. Es wird keine Aussage über Liquidationsgefahr oder Handelsschutz getroffen.</p>\n", "        <h2>Depot im Überblick · Risiko ungeklärt</h2>\n        <p>Die im Depot manuell geladene Bewertung erscheint auch hier. Bot-Snapshots werden separat im Bots-Tab geladen. Es wird keine Aussage über Liquidationsgefahr oder Handelsschutz getroffen.</p>\n"], ["      <section class=\"card\" aria-label=\"Portfolio\">\n", "      <section id=\"command-portfolio\" class=\"card\" aria-label=\"Portfolio\">\n"], ["          <div class=\"trust-cell\"><strong>DEPOT</strong><span>Unbekannt</span></div>\n", "          <div class=\"trust-cell\"><strong>DEPOT</strong><span data-command-depot-status>Unbekannt</span></div>\n"], ["          <p><b>Modus:</b> Öffentliche Entwicklungs-Vorschau mit optionalem manuellem Bot-Lesezugang.</p>\n", "          <p><b>Modus:</b> Öffentliche Entwicklungs-Vorschau mit optionalem manuellem Depot- und Bot-Lesezugang.</p>\n"], ["            <p>Nur Ansichtsmuster ohne Kontozugriff. Depotwert und Risikostatus bleiben unbekannt.</p>\n", "            <p>Nur Ansichtsmuster ohne Kontozugriff. Sie verändern weder die geladene Depotbewertung noch den Risikostatus.</p>\n"], ["<script type=\"module\" src=\"./depot-read-bootstrap.js?v=B8\"></script>\n", "<script type=\"module\" src=\"./depot-read-bootstrap.js?v=B9\"></script>\n"]];
const b8Deltas=[["    .depot-read-view dd{margin:0 0 12px;font-weight:650;overflow-wrap:anywhere}\n", "    .depot-read-view dd{margin:0 0 12px;font-weight:650;overflow-wrap:anywhere}\n    .depot-history{margin-top:24px;border-top:1px solid #334155;padding-top:16px}\n    .depot-history svg{display:block;width:100%;height:auto;color:#93c5fd;margin:16px 0}\n    .depot-range{display:flex;flex-wrap:wrap;gap:8px}\n    .depot-range button[aria-pressed=\"true\"]{background:#1e3a5f;border-color:#93c5fd}\n    .depot-history p{overflow-wrap:anywhere;font-size:14px}\n"], ["      <button id=\"version-toggle\" type=\"button\" class=\"preview-pill version-toggle\" aria-expanded=\"false\" aria-controls=\"version-panel\">11 · Vorschau B7<small>Versionsverlauf ▾</small></button>\n", "      <button id=\"version-toggle\" type=\"button\" class=\"preview-pill version-toggle\" aria-expanded=\"false\" aria-controls=\"version-panel\">11 · Vorschau B8<small>Versionsverlauf ▾</small></button>\n"], ["          <p><b>Diese Vorschau · B7:</b> Depotbewertung manuell lesen: Gesamtwert, Spot und Pionex mit Zeitnachweis. Gespeicherte Bewertung, keine Live-Kurse. Kontrollierte Testvorschau · Geräteabnahme ausstehend. <a href=\"https://github.com/Achi1984/meridian/issues/762\">B7-Umfang #762</a>.</p>\n", "          <p><b>Diese Vorschau · B8:</b> Depotbewertung und Verlauf getrennt laden. Zeiträume 1h, 1 Tag und 1 Woche; Datenlücken bleiben sichtbar. Kontrollierte Testvorschau · Geräteabnahme ausstehend. <a href=\"https://github.com/Achi1984/meridian/issues/764\">B8-Umfang #764</a>.</p>\n"], ["      <ul class=\"version-history-list\">\n", "      <ul class=\"version-history-list\">\n        <li><strong>Meridian 11 · B8</strong><span class=\"version-status\">Testvorschau</span><p>Depotbewertung unabhängig von der Historie. Verlauf für 1h, 1 Tag und 1 Woche mit sichtbaren Datenlücken; keine Renditeberechnung.</p></li>\n"], ["        <p class=\"caption\">Letzte vollständige gespeicherte Bewertung. Keine Live-Kurse oder aktuelle Bestandsübersicht.</p>\n", "        <p class=\"caption\">Depotbewertung aus serverseitigen Quellen. Der gespeicherte Verlauf wird getrennt geprüft.</p>\n"], ["<script type=\"module\" src=\"./depot-read-bootstrap.js?v=B7\"></script>\n", "<script type=\"module\" src=\"./depot-read-bootstrap.js?v=B8\"></script>\n"]];
const b7Deltas=[
  [
    "11 · Vorschau B6<small>",
    "11 · Vorschau B7<small>"
  ],
  [
    "          <p><b>Diese Vorschau · B6:</b> P/L-Werte farblich hervorgehoben: Verlust rot, Gewinn grün. Unbestätigte Werte bleiben neutral. Kontrollierte Testvorschau · Geräteabnahme ausstehend. Aufbauend auf <a href=\"https://github.com/Achi1984/meridian/pull/740\">Botanbindung #740</a>.</p>\n",
    "          <p><b>Diese Vorschau · B7:</b> Depotbewertung manuell lesen: Gesamtwert, Spot und Pionex mit Zeitnachweis. Gespeicherte Bewertung, keine Live-Kurse. Kontrollierte Testvorschau · Geräteabnahme ausstehend. <a href=\"https://github.com/Achi1984/meridian/issues/762\">B7-Umfang #762</a>.</p>\n"
  ],
  [
    "        <li><strong>Meridian 11 · B6</strong><span class=\"version-status\">Testvorschau</span><p>P/L-Farben: Verluste rot, Gewinne grün. Nicht bestätigte Werte bleiben neutral; Vorzeichen und Zahlen bleiben lesbar.</p></li>\n",
    "        <li><strong>Meridian 11 · B7</strong><span class=\"version-status\">Testvorschau</span><p>Manueller Depot-Lesezugang mit getrennter Sperre, Zeitprüfung und gespeicherter Gesamtbewertung. Kein automatisches Laden, keine Bestands- oder Renditebehauptung.</p></li>\n        <li><strong>Meridian 11 · B6</strong><span class=\"version-status\">Testvorschau</span><p>P/L-Farben: Verluste rot, Gewinne grün. Nicht bestätigte Werte bleiben neutral; Vorzeichen und Zahlen bleiben lesbar.</p></li>\n"
  ],
  [
    "data-preview-mode=\"manual-bot-read-only\"",
    "data-preview-mode=\"manual-bot-depot-read-only\""
  ],
  [
    "    .bot-read-view .bot-card .bot-pnl-positive{color:#6ee7b7}",
    "    .bot-read-view .bot-card .bot-pnl-positive{color:#6ee7b7}\n    .depot-read-view .depot-total{font-size:28px;font-weight:750;line-height:1.3}\n    .depot-read-view dl{display:grid;grid-template-columns:minmax(0,1fr);gap:6px}\n    .depot-read-view dd{margin:0 0 12px;font-weight:650;overflow-wrap:anywhere}"
  ],
  [
    "      <section class=\"card\" aria-labelledby=\"depot-summary-heading\">\n        <div class=\"card-head\"><h2 id=\"depot-summary-heading\">Depotübersicht</h2><span class=\"limited\">Statische Vorschau</span></div>\n        <div class=\"portfolio-row\"><div><p class=\"caption\">Gesamtwert</p><div class=\"portfolio-value\" aria-label=\"Gesamtwert unbekannt\">—</div><p class=\"portfolio-description\">Unbekannt</p></div></div>\n        <p class=\"caption\">Keine Depotdaten verbunden. Der Wert ist unbekannt – nicht null.</p>\n        <div class=\"trust-grid\" aria-label=\"Datenstatus des Depots\">\n          <div class=\"trust-cell\"><strong>Quelle</strong><span>Nicht verbunden</span></div>\n          <div class=\"trust-cell\"><strong>Aktualität</strong><span>Keine bestätigten Daten</span></div>\n          <div class=\"trust-cell\"><strong>Verlauf</strong><span>Nicht verfügbar</span></div>\n        </div>\n      </section>\n      <section class=\"card card-muted\" aria-labelledby=\"depot-holdings-heading\">\n        <h2 id=\"depot-holdings-heading\">Deine Bestände</h2>\n        <p class=\"caption\">Ohne bestätigte Daten lassen sich Bestände und Verteilung nicht anzeigen.</p>\n      </section>\n      <p class=\"caption\">Diese Depotansicht ist nicht angebunden. „Terminal öffnen“ führt zum separaten Terminal.</p>\n",
    "      <section class=\"card\" aria-labelledby=\"depot-summary-heading\">\n        <div class=\"card-head\"><h2 id=\"depot-summary-heading\">Depotbewertung</h2><span class=\"limited\">Nur lesend</span></div>\n        <p class=\"caption\">Letzte vollständige gespeicherte Bewertung. Keine Live-Kurse oder aktuelle Bestandsübersicht.</p>\n        <div class=\"bot-access-controls\">\n          <label for=\"depot-read-token\">Meridian-Lesepasswort für das Depot</label>\n          <input id=\"depot-read-token\" type=\"password\" autocomplete=\"off\" autocapitalize=\"none\" spellcheck=\"false\" maxlength=\"4096\" aria-describedby=\"depot-read-access-help\">\n          <p id=\"depot-read-access-help\">Asset-Watch-Links gelten nur für Bots. Passwort nur vorübergehend im Arbeitsspeicher; Sperren, Ausblenden oder Verlassen der Seite löscht den Zugang.</p>\n          <button id=\"depot-read-provide\" type=\"button\">Depot-Lesezugang übernehmen</button>\n          <p id=\"depot-read-access-status\" role=\"status\" aria-live=\"polite\"></p>\n        </div>\n        <div id=\"depot-read-root\"></div>\n      </section>\n      <section class=\"card card-muted\" aria-labelledby=\"depot-holdings-heading\">\n        <h2 id=\"depot-holdings-heading\">Deine Bestände</h2>\n        <p class=\"caption\">Diese Datenquelle enthält keine einzelnen Positionen. Bestände und Verteilung bleiben nicht verfügbar.</p>\n      </section>\n"
  ],
  [
    "<script type=\"module\" src=\"./bot-read-bootstrap.js?v=B6\"></script>",
    "<script type=\"module\" src=\"./bot-read-bootstrap.js?v=B6\"></script>\n<script type=\"module\" src=\"./depot-read-bootstrap.js?v=B7\"></script>"
  ]
];
const b12Deltas=[
  [
    '    .terminal-entry-link{display:inline-flex;align-items:center;justify-content:center;min-height:44px;min-width:44px;max-width:100%;padding:10px 14px;border:1px solid #44607b;border-radius:10px;background:#142235;color:#d7e6f6;font-size:13px;line-height:1.5;font-weight:650;text-underline-offset:3px;overflow-wrap:anywhere}\n    .terminal-entry-link:focus-visible{outline:3px solid #9bc9ff;outline-offset:3px}\n',
    '    .terminal-entry-link,.strategy-entry-link{display:inline-flex;align-items:center;justify-content:center;min-height:44px;min-width:44px;max-width:100%;padding:10px 14px;border:1px solid #44607b;border-radius:10px;background:#142235;color:#d7e6f6;font-size:13px;line-height:1.5;font-weight:650;text-underline-offset:3px;overflow-wrap:anywhere}\n    .terminal-entry-link:focus-visible,.strategy-entry-link:focus-visible{outline:3px solid #9bc9ff;outline-offset:3px}\n'
  ],
  [
    '',
    '    .command-open-strategies{display:inline-flex;align-items:center;justify-content:center;min-height:44px;max-width:100%;margin-top:12px;padding:10px 14px;border:1px solid #44607b;border-radius:10px;background:#142235;color:#d7e6f6;font-size:13px;line-height:1.5;font-weight:650;text-underline-offset:3px;overflow-wrap:anywhere}\n    .command-open-strategies:focus-visible{outline:3px solid #9bc9ff;outline-offset:3px}\n'
  ],
  [
    '    #view-research .view-placeholder{border-top:3px solid #d49aff}\n',
    '    #view-strategies .view-placeholder{border-top:3px solid #d49aff}\n'
  ],
  [
    '    #nav button[data-v="research"].active{color:#d49aff}\n',
    '    #nav button[data-v="strategies"].active{color:#d49aff}\n'
  ],
  [
    '',
    '    .arena-historical-metadata[aria-label^="Separates historisches Arena-Ergebnis"]{min-width:0;overflow-wrap:anywhere}\n    .arena-historical-metadata[aria-label^="Separates historisches Arena-Ergebnis"] section,.arena-historical-metadata[aria-label^="Separates historisches Arena-Ergebnis"] dl,.arena-historical-metadata[aria-label^="Separates historisches Arena-Ergebnis"] dt,.arena-historical-metadata[aria-label^="Separates historisches Arena-Ergebnis"] dd,.arena-historical-metadata[aria-label^="Separates historisches Arena-Ergebnis"] p,.arena-historical-metadata[aria-label^="Separates historisches Arena-Ergebnis"] h4,.arena-historical-metadata[aria-label^="Separates historisches Arena-Ergebnis"] h5,.arena-historical-metadata[aria-label^="Separates historisches Arena-Ergebnis"] ul,.arena-historical-metadata[aria-label^="Separates historisches Arena-Ergebnis"] li,.arena-historical-metadata[aria-label^="Separates historisches Arena-Ergebnis"] summary,.arena-historical-metadata[aria-label^="Separates historisches Arena-Ergebnis"] pre{min-width:0;overflow-wrap:anywhere}\n'
  ],
  [
    '    @media(max-width:350px){.card{padding:14px}.container{padding-top:12px}.autonomy-strip>summary{padding-left:9px;padding-right:9px}}\n    .strategy-load-status{min-height:44px;padding:12px 0;color:var(--state-unknown);overflow-wrap:anywhere}\n    .strategy-source-notice{border-top:3px solid var(--research)}\n    .strategy-card-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}\n    .strategy-id{font-size:12px;font-weight:800;letter-spacing:.08em;color:#d8c8ff}\n    .strategy-family h2,.strategy-candidate h2{margin-bottom:8px}\n    .strategy-family>p,.strategy-candidate>p{font-size:13px;line-height:1.65;overflow-wrap:anywhere}\n    .strategy-summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:13px 0}\n    .strategy-summary>div{min-width:0;padding:9px;border:1px solid #344356;border-radius:10px;background:#101824}\n    .strategy-summary dt{font-size:10px;color:var(--muted)}\n    .strategy-summary dd{margin:3px 0 0;font-size:12px;font-weight:650;overflow-wrap:anywhere}\n    .strategy-progression{list-style:none;padding:0;margin:12px 0;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:5px}\n    .strategy-progression li{min-width:0;padding:8px 6px;border:1px solid #344356;border-radius:9px;background:#101824}\n    .strategy-progression strong,.strategy-progression span{display:block;font-size:10px;line-height:1.4;overflow-wrap:anywhere}\n    .strategy-progression span{margin-top:4px;color:var(--state-unknown)}\n    .strategy-family details{margin:10px 0 0}\n    .strategy-family details summary,.arena-evidence summary,.arena-evidence-details summary{min-height:48px;letter-spacing:0;text-transform:none}\n    .strategy-candidate{border-color:#776346;background:linear-gradient(160deg,#28251d,#111923 70%)}\n    .strategy-arena{margin-top:20px;padding-top:10px;border-top:1px solid var(--line)}\n    .strategy-arena>p{font-size:13px;line-height:1.65;overflow-wrap:anywhere}\n    .arena-toolbar{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:14px 0}\n    .arena-toolbar button,.arena-import{min-width:0;min-height:48px;padding:10px;border:1px solid #567a9f;border-radius:10px;background:#142235;color:var(--text);font-size:12px;line-height:1.4;font-weight:650;overflow-wrap:anywhere}\n    .arena-toolbar button{cursor:pointer}\n    .arena-import{display:flex;align-items:center;justify-content:center;text-align:center;cursor:pointer}\n    .arena-import input{width:100%;min-width:0;min-height:44px;font-size:11px}\n    .arena-toolbar button:focus-visible,.arena-import:focus-within{outline:3px solid #9bc9ff;outline-offset:2px}\n    .arena-toolbar button:disabled{opacity:.55;cursor:not-allowed}\n    .arena-evidence{color:var(--state-unknown);font-size:12px;font-weight:750;overflow-wrap:anywhere}\n    .arena-models{display:grid;gap:10px;margin:12px 0}\n    .arena-model-card{min-width:0;padding:14px;border:1px solid #344356;border-radius:14px;background:#101824;overflow-wrap:anywhere}\n    .arena-model-card header{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}\n    .arena-model-card header>div{min-width:0}\n    .arena-model-card header strong,.arena-model-card header span{display:block}\n    .arena-model-card header span{margin-top:4px;font-size:10px;color:var(--state-unknown)}\n    .arena-model-card header>b{font-size:13px;white-space:nowrap}\n    .arena-model-card p{font-size:11px;line-height:1.6;margin-top:8px;overflow-wrap:anywhere}\n    .arena-model-card dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin:12px 0}\n    .arena-model-card dl>div{min-width:0;padding:7px;border-radius:8px;background:#172336}\n    .arena-model-card dt{font-size:9px;color:var(--muted)}\n    .arena-model-card dd{margin:3px 0 0;font-size:11px;font-weight:700;overflow-wrap:anywhere}\n    .arena-blocked,.arena-unknown{padding:10px;border:1px solid #776346;border-radius:9px;color:var(--state-unknown)}\n    .arena-evidence{margin:10px 0}\n    .arena-evidence summary{font-size:10px}\n    .arena-evidence-details{margin-top:8px}\n    .arena-evidence-details ul{padding-left:18px;overflow-wrap:anywhere}\n    .arena-control{padding:10px;border:1px solid var(--line);border-radius:9px;font-size:11px;overflow-wrap:anywhere}\n    .tone-safe{color:#6ee7b7}.tone-danger{color:#ff9b9b}.tone-muted{color:var(--muted)}\n    @media(max-width:560px){.strategy-summary{grid-template-columns:1fr}.strategy-progression{grid-template-columns:1fr 1fr}.arena-toolbar{grid-template-columns:1fr}.arena-model-card{padding:11px}}\n    @media(max-width:350px){#nav button[data-v="strategies"] span:last-child{font-size:9px;letter-spacing:-.03em}}\n    @media(forced-colors:active){.strategy-family,.strategy-candidate,.arena-model-card,.strategy-progression li{border-color:CanvasText}}\n',
    '    @media(max-width:350px){.card{padding:14px}.container{padding-top:12px}.autonomy-strip>summary{padding-left:9px;padding-right:9px}}\n'
  ],
  [
    '      <button id="version-toggle" type="button" class="preview-pill version-toggle" aria-expanded="false" aria-controls="version-panel">11 · Vorschau B11<small>Versionsverlauf ▾</small></button>\n',
    '      <button id="version-toggle" type="button" class="preview-pill version-toggle" aria-expanded="false" aria-controls="version-panel">11 · Vorschau B12<small>Versionsverlauf ▾</small></button>\n'
  ],
  [
    '        <p><b>Diese Vorschau · B11:</b> Manuell geladene Bot-Snapshots filtern, ordnen und mit Command teilen. Nur bestätigte Quellwerte; Sprung zur passenden Karte. Draft, Geräteabnahme ausstehend.</p>\n',
    '        <p><b>Diese Vorschau · B12:</b> Native Strategien-Ansicht mit zwölf Hypothesen, fünf Arena-Modellen und einem getrennten Entwicklungs-Kandidaten. Nur lokale Forschungsquellen und manuelle Diagnose; keine laufenden Paper- oder Live-Aktivitäten.</p>\n        <p><b>Vorige Vorschau · B11:</b> Manuell geladene Bot-Snapshots filtern, ordnen und mit Command teilen. Nur bestätigte Quellwerte; Sprung zur passenden Karte. Draft, Geräteabnahme ausstehend.</p>\n'
  ],
  [
    '        <li><strong>Meridian 11 · B11</strong><span class="version-status">Entwurf</span><p>Bot-Cockpit mit Suche, Richtung/Kontraktart-Filtern und deterministischer Sortierung. Command zeigt denselben validierten Snapshot und verlinkt bestätigte Quellverluste zur Karte. Reine Testvorschau; keine Risikorangfolge, neue Datenanbindung oder Funktionsfreigabe.</p></li>\n',
    '        <li><strong>Meridian 11 · B12</strong><span class="version-status">Entwurf</span><p>Strategien-Arbeitsbereich mit dem Quellregister, einer manuell bedienbaren M11-Arena und einem getrennten B1-7-Entwicklungskandidaten. Keine automatische Marktdatenbeschaffung, kein Paperbetrieb und keine Live-Freigabe.</p></li>\n        <li><strong>Meridian 11 · B11</strong><span class="version-status">Testvorschau</span><p>Bot-Cockpit mit Suche, Richtung/Kontraktart-Filtern und deterministischer Sortierung. Command zeigt denselben validierten Snapshot und verlinkt bestätigte Quellverluste zur Karte. Reine Testvorschau; keine Risikorangfolge, neue Datenanbindung oder Funktionsfreigabe.</p></li>\n'
  ],
  [
    '    <nav class="terminal-entry" aria-label="Terminal-Zugang">\n      <a class="terminal-entry-link" href="../v10/">Terminal öffnen</a>\n    </nav>\n',
    '    <nav class="terminal-entry" aria-label="M11-Strategien">\n      <a class="strategy-entry-link" href="#view-strategies" data-open-strategies>Strategien öffnen</a>\n    </nav>\n'
  ],
  [
    '      </section>\n      <details class="command-context-details">\n',
    '      </section>\n      <section class="card command-strategies" aria-labelledby="command-strategies-heading">\n        <div class="card-head"><h2 id="command-strategies-heading">Strategieforschung</h2><span class="limited">Keine Handelsaktivität</span></div>\n        <p>12 Hypothesen im Entwurfsregister, vier Arena-Modelle mit historischen Diagnosen sowie H9 mit BLOCKED_DATA und B1-7 als getrennter Entwicklungskandidat ohne Ergebnisse. Kein laufendes Paper.</p>\n        <a class="command-open-strategies" href="#view-strategies" data-open-strategies>Strategien in M11 öffnen</a>\n      </section>\n      <details class="command-context-details">\n'
  ],
  [
    '      <p class="caption">Nur manuelle Leseabfragen. Diese Ansicht steuert keine Bots. „Terminal öffnen“ führt zum separaten Terminal.</p>\n',
    '      <p class="caption">Nur manuelle Leseabfragen. Diese Ansicht steuert keine Bots. Strategieforschung ist von deinen Pionex-Snapshots getrennt.</p>\n'
  ],
  [
    '    <section id="view-research" class="view" aria-labelledby="scanner-heading" hidden>\n      <div class="eyebrow">RESEARCH &amp; CHANCEN</div><h1 id="scanner-heading">Scanner</h1>\n      <div class="card view-placeholder"><span class="limited module-availability">In Vorbereitung</span><h2>Research-Chancen erst nach Evidenz</h2><p>Der Scanner soll nachvollziehbare Research-Kandidaten zeigen. Aktuell sind keine Research-Ausgaben oder freigegebenen Signale verfügbar; es entstehen keine Handelsaufträge oder Paper-Bots.</p></div>\n    </section>\n',
    '    <section id="view-strategies" class="view" aria-labelledby="strategies-heading" hidden>\n      <div class="eyebrow">HYPOTHESEN · EVIDENZ · BLOCKER</div><h1 id="strategies-heading">Strategien</h1>\n      <p class="sub">Strategieforschung in M11 ist getrennt von den Exchange-Bots im Bots-Tab. Keine automatische Promotion, Paper-Ausführung oder Handelsfreigabe.</p>\n      <p id="strategy-load-status" class="strategy-load-status" role="status" aria-live="polite">Das lokale Register wird erst beim Öffnen dieser Ansicht gelesen.</p>\n      <div id="strategy-catalog" aria-busy="false"></div>\n      <div id="strategy-arena-root"></div>\n    </section>\n'
  ],
  [
    '    <button type="button" data-v="research" aria-controls="view-research"><span class="nav-icon" aria-hidden="true">◇</span><span>SCANNER</span></button>\n',
    '    <button type="button" data-v="strategies" aria-controls="view-strategies"><span class="nav-icon" aria-hidden="true">◇</span><span>STRATEGIEN</span></button>\n'
  ],
  [
    '<script type="module" src="./bot-read-bootstrap.js?v=B11"></script>\n<script type="module" src="./depot-read-bootstrap.js?v=B9"></script>\n',
    '<script type="module" src="./bot-read-bootstrap.js?v=B12"></script>\n<script type="module" src="./depot-read-bootstrap.js?v=B12"></script>\n<script type="module" src="./strategy-workspace-bootstrap.js?v=B12"></script>\n'
  ],
  [
    '',
    '  <style id="m11-compact-nav">\n    @media(max-width:430px){#nav{grid-template-columns:repeat(4,minmax(44px,1fr)) minmax(44px,1.3fr)}}\n    @media(max-width:350px){#nav{grid-template-columns:minmax(44px,1.2fr) minmax(44px,.8fr) minmax(44px,.75fr) minmax(44px,1.15fr) minmax(44px,1.35fr)}}\n  </style>\n'
  ]
];
const mobileNavDelta=[
  '    @media(max-width:350px){#nav button[data-v="strategies"] span:last-child{font-size:9px;letter-spacing:-.03em}}\n',
  '    @media(max-width:350px){#nav button[data-v="strategies"] span:last-child{letter-spacing:-.03em}}\n'
];
const b13Deltas=[
 [
   '      <button id="version-toggle" type="button" class="preview-pill version-toggle" aria-expanded="false" aria-controls="version-panel">11 · Vorschau B12<small>Versionsverlauf ▾</small></button>\n',
   '      <button id="version-toggle" type="button" class="preview-pill version-toggle" aria-expanded="false" aria-controls="version-panel">11 · Vorschau B13<small>Versionsverlauf ▾</small></button>\n'
 ],
 [
   '        <p><b>Diese Vorschau · B12:</b> Native Strategien-Ansicht mit zwölf Hypothesen, fünf Arena-Modellen und einem getrennten Entwicklungs-Kandidaten. Nur lokale Forschungsquellen und manuelle Diagnose; keine laufenden Paper- oder Live-Aktivitäten.</p>\n',
   '        <p><b>Diese Vorschau · B13:</b> Einheitliche Cache-Identitäten für das lokale M11-Modulnetz nach Auslieferung der Research-Oberfläche. Keine neuen Research-Ergebnisse oder Paper-/Live-Aktivitäten.</p>\n'
 ],
 [
   '        <li><strong>Meridian 11 · B12</strong><span class="version-status">Entwurf</span><p>Strategien-Arbeitsbereich mit dem Quellregister, einer manuell bedienbaren M11-Arena und einem getrennten B1-7-Entwicklungskandidaten. Keine automatische Marktdatenbeschaffung, kein Paperbetrieb und keine Live-Freigabe.</p></li>\n',
   '        <li><strong>Meridian 11 · B13</strong><span class="version-status">Entwurf</span><p>Einheitliche Cache-Identitäten für das lokale M11-Modulnetz nach Auslieferung der Research-Oberfläche. <a href="https://github.com/Achi1984/meridian/issues/953">Umfang #953</a> · <a href="https://github.com/Achi1984/meridian/pull/956">Research-Oberfläche #956</a>. Keine neuen Research-Ergebnisse oder Paper-/Live-Aktivitäten.</p></li>\n        <li><strong>Meridian 11 · B12</strong><span class="version-status">Entwurf</span><p>Strategien-Arbeitsbereich mit dem Quellregister, einer manuell bedienbaren M11-Arena und einem getrennten B1-7-Entwicklungskandidaten. Keine automatische Marktdatenbeschaffung, kein Paperbetrieb und keine Live-Freigabe.</p></li>\n'
 ],
 [
   '<script type="module" src="./bot-read-bootstrap.js?v=B12"></script>\n<script type="module" src="./depot-read-bootstrap.js?v=B12"></script>\n<script type="module" src="./strategy-workspace-bootstrap.js?v=B12"></script>\n',
   '<script type="module" src="./bot-read-bootstrap.js?v=B13"></script>\n<script type="module" src="./depot-read-bootstrap.js?v=B13"></script>\n<script type="module" src="./strategy-workspace-bootstrap.js?v=B13"></script>\n'
 ]
];
const appAccessDeltas=[
  ['',`    #app[hidden],#app-access-gate[hidden]{display:none!important}
    .app-access-gate{min-height:100vh;min-height:100dvh;display:grid;place-items:center;padding:24px max(16px,env(safe-area-inset-left,0px))}
    .app-access-card{width:min(100%,440px);padding:24px;border:1px solid #39516b;border-radius:18px;background:linear-gradient(160deg,#172337,#111b29);box-shadow:0 12px 30px #00000025}
    .app-access-card h1{font-size:clamp(25px,7vw,34px);margin:0 0 8px}
    .app-access-card p{font-size:13px;line-height:1.6;margin:8px 0}
    .app-access-card label{display:block;margin:18px 0 6px;font-size:13px;font-weight:650}
    .app-access-card input,.app-access-card button,.app-access-lock{min-width:44px;min-height:44px}
    .app-access-card input{width:100%;padding:10px;border:1px solid #567a9f;border-radius:8px;background:#101b28;color:var(--text);font-size:16px}
    .app-access-card button,.app-access-lock{padding:10px 14px;border:1px solid #567a9f;border-radius:8px;background:#142235;color:var(--text);cursor:pointer}
    .app-access-card button{width:100%;margin-top:12px;font-weight:700}
    .app-access-card :focus-visible,.app-access-lock:focus-visible{outline:3px solid #9bc9ff;outline-offset:3px}
    .header-actions{display:flex;align-items:center;gap:8px;flex:none}
    @media(max-width:350px){.header-inner{flex-wrap:wrap}.header-actions{margin-left:auto}.app-access-card{padding:18px}}
`],
  [`<body>
<a class="skip-link" href="#app-main">Zum Inhalt</a>
<div id="app" class="app-shell v11-shell" data-ui-generation="11" data-preview-mode="manual-bot-depot-read-only" data-execution-impact="false">
  <header class="topbar">`,`<body>
<section id="app-access-gate" class="app-access-gate" aria-labelledby="app-access-heading">
  <div class="app-access-card">
    <div class="eyebrow">MERIDIAN · LESEZUGANG</div>
    <h1 id="app-access-heading">Meridian öffnen</h1>
    <p>Gib dein Meridian-Passwort ein. Der Zugang wird vorübergehend im Arbeitsspeicher gehalten und nach 15 Minuten gesperrt.</p>
    <form id="app-access-form">
      <label for="app-access-password">Meridian-Passwort</label>
      <input id="app-access-password" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="4096" required aria-describedby="app-access-help">
      <p id="app-access-help">Asset-Watch-Freigabelinks gelten nur für Bots und können die App nicht öffnen.</p>
      <button type="submit">Öffnen</button>
      <p id="app-access-status" role="status" aria-live="polite" aria-atomic="true">Gesperrt. Das Meridian-Passwort wird nicht gespeichert.</p>
    </form>
  </div>
</section>
<div id="app" class="app-shell v11-shell" data-ui-generation="11" data-preview-mode="manual-bot-depot-read-only" data-execution-impact="false" hidden>
  <a class="skip-link" href="#app-main">Zum Inhalt</a>
  <header class="topbar">`],
  [`      <button id="version-toggle" type="button" class="preview-pill version-toggle" aria-expanded="false" aria-controls="version-panel">11 · Vorschau B14<small>Versionsverlauf ▾</small></button>`,
   `      <div class="header-actions">
        <button id="version-toggle" type="button" class="preview-pill version-toggle" aria-expanded="false" aria-controls="version-panel">11 · Vorschau B14<small>Versionsverlauf ▾</small></button>
        <button id="app-access-lock" class="app-access-lock" type="button" aria-label="App sperren">Sperren</button>
      </div>`],
  [`        <div class="bot-access-controls">
          <label for="depot-read-token">Meridian-Lesepasswort für das Depot</label>
          <input id="depot-read-token" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="4096" aria-describedby="depot-read-access-help">
          <p id="depot-read-access-help">Asset-Watch-Links gelten nur für Bots. Passwort nur vorübergehend im Arbeitsspeicher; Sperren, Ausblenden oder Verlassen der Seite löscht den Zugang.</p>
          <button id="depot-read-provide" type="button">Depot-Lesezugang übernehmen</button>
          <p id="depot-read-access-status" role="status" aria-live="polite"></p>
        </div>
        <div id="depot-read-root"></div>`,
   `        <div id="depot-read-root"></div>`],
  [`        <div class="bot-access-controls">
          <label for="bot-read-token">Asset-Watch-Link oder Meridian-Lesepasswort</label>
          <input id="bot-read-token" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="4096" aria-describedby="bot-read-access-help">
          <p id="bot-read-access-help">Bestehenden Asset-Watch-Freigabelink aus Meridian 10 oder Meridian-Lesepasswort einfügen. Kein Börsen-API-Schlüssel. Der Zugang bleibt nur bis zum Sperren, Verlassen oder Ausblenden dieser Seite im Arbeitsspeicher.</p>
          <button id="bot-read-provide" type="button">Lesezugang übernehmen</button>
          <p id="bot-read-access-status" role="status" aria-live="polite"></p>
        </div>
        <div id="bot-read-root"></div>`,
   `        <div id="bot-read-root"></div>`],
  [`<script type="module" src="./bot-read-bootstrap.js?v=B14"></script>
<script type="module" src="./depot-read-bootstrap.js?v=B14"></script>
<script type="module" src="./strategy-workspace-bootstrap.js?v=B14"></script>`,
   `<script type="module" src="./app-access-bootstrap.js?v=B14-M11"></script>
<script type="module" src="./bot-read-bootstrap.js?v=B14-M11"></script>
<script type="module" src="./depot-read-bootstrap.js?v=B14-M11"></script>
<script type="module" src="./strategy-workspace-bootstrap.js?v=B14-M11"></script>`],
  ['', '    @media(max-width:350px){.header-inner{flex-wrap:nowrap}.identity{gap:6px}.mark{width:32px;height:32px}.brand{font-size:12px}.brand small{display:none}.header-actions{gap:4px}.version-toggle{padding:4px;font-size:10px;letter-spacing:0}.version-toggle small{display:none}}\n']
];
const b14Deltas=[
 [
   '11 · Vorschau B13<small>Versionsverlauf ▾</small>',
   '11 · Vorschau B14<small>Versionsverlauf ▾</small>'
 ],
 [
   '        <p><b>Diese Vorschau · B13:</b> Einheitliche Cache-Identitäten für das lokale M11-Modulnetz nach Auslieferung der Research-Oberfläche. Keine neuen Research-Ergebnisse oder Paper-/Live-Aktivitäten.</p>\n',
   '        <p><b>Diese Vorschau · B14:</b> Research Results Explorer für 44 Producerpfade mit Filtern, Zweipfadvergleich und gelieferten Quartalsrenditen. UNVERIFIED · Herkunft nicht bestätigt. Keine neuen Research-Ergebnisse oder Paper-/Live-Aktivitäten.</p>\n'
 ],
 [
   '',
   '        <li><strong>Meridian 11 · B14</strong><span class="version-status">Entwurf</span><p>Research Results Explorer für 44 Producerpfade mit Filtern, Zweipfadvergleich, Pfaddetails und gelieferten Quartalsrenditen. <a href="https://github.com/Achi1984/meridian/issues/961">Umfang #961</a>. UNVERIFIED · Herkunft nicht bestätigt. Keine neuen Research-Ergebnisse oder Paper-/Live-Aktivitäten.</p></li>\n'
 ],
 [
   '<script type="module" src="./bot-read-bootstrap.js?v=B13"></script>\n<script type="module" src="./depot-read-bootstrap.js?v=B13"></script>\n<script type="module" src="./strategy-workspace-bootstrap.js?v=B13"></script>\n',
   '<script type="module" src="./bot-read-bootstrap.js?v=B14"></script>\n<script type="module" src="./depot-read-bootstrap.js?v=B14"></script>\n<script type="module" src="./strategy-workspace-bootstrap.js?v=B14"></script>\n'
 ]
];
function restoreB2(source){
 for(const [before,after] of botPresentationDeltas){
   assert.equal(source.split(after).length-1,1,'one exact compact Bots CSS delta');
   source=source.replace(after,before);
 }
 for(const [before,after] of appAccessDeltas){
   assert.equal(source.split(after).length-1,1,'one exact shared app-access source delta');
   source=source.replace(after,before);
 }
 assert.equal(source.split(compactBotsMarkupWithAccess).length-1,1,'one exact compact Bots markup delta');
 source=source.replace(compactBotsMarkupWithAccess,botPresentationMarkupBeforeWithAccess);
 assert.equal(gitBlob(source),'c41b13457aa33d6b3d50c5d2b401bdf647522bd3','M11 access deltas restore the exact B14 source');
 for(const [before,after] of b14Deltas){
   assert.equal(source.split(after).length-1,1,'one exact B14 source delta');
   source=source.replace(after,before);
 }
 for(const [before,after] of b13Deltas){
   assert.equal(source.split(after).length-1,1,'one exact B13 source delta');
   source=source.replace(after,before);
 }
 assert.equal(source.split(mobileNavDelta[1]).length-1,1,'one exact compact-nav B12 delta');
 source=source.replace(mobileNavDelta[1],mobileNavDelta[0]);
 for(const [index,delta] of b12Deltas.entries()){
   const [before,after]=index===5?[delta[1],delta[0]]:delta;
   assert.equal(source.split(after).length-1,1,`one exact B12 delta ${index}`);
   source=source.replace(after,before);
 }
 assert.equal(gitBlob(source),'908efe5629835c57b908e8bfb245728b4b757c19','B12 deltas restore the exact B11 shell');
 for(const [before,after] of b11Deltas){assert.equal(source.split(after).length-1,1,"one exact B11 delta");source=source.replace(after,before);}
 for(const [before,after] of b10Deltas){assert.equal(source.split(after).length-1,1,"one exact B10 delta");source=source.replace(after,before);}
 for(const [before,after] of b9Deltas){assert.equal(source.split(after).length-1,1,"one exact B9 delta");source=source.replace(after,before);}
 for(const [before,after] of b8Deltas){assert.equal(source.split(after).length-1,1,"one exact B8 delta");source=source.replace(after,before);}
 for(const [before,after] of b7Deltas){assert.equal(source.split(after).length-1,1,"one exact B7 delta");source=source.replace(after,before);}
 for(const [before,after] of r130Deltas){assert.equal(source.split(after).length-1,1,'one exact r130 version disclosure delta');source=source.replace(after,before);}
 for(const [before,after] of r129Deltas){assert.equal(source.split(after).length-1,1,'one exact r129 version disclosure delta');source=source.replace(after,before);}
 for(const [before,after] of r128Deltas){assert.equal(source.split(after).length-1,1,'one exact r128 delta');source=source.replace(after,before);}
 assert.equal(gitBlob(source),'41611512b49cf8fba39545de147d6a458293c62c','exact reviewed B6 bytes restored');
 for(const [before,after] of b6Deltas){assert.equal(source.split(after).length-1,1,'one exact B6 delta');source=source.replace(after,before);}
 assert.equal(gitBlob(source),'0d6e678613100cfe68d67665964b7b3d079193a3','exact reviewed B5 bytes restored');
 for(const [before,after] of b5Deltas){assert.equal(source.split(after).length-1,1,'one exact B5 delta');source=source.replace(after,before);}
 assert.equal(gitBlob(source),'af699030738545b6f22886155abd3b8dddd4756d','exact reviewed B4 bytes restored');
 for(const [before,after] of b4Deltas){assert.equal(source.split(after).length-1,1,'one exact B4 delta');source=source.replace(after,before);}
 assert.equal(gitBlob(source),'94e8407bf9068eeff6bc8af75c6972749d804b26','exact reviewed B3 bytes restored');
 for(const [before,after] of b3Deltas){assert.equal(source.split(after).length-1,1,'one exact B3 delta');source=source.replace(after,before);}
 assert.equal(gitBlob(source),'9000de331c75c9a72e9578512da9673a130076d2','exact main78c694 B2 bytes restored');
 return source;
}

test('Terminal öffnen preserves the reviewed history-close baseline and stays outside version history',()=>{
  const html=restoreB2(globalHtml);
  assert.equal(globalHtml.split(compactBotsMarkup).length-1,1,'one compact Bots section');
  assert.equal(globalHtml.split(botPresentationCssAfter).length-1,1,'one exact compact-card CSS block');
  assert.equal(css.trimEnd(),html.match(/    \/\* Fixed packet A:[\s\S]*?    \.terminal-entry-link:focus-visible\{[^\n]*\}\n/)?.[0]?.trimEnd());
  assert.equal(html.split(entry).length-1,1);
  const anchor=[...html.matchAll(/<a\b[^>]*class="terminal-entry-link"[^>]*>[\s\S]*?<\/a>/g)];
  assert.equal(anchor.length,1);
  assert.equal(anchor[0][0],'<a class="terminal-entry-link" href="../v10/">Terminal öffnen</a>');
  assert.ok(anchor[0].index<html.indexOf('<section id="version-panel"'));
  assert.match(html,/id="version-panel"[^>]* hidden/);
  const viewportPair='min-height:100vh;min-height:100dvh;';
  assert.equal(html.split(viewportPair).length-1,1,'exactly one progressive viewport fallback');
  assert.equal(html.split(depotAfter).length-1,1,'exactly one reviewed Depot panel');
  assert.equal(html.split(botsAfter).length-1,1,'exactly one Bots overview');
  for (const delta of [autonomyCss,autonomyStrip,autonomyRevisionRow,autonomyRevisionLabel]) assert.equal(html.split(delta).length-1,1,'exactly one literal B2 delta');
  assert.ok(html.endsWith('</html>\n\n\n\n'),'exact B2 transport trailing newline');
  const beforeB2=html.slice(0,-1).replace(autonomyCss,'').replace(autonomyStrip,'').replace(autonomyRevisionRow,'').replace(autonomyRevisionLabel,botsRevisionLabel);
  assert.equal(beforeB2.split(botsRevisionLabel).length-1,1,'one restored Bots preview revision');
  assert.equal(html.split(botsRevisionRow).length-1,1,'one Bots preview history row');
  const reviewedHtml=beforeB2.replace(botsAfter,botsBefore).replace(botsRevisionLabel,revisionAfter).replace(botsRevisionRow,'');
  assert.equal(reviewedHtml.split(revisionAfter).length-1,1,'one current preview revision label');
  assert.equal(html.split(revisionRow).length-1,1,'one matching preview history row');
  const restored=reviewedHtml.replace(css,'').replace(entry,'').replace(depotAfter,depotBefore)
    .replace(revisionAfter,revisionBefore).replace(revisionRow,'')
    .replace(viewportPair,'min-height:100dvh;min-height:100vh;');
  assert.equal(gitBlob(restored),preimageBlob,'all source bytes except terminal-entry insertions, the checked viewport pair and exact Depot/revision deltas must match the reviewed history-close baseline');
});

const moduleNames=['app-access-bootstrap.js','app-access.js','bot-read-bootstrap.js','bot-read-client.js','bot-read-view.js','bot-read-model.js','bot-overview-model.js','depot-read-bootstrap.js','depot-read-client.js','depot-read-model.js','depot-read-view.js','depot-history-model.js','depot-history-view.js','depot-current-model.js','strategy-workspace-bootstrap.js','strategy-catalog.js','research-evidence.js','strategy-arena.js','arena-inspection-report.js','arena-historical-result.js','arena-historical-export.js','arena-result-view.js'];
function deploymentServer(){
  const inlineScript=html.match(/<script>([\s\S]*?)<\/script>/i)?.[1];
  assert.ok(inlineScript,'actual UI-only navigation script');
  const scriptHash=createHash('sha256').update(inlineScript).digest('base64');
  const policies=new Map(),requests=[],modules=new Map(),pending=new Set();
  let reads=0,aborts=0,depotReads=0,depotAborts=0,authReads=0,mode='fresh';
  const endpoint='/meridian/__test/bot-snapshot',depotEndpoint='/meridian/__test/depot-snapshot',currentEndpoint='/meridian/__test/depot-current',priceEndpoint='/meridian/__test/depot-prices',authEndpoint='/meridian/__test/app-access';
  for(const name of moduleNames){
    let body=readFileSync(new URL('../v11/'+name,import.meta.url),'utf8');
    if(name==='bot-read-client.js'){
      const production='https://p01--achi-meridian--ttvk44grdlp7.code.run/api/private/asset-watch';
      assert.equal(body.split(production).length,2,'exact fixed endpoint replaced only in served test copy');
      body=body.replace(production,endpoint);
    }
    if(name==='depot-read-client.js'){
      const production='https://p01--achi-meridian--ttvk44grdlp7.code.run/api/private/portfolio-history?range=1w';
      assert.equal(body.split(production).length,2,'exact Depot endpoint replaced only in served test copy');
      body=body.replace(production,depotEndpoint).replace('https://p01--achi-meridian--ttvk44grdlp7.code.run/api/private/dashboard',currentEndpoint).replace('https://data-api.binance.vision/api/v3/ticker/price',priceEndpoint);
    }
    if(name==='app-access.js'){
      const production='https://p01--achi-meridian--ttvk44grdlp7.code.run/api/private/portfolio-history?range=1w';
      assert.equal(body.split(production).length,2,'exact app-verification endpoint replaced only in served test copy');
      body=body.replace(production,authEndpoint);
    }
    modules.set('/meridian/v11/'+name,body);
  }
  for(const path of ['portfolio-data-contract.js','v8-clean/live-price-core-r18.js'])modules.set('/meridian/'+path,readFileSync(new URL('../'+path,import.meta.url),'utf8'));
  modules.set('/meridian/research/strategy-paper-arena.js',readFileSync(new URL('../research/strategy-paper-arena.js',import.meta.url),'utf8'));
  modules.set('/meridian/docs/strategy-lab/campaign-20261013.json',readFileSync(new URL('../docs/strategy-lab/campaign-20261013.json',import.meta.url),'utf8'));
  const server=createServer((request,response)=>{
    const url=new URL(request.url,'http://127.0.0.1'),path=url.pathname;
    requests.push({method:request.method,path}); // never record headers or token values
    const versionedModule=path.startsWith('/meridian/v11/')&&moduleNames.includes(path.slice('/meridian/v11/'.length))&&url.search==='?v=B14-M11';
    if(request.method!=='GET'||(url.search&&!versionedModule)){response.writeHead(404);response.end();return;}
    if(path===authEndpoint){
      authReads++;
      if(!request.headers.authorization){response.writeHead(401);response.end('{}');return;}
      response.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
      response.end(JSON.stringify({version:'7.64-CANONICAL-PORTFOLIO-HISTORY-V3',points:[]}));return;
    }
    if(path===endpoint){
      reads++;
      if(!request.headers.authorization){response.writeHead(401);response.end('{}');return;}
      if(mode==='pending'){
        pending.add(response);response.on('close',()=>{pending.delete(response);if(!response.writableEnded)aborts++;});return;
      }
      response.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
      response.end(JSON.stringify({schemaVersion:'MERIDIAN-ASSET-WATCH-BRIDGE-V1',source:'PIONEX_WALLET_BOT_DETAIL',sourceSnapshotAt:new Date().toISOString(),freshnessLimitMs:900000,readOnly:true,executionImpact:false,detailsComplete:true,sourceStatusOk:true,fresh:true,usableForOverwrite:true,botCount:2,bots:[{botRef:'a'.repeat(20),symbol:'BTC',side:'SHORT',cateType:'inverse',botType:'futures_grid',sideSource:'economic_inverse_asset',leverage:3,investment:{usd:null,quoteAmount:0.42,currency:'ETH'},pnl:{usd:-12.5},limits:{lower:2000,upper:4000,liquidationPrice:1800,takeProfit:4500,stopLoss:1900}},{botRef:'b'.repeat(20),symbol:'ETH',side:'LONG',cateType:'linear',botType:'futures_grid',leverage:2,investment:{usd:100},pnl:{usd:8.25}}]}));return;
    }
    if(path===priceEndpoint||path===currentEndpoint){
      if(path===priceEndpoint)assert.equal(request.headers.authorization,undefined);else assert.ok(request.headers.authorization);
      response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify(path===priceEndpoint?[]:mode==='current'?{private:true,data:{portfolio:{holdings:[],manualVenueBalances:[{venue:'Ledger',valueUsd:10000,updatedAt:new Date().toISOString()},{venue:'OKX',valueUsd:2000,updatedAt:new Date().toISOString()}],pionexEquityUsd:3450,pionexEquityUpdatedAt:new Date().toISOString()}}}:{}));return;
    }
    if(path===depotEndpoint){
      depotReads++;
      if(!request.headers.authorization||mode==='denied'){response.writeHead(401);response.end('{}');return;}
      if(mode==='pending'){
        pending.add(response);response.on('close',()=>{pending.delete(response);if(!response.writableEnded)depotAborts++;});return;
      }
      if(mode==='current'||mode==='error'){response.writeHead(503,{'Content-Type':'application/json'});response.end('{}');return;}
      const stamp=Date.now()-(mode==='stale'?901000:1000);
      response.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
      const points=[2,1,0].map((n)=>({timestamp:stamp-n*300000,spotUsd:12000-n*50,tradingUsd:3450,totalUsd:15450-n*50,
        sourceStatus:{spot:'STRICT_AUTHORITY',trading:'PIONEX_EQUITY',tradingFresh:true,tradingAuthorityVersion:'PIONEX_FRESH_V1',
        tradingSource:'PIONEX_WALLET_READ_API',tradingUpdatedAt:stamp-n*300000-1000}}));
      response.end(JSON.stringify({version:'7.64-CANONICAL-PORTFOLIO-HISTORY-V3',source:'POSTGRES_CANONICAL_HISTORY',
        rawPointCount:mode==='curve'?3:4,excludedIncompletePoints:mode==='curve'?0:1,points}));return;
    }
    if(modules.has(path)){
      response.writeHead(200,{'Content-Type':path.endsWith('.json')?'application/json; charset=utf-8':'text/javascript; charset=utf-8','Cache-Control':'no-store'});response.end(modules.get(path));return;
    }
    if(path!=='/meridian/v11/'&&path!=='/meridian/v10/'){response.writeHead(404);response.end();return;}
    const preview=path==='/meridian/v11/';
    const origin='http://127.0.0.1:'+server.address().port;
    const scriptSource=preview?`'sha256-${scriptHash}' `+[...modules.keys()].map(path=>origin+path+(path.startsWith('/meridian/v11/')?'?v=B14-M11':'')).join(' '):"'none'";
    const policy=`default-src 'none'; script-src ${scriptSource}; style-src 'unsafe-inline'; connect-src ${preview?origin+endpoint+' '+origin+depotEndpoint+' '+origin+currentEndpoint+' '+origin+priceEndpoint+' '+origin+authEndpoint+' '+origin+'/meridian/docs/strategy-lab/campaign-20261013.json':"'none'"}; worker-src 'none'; child-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; manifest-src 'none'`;
    policies.set(path,policy);
    response.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':policy});response.end(preview?html:terminal);
  });
  return new Promise((resolve,reject)=>{
    server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve({
      base:`http://127.0.0.1:${server.address().port}/meridian/`,policies,requests,
      metrics:()=>({reads,aborts,depotReads,depotAborts,authReads,pending:pending.size}),setMode:value=>{mode=value;},
      allowedPaths:new Set(['/meridian/v11/','/meridian/v10/',endpoint,depotEndpoint,currentEndpoint,priceEndpoint,authEndpoint,...modules.keys()]),
      close:()=>new Promise((done,fail)=>{for(const response of pending)response.destroy();server.close(error=>error?fail(error):done());server.closeAllConnections();})
    }));
  });
}

test('terminal deployment fixture serves Arena dependencies under its CSP',async()=>{
  const server=await deploymentServer();
  try{
    const start=server.base+'v11/';
    const page=await fetch(start);
    assert.equal(page.status,200);
    const catalogUrl=new URL('strategy-catalog.js?v=B14-M11',start);
    const catalog=await fetch(catalogUrl);
    assert.equal(catalog.status,200);
    const source=await catalog.text();
    const imported=source.match(/from ['"](\.\/research-evidence\.js\?v=B14-M11)['"]/);
    assert.ok(imported,'catalog imports the read-only evidence module');
    const dependency=new URL(imported[1],catalogUrl);
    const response=await fetch(dependency);
    assert.equal(response.status,200,'catalog dependency must be served before browser bootstrap can succeed');
    assert.match(response.headers.get('content-type'),/^text\/javascript/);
    assert.equal(await response.text(),readFileSync(new URL('../v11/research-evidence.js',import.meta.url),'utf8'));
    const scriptPolicy=page.headers.get('content-security-policy').split(';').find(part=>part.trim().startsWith('script-src '));
    assert.ok(scriptPolicy.trim().split(/\s+/).includes(dependency.href),'exact dependency URL must be in script-src');
    assert.equal(server.allowedPaths.has(dependency.pathname),true);
    const arenaUrl=new URL('strategy-arena.js?v=B14-M11',start);
    const arenaSource=await (await fetch(arenaUrl)).text();
    const inspectionImport=arenaSource.match(/from ['"](\.\/arena-inspection-report\.js\?v=B14-M11)['"]/);
    assert.ok(inspectionImport,'Arena imports the metadata-only report adapter');
    const inspectionUrl=new URL(inspectionImport[1],arenaUrl);
    const inspection=await fetch(inspectionUrl);
    assert.equal(inspection.status,200);
    assert.match(inspection.headers.get('content-type'),/^text\/javascript/);
    assert.equal(await inspection.text(),readFileSync(new URL('../v11/arena-inspection-report.js',import.meta.url),'utf8'));
    assert.ok(scriptPolicy.trim().split(/\s+/).includes(inspectionUrl.href));
    assert.equal(server.allowedPaths.has(inspectionUrl.pathname),true);
    const historicalImport=arenaSource.match(/from ['"](\.\/arena-historical-result\.js\?v=B14-M11)['"]/);
    assert.ok(historicalImport,'Arena imports the bounded historical fixture adapter');
    const historicalUrl=new URL(historicalImport[1],arenaUrl);
    const historical=await fetch(historicalUrl);
    assert.equal(historical.status,200,'historical adapter must be served before Arena bootstrap can succeed');
    assert.match(historical.headers.get('content-type'),/^text\/javascript/);
    assert.equal(await historical.text(),readFileSync(new URL('../v11/arena-historical-result.js',import.meta.url),'utf8'));
    assert.ok(scriptPolicy.trim().split(/\s+/).includes(historicalUrl.href));
    assert.equal(server.allowedPaths.has(historicalUrl.pathname),true);
    const producerImport=arenaSource.match(/from ['"](\.\/arena-historical-export\.js\?v=B14-M11)['"]/);
    assert.ok(producerImport,'Arena imports the bounded producer export adapter');
    const producerUrl=new URL(producerImport[1],arenaUrl);
    const producer=await fetch(producerUrl);
    assert.equal(producer.status,200,'producer adapter must be served before Arena bootstrap can succeed');
    assert.match(producer.headers.get('content-type'),/^text\/javascript/);
    assert.equal(await producer.text(),readFileSync(new URL('../v11/arena-historical-export.js',import.meta.url),'utf8'));
    assert.ok(scriptPolicy.trim().split(/\s+/).includes(producerUrl.href),'exact producer dependency URL must be in script-src');
    assert.equal(server.allowedPaths.has(producerUrl.pathname),true);
    const rendererImport=arenaSource.match(/from ['"](\.\/arena-result-view\.js\?v=B14-M11)['"]/);
    assert.ok(rendererImport,'Arena imports the isolated result renderer');
    const rendererUrl=new URL(rendererImport[1],arenaUrl);
    const renderer=await fetch(rendererUrl);
    assert.equal(renderer.status,200,'renderer dependency must be served before Arena bootstrap can succeed');
    assert.match(renderer.headers.get('content-type'),/^text\/javascript/);
    assert.equal(await renderer.text(),readFileSync(new URL('../v11/arena-result-view.js',import.meta.url),'utf8'));
    assert.ok(scriptPolicy.trim().split(/\s+/).includes(rendererUrl.href),'exact renderer dependency URL must be in script-src');
    assert.equal(server.allowedPaths.has(rendererUrl.pathname),true);
    assert.deepEqual(server.metrics(),{reads:0,aborts:0,depotReads:0,depotAborts:0,authReads:0,pending:0});
  }finally{await server.close();}
});

async function browserRun(call,start,width,height,server){
  const evaluate=async expression=>{
    const response=await call('Runtime.evaluate',{expression,returnByValue:true});
    assert.ok(!response.exceptionDetails,'browser evaluation failed: '+JSON.stringify(response.exceptionDetails));
    return response.result?.value;
  };
  const key=async(name,code,virtual)=>{
    const text=name==='Enter'?'\r':'';
    await call('Input.dispatchKeyEvent',{
      type:text?'keyDown':'rawKeyDown',key:name,code,text,unmodifiedText:text,
      windowsVirtualKeyCode:virtual,nativeVirtualKeyCode:virtual
    });
    await call('Input.dispatchKeyEvent',{
      type:'keyUp',key:name,code,windowsVirtualKeyCode:virtual,nativeVirtualKeyCode:virtual
    });
  };
  const state=()=>evaluate(`({
    views:[...document.querySelectorAll('.view')].filter(view=>!view.hidden).map(view=>view.id),
    current:[...document.querySelectorAll('#nav button[aria-current="page"]')].map(button=>button.dataset.v),
    historyHidden:document.getElementById('version-panel').hidden,
    historyExpanded:document.getElementById('version-toggle').getAttribute('aria-expanded')
  })`);
  for(let attempt=0;attempt<100;attempt++){
    if(await evaluate(`document.activeElement.id==='app-access-password'`))break;
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  const lockedGate=await evaluate(`(()=>{
    const input=document.getElementById('app-access-password'),button=document.querySelector('#app-access-form button');
    return {appHidden:document.getElementById('app').hidden,gateHidden:document.getElementById('app-access-gate').hidden,
      password:input.type,height:button.getBoundingClientRect().height,inputHeight:input.getBoundingClientRect().height,
      passwordFields:document.querySelectorAll('input[type="password"]').length,
      duplicateFields:document.querySelectorAll('#bot-read-token,#depot-read-token').length,
      focused:document.activeElement===input};
  })()`);
  assert.deepEqual({...lockedGate,height:0,inputHeight:0},{appHidden:true,gateHidden:false,password:'password',
    height:0,inputHeight:0,passwordFields:1,duplicateFields:0,focused:true});
  assert.ok(lockedGate.height>=44&&lockedGate.inputHeight>=44,'unlock controls are at least 44px tall');
  const authReadsBefore=server.metrics().authReads;
  await evaluate(`document.getElementById('app-access-password').value='synthetic-b3-token';document.getElementById('app-access-password').focus();true`);
  await key('Enter','Enter',13);
  for(let attempt=0;attempt<100;attempt++){
    if(await evaluate(`!document.getElementById('app').hidden`))break;
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  assert.equal(await evaluate(`document.getElementById('app-access-gate').hidden`),true,
    'server-verified password opens the app: '+JSON.stringify(await evaluate(`({
      status:document.getElementById('app-access-status').textContent,
      appHidden:document.getElementById('app').hidden,authReads:${server.metrics().authReads},
      requests:performance.getEntriesByType('resource').filter(entry=>entry.name.includes('__test/app-access')).length
    })`)));
  assert.equal(await evaluate(`document.activeElement.id`),'app-main','focus moves into the app after verification');
  assert.equal(server.metrics().authReads,authReadsBefore+1,'app opening verifies against the bounded endpoint once');
  const initialReads=server.metrics().reads;
  const initial=await evaluate(`(()=>{
    const link=document.querySelector('a.strategy-entry-link'),rect=link.getBoundingClientRect(),style=getComputedStyle(link);
    return {width:innerWidth,height:innerHeight,viewport:document.documentElement.clientWidth,body:document.body.scrollWidth,
      root:document.documentElement.scrollWidth,count:document.querySelectorAll('a.strategy-entry-link').length,
      text:link.textContent,href:link.getAttribute('href'),height:rect.height,linkWidth:rect.width,
      visible:rect.width>0&&rect.height>0&&style.display!=='none'&&style.visibility==='visible',
      outsideHistory:!link.closest('#version-panel')&&!link.closest('[hidden]'),
      historyHidden:document.getElementById('version-panel').hidden};
  })()`);
  assert.equal(initial.width,width);assert.equal(initial.height,height);assert.equal(initial.viewport,width);
  assert.ok(initial.body<=width+1&&initial.root<=width+1,'initial page overflow at '+width);
  assert.equal(initial.count,1);assert.equal(initial.text,'Strategien öffnen');assert.equal(initial.href,'#view-strategies');
  assert.ok(initial.visible&&initial.outsideHistory&&initial.historyHidden,'entry is visible while history is closed');
  assert.ok(initial.height>=44&&initial.linkWidth>=44,'entry target is at least 44x44px');

  for(const tab of ['command','depot','bots','market','strategies']){
    await evaluate(`document.querySelector('#nav button[data-v="${tab}"]').focus();true`);
    await key('Enter','Enter',13);
    assert.deepEqual(await evaluate(`({
      view:[...document.querySelectorAll('.view')].filter(view=>!view.hidden).map(view=>view.id),
      current:[...document.querySelectorAll('#nav button[aria-current="page"]')].map(button=>button.dataset.v)
    })`),{view:['view-'+tab],current:[tab]},'native Enter tab navigation: '+tab);
    if(tab==='bots'){
      const bots=await evaluate(`(()=>{
        const panel=document.getElementById('view-bots');
        return {label:panel.querySelector('#bots-status-heading').textContent,
          activeProcessPlaceholder:panel.querySelector('.portfolio-value')?.textContent||null,
          staticStatusCells:panel.querySelectorAll('.trust-cell').length,
          controls:panel.querySelectorAll('button,input,select,form').length,
          controlDetails:[...panel.querySelectorAll('button,input,select,form')].map(control=>({
            tag:control.tagName.toLowerCase(),id:control.id,type:control.type||'',
            label:control.getAttribute('aria-label')||control.labels?.[0]?.textContent.trim()||control.textContent.trim(),
            hidden:control.hidden,disabled:control.disabled
          })),
          executionControls:[...panel.querySelectorAll('button')].map(button=>
            button.getAttribute('aria-label')||button.textContent.trim()).filter(label=>/(?:ausführ|order|kauf|verkauf|start|stopp)/i.test(label)),
          viewport:document.documentElement.clientWidth,body:document.body.scrollWidth,root:document.documentElement.scrollWidth};
      })()`);
      assert.equal(bots.label,'Deine Bots');
      assert.equal(bots.activeProcessPlaceholder,null,'snapshot rows do not imply active bot processes');
      assert.equal(bots.staticStatusCells,0,'freshness and read-only context appears with the current snapshot');
      assert.equal(server.metrics().reads,initialReads,'mount and navigation never fetch');
      assert.equal(bots.controls,8,'shared app password removes the redundant Bot credential controls');
      assert.deepEqual(bots.controlDetails,[
        {tag:'input',id:'bot-symbol-search',type:'search',label:'Symbol suchen',hidden:false,disabled:false},
        {tag:'select',id:'bot-direction-filter',type:'select-one',label:'Richtung',hidden:false,disabled:false},
        {tag:'select',id:'bot-category-filter',type:'select-one',label:'Kontraktart',hidden:false,disabled:false},
        {tag:'select',id:'bot-sort-filter',type:'select-one',label:'Sortierung',hidden:false,disabled:false},
        {tag:'button',id:'',type:'button',label:'Alle Botfilter zurücksetzen',hidden:false,disabled:false},
        {tag:'button',id:'',type:'button',label:'Zur vorherigen Auswahl zurück',hidden:true,disabled:false},
        {tag:'button',id:'bot-read-refresh',type:'button',label:'Bots aktualisieren',hidden:false,disabled:false},
        {tag:'button',id:'bot-read-lock',type:'button',label:'Botansicht sperren',hidden:false,disabled:false}
      ]);
      assert.deepEqual(bots.executionControls,[],'the Bot view exposes no execution controls');
      assert.deepEqual(await evaluate(`(()=>{
        const button=[...document.querySelectorAll('#view-bots button')].find(item=>item.textContent.trim()==='Zur vorherigen Auswahl zurück');
        const active=document.activeElement;button.focus();const focusStayed=document.activeElement===active;
        button.click();
        return {hidden:button.hidden,focusStayed,text:button.textContent.trim()};
      })()`),{hidden:true,focusStayed:true,text:'Zur vorherigen Auswahl zurück'},
      'return-selection control is hidden and inert before a prior selection exists');
      assert.equal(server.metrics().reads,initialReads,'inactive return-selection control does not fetch');
      assert.equal(bots.viewport,width);
      assert.ok(bots.body<=width+1&&bots.root<=width+1,'Bots panel overflow at '+width);
      const waitUntil=async predicate=>{
        for(let attempt=0;attempt<100;attempt++){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,20));}
        assert.fail('synthetic bot state timeout');
      };
      const refresh=()=>evaluate(`document.getElementById('bot-read-refresh').click();true`);
      const openApp=async()=>evaluate(`(()=>{const input=document.getElementById('app-access-password');input.value='synthetic-b3-token';document.getElementById('app-access-form').requestSubmit();return true;})()`);
      const readState=()=>evaluate(`document.querySelector('#bot-read-root [data-state]')?.dataset.state`);
      await refresh();await waitUntil(async()=>await readState()==='fresh');
      assert.equal(server.metrics().reads,initialReads+1,'one explicit read');
      assert.equal(await evaluate(`document.querySelectorAll('#bot-read-root li').length`),2);
      assert.equal(await evaluate(`document.getElementById('bot-read-root').textContent.includes('synthetic-b3-token')`),false);
      const cardMetrics=()=>evaluate(`(()=>{const c=document.querySelector('#bot-read-root .bot-card'),s=c.querySelector('summary'),r=s.getBoundingClientRect(),nav=document.querySelector('#nav').getBoundingClientRect();return {open:c.open,text:s.textContent,body:document.body.scrollWidth,root:document.documentElement.scrollWidth,summaryHeight:r.height,cardHeight:c.getBoundingClientRect().height,collapsedCards:[...document.querySelectorAll('#bot-read-root .bot-card:not([open])')].map(card=>card.getBoundingClientRect().height),navTop:nav.top,display:getComputedStyle(s).display,textUnrotated:[...s.querySelectorAll('.bot-card-heading,.bot-card-pnl,.bot-card-capital')].every(n=>getComputedStyle(n).transform==='none'),headingWidth:s.querySelector('.bot-card-heading').getBoundingClientRect().width,phrasing:s.querySelectorAll('dl,div,p').length};})()`);
      let card=await cardMetrics();
      assert.equal(card.open,false);assert.equal(card.display,'grid');assert.equal(card.textUnrotated,true);assert.ok(card.headingWidth>48,'symbol has usable line width');assert.equal(card.phrasing,0);assert.ok(card.summaryHeight>=44&&card.summaryHeight<=150);
      assert.match(card.text,/3×/);assert.match(card.text,/0,42 ETH/);assert.match(card.text,/-12,50 USD/);
      assert.ok(card.collapsedCards.length===2&&card.collapsedCards.every(value=>value>=44&&value<=150),
        'collapsed card heights at '+width+': '+JSON.stringify(card.collapsedCards));
      console.log('V11_BOT_COMPACT_MEASURE',JSON.stringify({width,height,collapsedCardHeights:card.collapsedCards}));
      assert.equal(await evaluate(`getComputedStyle(document.querySelector('#bot-read-root .bot-pnl-negative')).color`),'rgb(255, 155, 155)');
      assert.equal(await evaluate(`getComputedStyle(document.querySelector('#bot-read-root .bot-pnl-positive')).color`),'rgb(110, 231, 183)');
      assert.equal(await evaluate(`document.querySelector('#bot-read-root .bot-pnl-positive').textContent`),'+8,25 USD');
      assert.ok(card.body<=width+1&&card.root<=width+1,'collapsed card overflow');
      await evaluate(`document.querySelector('#bot-read-root summary').focus();true`);
      await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'});
      await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
      card=await cardMetrics();assert.equal(card.open,true,'native keyboard expands card');assert.equal(card.textUnrotated,true,'open card text must not inherit icon rotation');
      assert.ok(card.body<=width+1&&card.root<=width+1,'expanded card overflow');
      const expanded=await evaluate(`document.querySelector('#bot-read-root .bot-card-body').textContent`);
      assert.match(expanded,/Technische Referenz: a{20}/);
      assert.match(expanded,/Grid-Untergrenze2000/);assert.match(expanded,/P\/L laut Quelle · Originalwert-12.5 USD/);
      assert.match(expanded,/Nicht verfügbar/);
      assert.equal(server.metrics().reads,initialReads+1,'disclosure must never request data');
      await evaluate(`document.querySelector('#bot-read-root .bot-card').scrollIntoView({block:'center'});true`);
      assert.equal(await evaluate(`(()=>{const c=document.querySelector('#bot-read-root .bot-card').getBoundingClientRect(),n=document.querySelector('#nav').getBoundingClientRect();return c.bottom<=n.top})()`),true,'expanded card clears bottom navigation');
      const evidence=process.env.V11_A2_EVIDENCE_DIR;
      if(evidence){
        mkdirSync(evidence,{recursive:true});
        const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
        writeFileSync(join(evidence,`v11-bot-compact-${width}-expanded.png`),Buffer.from(shot.data,'base64'));
      }
      await evaluate(`document.querySelector('#bot-read-root summary').click();true`);
      assert.equal((await cardMetrics()).open,false);
      if(evidence){
        await evaluate(`document.querySelector('#bot-read-root .bot-card').scrollIntoView({block:'center'});true`);
        const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
        writeFileSync(join(evidence,`v11-bot-compact-${width}-collapsed.png`),Buffer.from(shot.data,'base64'));
        await evaluate(`document.querySelector('#bot-read-root .bot-pnl-positive').closest('.bot-card').scrollIntoView({block:'center'});true`);
        const positiveShot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
        writeFileSync(join(evidence,`v11-bot-compact-${width}-positive.png`),Buffer.from(positiveShot.data,'base64'));
      }
      await evaluate(`document.getElementById('bot-read-lock').click();true`);
      assert.equal(await readState(),'locked');assert.equal(await evaluate(`document.querySelector('#depot-read-root svg')===null`),true);assert.equal(await evaluate(`document.querySelectorAll('#bot-read-root li').length`),0);
      assert.equal(await evaluate(`document.getElementById('app').hidden`),true,'reader lock also hides the complete private app');
      await refresh();assert.equal(server.metrics().reads,initialReads+1,'locked credential cannot request');
      await openApp();await waitUntil(async()=>await evaluate(`!document.getElementById('app').hidden`));
      server.setMode('pending');const aborts=server.metrics().aborts;
      await refresh();await waitUntil(()=>server.metrics().pending===1);
      await evaluate(`Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));delete document.hidden;true`);
      assert.equal(await evaluate(`document.getElementById('app').hidden`),true,'private content is hidden while backgrounded');
      assert.equal(server.metrics().aborts,aborts,'brief backgrounding does not revoke app access');
      await evaluate(`Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));true`);
      await evaluate(`document.getElementById('app-access-lock').click();true`);
      await waitUntil(()=>server.metrics().aborts>aborts);
      assert.equal(await readState(),'locked');assert.equal(await evaluate(`document.querySelector('#depot-read-root svg')===null`),true);assert.equal(server.metrics().pending,0);
      const readsAfterHide=server.metrics().reads;
      await evaluate(`window.dispatchEvent(new Event('focus'));window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));true`);
      await refresh();assert.equal(server.metrics().reads,readsAfterHide,'pagehide/lock keeps readers locked; focus does not fetch');
      server.setMode('fresh');
      await openApp();await waitUntil(async()=>await evaluate(`!document.getElementById('app').hidden`));
    }
    if(tab==='depot'){
      const openApp=async()=>evaluate(`(()=>{const input=document.getElementById('app-access-password');input.value='synthetic-b3-token';document.getElementById('app-access-form').requestSubmit();return input.value;})()`);
      const waitApp=async()=>{for(let i=0;i<100;i++){if(await evaluate(`!document.getElementById('app').hidden`))return;await new Promise(r=>setTimeout(r,20));}assert.fail('App unlock timeout');};
      const opened=server.metrics().authReads;
      assert.equal(await evaluate(`(()=>{const input=document.getElementById('app-access-password');input.value='https://p01--achi-meridian--ttvk44grdlp7.code.run/api/private/asset-watch?share='+'a'.repeat(43);document.getElementById('app-access-form').requestSubmit();return input.value;})()`),'');
      await new Promise(r=>setTimeout(r,20));
      assert.equal(await evaluate(`document.getElementById('app').hidden`),true,'bot share link cannot unlock Depot or the app');
      assert.equal(server.metrics().authReads,opened,'share credential is rejected before the app endpoint');
      await openApp();await waitApp();
      const initial=server.metrics().depotReads;
      const readState=()=>evaluate(`document.querySelector('#depot-read-root [data-state]')?.dataset.state`);
      const waitUntil=async check=>{for(let i=0;i<100;i++){if(await check())return;await new Promise(r=>setTimeout(r,20));}assert.fail('Depot state timeout');};
      await waitUntil(async()=>await readState()==='locked');
      assert.equal(server.metrics().depotReads,initial,'mount/navigation never reads Depot');
      const refresh=()=>evaluate(`document.querySelector('#depot-read-root button').focus();document.querySelector('#depot-read-root button').click();true`);
      await refresh();await waitUntil(async()=>await readState()==='fresh');
      const depot=await evaluate(`(()=>{const root=document.getElementById('depot-read-root');return {
        text:root.textContent,amount:root.querySelector('.depot-total').textContent,overflow:document.documentElement.scrollWidth>innerWidth+1,
        status:root.querySelector('[role=status]').getAttribute('aria-live'),focus:document.activeElement===root.querySelector('button'),
        targets:[...root.querySelectorAll('button')].every(x=>x.getBoundingClientRect().height>=44)};})()`);
      assert.equal(await evaluate(`document.querySelector('#command-portfolio .portfolio-value').textContent`),depot.amount);
      assert.match(await evaluate(`document.querySelector('#command-portfolio .portfolio-description').textContent`),/Gespeicherte/);
      const commandReads=server.metrics().depotReads;
      await evaluate(`document.querySelector('#nav button[data-v="command"]').click();true`);
      assert.equal(server.metrics().depotReads,commandReads,'Command navigation does not fetch');
      assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth+1`),true);
      await evaluate(`document.querySelector('#nav button[data-v="depot"]').click();true`);
      assert.match(depot.amount,/15.450/);assert.match(depot.text,/Datenlücken/);assert.match(depot.text,/keine Live-Kurse/);
      assert.doesNotMatch(depot.text,/synthetic-b7-password/);assert.equal(depot.overflow,false);assert.equal(depot.status,'polite');assert.equal(depot.focus,true);assert.equal(depot.targets,true);
      if(process.env.V11_A2_EVIDENCE_DIR){mkdirSync(process.env.V11_A2_EVIDENCE_DIR,{recursive:true});
        const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
        writeFileSync(join(process.env.V11_A2_EVIDENCE_DIR,'v11-depot-'+width+'-fresh.png'),Buffer.from(shot.data,'base64'));}
      if(process.env.V11_B10_EVIDENCE_DIR&&width===375){mkdirSync(process.env.V11_B10_EVIDENCE_DIR,{recursive:true});
        const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
        writeFileSync(join(process.env.V11_B10_EVIDENCE_DIR,'v11-b10-synthetic-depot-filled-375x844.png'),Buffer.from(shot.data,'base64'));}
      const beforeRange=server.metrics().depotReads;
      for(const range of ['1h','1d','1w']){await evaluate(`document.querySelector('[data-range="${range}"]').click();true`);assert.equal(await evaluate(`document.querySelector('[data-range="${range}"]').getAttribute('aria-pressed')`),'true');}
      assert.equal(server.metrics().depotReads,beforeRange,'range changes never request data');
      server.setMode('curve');await refresh();await waitUntil(async()=>await readState()==='fresh');
      assert.equal(await evaluate(`document.querySelectorAll('.depot-history svg polyline').length`),1);
      assert.equal(await evaluate(`document.querySelectorAll('.depot-history svg circle').length`),3);
      assert.equal(await evaluate(`document.querySelectorAll('.depot-history svg text').length`),3);
      assert.match(await evaluate(`document.querySelector('.depot-history').textContent`),/Vorhandene Messungen/);
      await evaluate(`document.querySelector('.depot-history').scrollIntoView({block:'center'});true`);
      assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth+1`),true);
      if(process.env.V11_A2_EVIDENCE_DIR){const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(join(process.env.V11_A2_EVIDENCE_DIR,'v11-depot-history-'+width+'.png'),Buffer.from(shot.data,'base64'));}
      server.setMode('current');await refresh();await waitUntil(async()=>await readState()==='fresh');
      assert.match(await evaluate(`document.querySelector('#depot-read-root').textContent`),/serverseitigen Depotdaten/);
      assert.match(await evaluate(`document.querySelector('#depot-read-root .depot-total').textContent`),/15.450/);
      assert.match(await evaluate(`document.querySelector('.depot-history').textContent`),/Verlauf nicht verfügbar/);
      assert.match(await evaluate(`document.querySelector('#command-portfolio .portfolio-description').textContent`),/Serverseitige/);
      server.setMode('error');await refresh();await waitUntil(async()=>await readState()==='unavailable');
      assert.equal(await evaluate(`document.querySelector('#depot-read-root .depot-total')===null`),true);
      if(process.env.V11_B10_EVIDENCE_DIR&&width===375){await evaluate(`document.getElementById('depot-read-root').scrollIntoView({block:'center'});true`);
        const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
        writeFileSync(join(process.env.V11_B10_EVIDENCE_DIR,'v11-b10-synthetic-depot-error-375x844.png'),Buffer.from(shot.data,'base64'));}
      server.setMode('stale');await refresh();await waitUntil(async()=>await readState()==='stale');
      assert.equal(await evaluate(`document.querySelector('#depot-read-root .depot-total')===null`),true);
      assert.equal(await evaluate(`document.querySelector('#command-portfolio .portfolio-value').textContent`),'—');
      if(process.env.V11_B10_EVIDENCE_DIR&&width===375){await evaluate(`document.getElementById('depot-read-root').scrollIntoView({block:'center'});true`);
        const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
        writeFileSync(join(process.env.V11_B10_EVIDENCE_DIR,'v11-b10-synthetic-depot-stale-375x844.png'),Buffer.from(shot.data,'base64'));}
      server.setMode('denied');await refresh();await waitUntil(async()=>await readState()==='locked');
      const rejected=server.metrics().depotReads;await refresh();assert.equal(server.metrics().depotReads,rejected,'401 clears credential');
      server.setMode('pending');await openApp();await waitApp();const aborts=server.metrics().depotAborts;
      await refresh();await waitUntil(()=>server.metrics().pending===1);
      await evaluate(`Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));delete document.hidden;true`);
      assert.equal(await evaluate(`document.getElementById('app').hidden`),true);
      assert.equal(server.metrics().depotAborts,aborts,'visibility change retains an in-window credential');
      await evaluate(`Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));document.getElementById('app-access-lock').click();true`);
      await waitUntil(()=>server.metrics().depotAborts>aborts);
      assert.equal(await readState(),'locked');assert.equal(await evaluate(`document.querySelector('#depot-read-root svg')===null`),true);
      assert.equal(await evaluate(`document.querySelector('#command-portfolio .portfolio-value').textContent`),'—');
      const stopped=server.metrics().depotReads;await evaluate(`window.dispatchEvent(new Event('focus'));window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));true`);
      await refresh();assert.equal(server.metrics().depotReads,stopped,'lock keeps Depot locked; focus never reads');server.setMode('fresh');
      await openApp();await waitApp();
    }
  }
  await evaluate(`document.getElementById('version-toggle').focus();true`);
  await key('Enter','Enter',13);
  assert.equal(await evaluate(`!document.getElementById('version-panel').hidden`),true,'history opens with Enter');
  await key('Escape','Escape',27);
  assert.equal(await evaluate(`document.getElementById('version-panel').hidden&&document.activeElement.id==='version-toggle'`),true,
    'Escape closes history and restores focus');

  await evaluate(`document.querySelector('#nav button[data-v="depot"]').focus();true`);
  await key('Enter','Enter',13);
  await evaluate(`document.getElementById('version-toggle').focus();true`);
  await key('Enter','Enter',13);
  const before=await state();
  assert.deepEqual(before,{views:['view-depot'],current:['depot'],historyHidden:false,historyExpanded:'true'});
  await key('Tab','Tab',9);
  const lockTarget=await evaluate(`(()=>{const node=document.activeElement,rect=node.getBoundingClientRect();return {id:node.id,height:rect.height,width:rect.width};})()`);
  assert.equal(lockTarget.id,'app-access-lock','app lock follows the version button in keyboard order');
  assert.ok(lockTarget.height>=44&&lockTarget.width>=44,'app lock target is at least 44x44px');
  await key('Tab','Tab',9);
  assert.equal(await evaluate(`document.activeElement.matches('a.strategy-entry-link')`),true,
    'strategy entry follows the app lock in keyboard order');
  const focus=await evaluate(`(()=>{
    const style=getComputedStyle(document.activeElement);
    return {visible:document.activeElement.matches(':focus-visible'),outline:style.outlineStyle,width:parseFloat(style.outlineWidth)};
  })()`);
  assert.ok(focus.visible&&focus.outline!=='none'&&focus.width>=3,'keyboard focus indicator is visible');
  const requestCount=server.requests.length;
  await key('Enter','Enter',13);
  for(let attempt=0;attempt<100;attempt++){
    if(await evaluate(`document.querySelectorAll('#strategy-catalog .strategy-family').length===12`))break;
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  const strategyState=await evaluate(`({
    url:location.href,view:[...document.querySelectorAll('.view')].filter(view=>!view.hidden).map(view=>view.id),
    current:[...document.querySelectorAll('#nav button[aria-current="page"]')].map(button=>button.dataset.v),
    v10Links:[...document.querySelectorAll('a[href*="v10"]')].map(link=>link.getAttribute('href')),
    viewport:document.documentElement.clientWidth,body:document.body.scrollWidth,root:document.documentElement.scrollWidth
  })`);
  assert.equal(strategyState.url,start,'native Strategies navigation does not change document');
  assert.deepEqual(strategyState.view,['view-strategies']);assert.deepEqual(strategyState.current,['strategies']);
  const rendered=await evaluate(`document.querySelector('#strategy-catalog').textContent`);
  assert.equal((await evaluate(`document.querySelectorAll('#strategy-catalog .strategy-family').length`)),12);
  assert.match(rendered,/H1Hypothese/);assert.match(rendered,/7 Assets · 44 geplante Pfade/);
  assert.deepEqual(strategyState.v10Links,[],'active M11 shell has no V10 link');
  assert.ok(strategyState.body<=width+1&&strategyState.root<=width+1,'Strategies shell overflow at '+width);
  assert.ok(server.requests.length>=requestCount,'native navigation can load its local source register');
  assert.ok(server.requests.every(request=>request.method==='GET'&&server.allowedPaths.has(request.path)),
    'only exact document/module paths and synthetic GET endpoint are served');
  return {width,strategies:rendered.length,focus,before};
}

test('actual M11 app access and Strategies entry work at mobile and desktop widths',{timeout:180000},async()=>{
  if(typeof WebSocket!=='function'){
    assert.notEqual(process.env.V11_TERMINAL_CDP_CHILD,'1','WebSocket-enabled child has no WebSocket');
    const env={...process.env,V11_TERMINAL_CDP_CHILD:'1'};delete env.NODE_TEST_CONTEXT;
    const child=spawnSync(process.execPath,['--experimental-websocket',fileURLToPath(import.meta.url)],
      {encoding:'utf8',timeout:175000,env});
    assert.equal(child.status,0,'browser child failed: '+String(child.stdout).slice(-2500)+' '+String(child.stderr).slice(-1200));
    const results=String(child.stdout).split('\n').filter(line=>line.startsWith('V11_STRATEGIES_WIDTH '));
    const measurements=String(child.stdout).split('\n').filter(line=>line.startsWith('V11_BOT_COMPACT_MEASURE '));
    assert.equal(results.length,5,'expected actual Chrome results at all four widths and desktop');
    assert.equal(measurements.length,5,'expected card measurements at every viewport');
    for(const result of [...results,...measurements])console.log(result);
    return;
  }
  assert.ok(chrome,'Chrome binary required; browser acceptance cannot be skipped');
  const server=await deploymentServer();
  try{
    const start=server.base+'v11/';
    for(const [width,height] of [[320,568],[375,667],[390,844],[430,932],[1440,900]]){
      const result=await withMobileChrome(chrome,width,start,call=>browserRun(call,start,width,height,server),height);
      console.log('V11_STRATEGIES_WIDTH',JSON.stringify(result));
    }
  }finally{
    await server.close();
  }
});
