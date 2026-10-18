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
function restoreB2(source){
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

const moduleNames=['bot-read-bootstrap.js','bot-read-access.js','bot-read-client.js','bot-read-view.js','bot-read-model.js','depot-read-bootstrap.js','depot-read-client.js','depot-read-model.js','depot-read-view.js','depot-history-model.js','depot-history-view.js','depot-current-model.js'];
function deploymentServer(){
  const inlineScript=html.match(/<script>([\s\S]*?)<\/script>/i)?.[1];
  assert.ok(inlineScript,'actual UI-only navigation script');
  const scriptHash=createHash('sha256').update(inlineScript).digest('base64');
  const policies=new Map(),requests=[],modules=new Map(),pending=new Set();
  let reads=0,aborts=0,depotReads=0,depotAborts=0,mode='fresh';
  const endpoint='/meridian/__test/bot-snapshot',depotEndpoint='/meridian/__test/depot-snapshot',currentEndpoint='/meridian/__test/depot-current',priceEndpoint='/meridian/__test/depot-prices';
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
    modules.set('/meridian/v11/'+name,body);
  }
  for(const path of ['portfolio-data-contract.js','v8-clean/live-price-core-r18.js'])modules.set('/meridian/'+path,readFileSync(new URL('../'+path,import.meta.url),'utf8'));
  const server=createServer((request,response)=>{
    const url=new URL(request.url,'http://127.0.0.1'),path=url.pathname;
    requests.push({method:request.method,path}); // never record headers or token values
    const versionedModule=(path==='/meridian/v11/bot-read-bootstrap.js'||path==='/meridian/v11/bot-read-view.js')&&url.search==='?v=B6'||path==='/meridian/v11/depot-read-bootstrap.js'&&url.search==='?v=B9';
    if(request.method!=='GET'||(url.search&&!versionedModule)){response.writeHead(404);response.end();return;}
    if(path===endpoint){
      reads++;
      if(request.headers.authorization!=='Bearer synthetic-b3-token'){response.writeHead(401);response.end('{}');return;}
      if(mode==='pending'){
        pending.add(response);response.on('close',()=>{pending.delete(response);if(!response.writableEnded)aborts++;});return;
      }
      response.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
      response.end(JSON.stringify({schemaVersion:'MERIDIAN-ASSET-WATCH-BRIDGE-V1',source:'PIONEX_WALLET_BOT_DETAIL',sourceSnapshotAt:new Date().toISOString(),freshnessLimitMs:900000,readOnly:true,executionImpact:false,detailsComplete:true,sourceStatusOk:true,fresh:true,usableForOverwrite:true,botCount:2,bots:[{botRef:'a'.repeat(20),symbol:'BTC',side:'SHORT',cateType:'inverse',botType:'futures_grid',sideSource:'economic_inverse_asset',leverage:3,investment:{usd:null,quoteAmount:0.42,currency:'ETH'},pnl:{usd:-12.5},limits:{lower:2000,upper:4000,liquidationPrice:1800,takeProfit:4500,stopLoss:1900}},{botRef:'b'.repeat(20),symbol:'ETH',side:'LONG',cateType:'linear',botType:'futures_grid',leverage:2,investment:{usd:100},pnl:{usd:8.25}}]}));return;
    }
    if(path===priceEndpoint||path===currentEndpoint){
      assert.equal(request.headers.authorization,path===priceEndpoint?undefined:'Bearer synthetic-b7-password');
      response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify(path===priceEndpoint?[]:mode==='current'?{private:true,data:{portfolio:{holdings:[],manualVenueBalances:[{venue:'Ledger',valueUsd:10000,updatedAt:new Date().toISOString()},{venue:'OKX',valueUsd:2000,updatedAt:new Date().toISOString()}],pionexEquityUsd:3450,pionexEquityUpdatedAt:new Date().toISOString()}}}:{}));return;
    }
    if(path===depotEndpoint){
      depotReads++;
      if(request.headers.authorization!=='Bearer synthetic-b7-password'||mode==='denied'){
        response.writeHead(401);response.end('{}');return;
      }
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
      response.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'});response.end(modules.get(path));return;
    }
    if(path!=='/meridian/v11/'&&path!=='/meridian/v10/'){response.writeHead(404);response.end();return;}
    const preview=path==='/meridian/v11/';
    const origin='http://127.0.0.1:'+server.address().port;
    const scriptSource=preview?`'sha256-${scriptHash}' `+[...modules.keys()].map(path=>origin+path).join(' '):"'none'";
    const policy=`default-src 'none'; script-src ${scriptSource}; style-src 'unsafe-inline'; connect-src ${preview?origin+endpoint+' '+origin+depotEndpoint+' '+origin+currentEndpoint+' '+origin+priceEndpoint:"'none'"}; worker-src 'none'; child-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; manifest-src 'none'`;
    policies.set(path,policy);
    response.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':policy});response.end(preview?html:terminal);
  });
  return new Promise((resolve,reject)=>{
    server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve({
      base:`http://127.0.0.1:${server.address().port}/meridian/`,policies,requests,
      metrics:()=>({reads,aborts,depotReads,depotAborts,pending:pending.size}),setMode:value=>{mode=value;},
      allowedPaths:new Set(['/meridian/v11/','/meridian/v10/',endpoint,depotEndpoint,currentEndpoint,priceEndpoint,...modules.keys()]),
      close:()=>new Promise((done,fail)=>{for(const response of pending)response.destroy();server.close(error=>error?fail(error):done());server.closeAllConnections();})
    }));
  });
}

async function browserRun(call,start,width,expectedBuild,server){
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
  const waitForUrl=async url=>{
    for(let attempt=0;attempt<100;attempt++){
      try{
        if(await evaluate(`location.href===${JSON.stringify(url)}&&document.readyState==="complete"`))return;
      }catch{}
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    assert.fail('browser did not finish navigation to '+url);
  };
  const state=()=>evaluate(`({
    views:[...document.querySelectorAll('.view')].filter(view=>!view.hidden).map(view=>view.id),
    current:[...document.querySelectorAll('#nav button[aria-current="page"]')].map(button=>button.dataset.v),
    historyHidden:document.getElementById('version-panel').hidden,
    historyExpanded:document.getElementById('version-toggle').getAttribute('aria-expanded')
  })`);
  const lifecycleKey='meridian-v11-navigation-lifecycle';
  const lifecycleSource=`(()=>{
    if(location.pathname!=='/meridian/v11/')return;
    const key=${JSON.stringify(lifecycleKey)},documentId=crypto.randomUUID();
    const recordEvent=(type,persisted=null)=>{
      const record=JSON.parse(sessionStorage.getItem(key)||'{"events":[]}');
      record.events.push({type,documentId,persisted});
      record.currentDocumentId=documentId;
      sessionStorage.setItem(key,JSON.stringify(record));
    };
    window.__v11NavigationDocumentId=documentId;
    recordEvent('document');
    addEventListener('pagehide',event=>recordEvent('pagehide',event.persisted));
    addEventListener('pageshow',event=>recordEvent('pageshow',event.persisted));
  })()`;
  const waitForPageShow=async url=>{
    for(let attempt=0;attempt<100;attempt++){
      try{
        const result=await evaluate(`(()=>{
          if(location.href!==${JSON.stringify(url)}||document.readyState!=='complete')return null;
          const documentId=window.__v11NavigationDocumentId;
          if(!documentId)return null;
          const record=JSON.parse(sessionStorage.getItem(${JSON.stringify(lifecycleKey)})||'{"events":[]}');
          const pageshow=[...record.events].reverse().find(event=>event.type==='pageshow'&&event.documentId===documentId);
          return pageshow?{documentId,pageshow,events:record.events}:null;
        })()`);
        if(result)return result;
      }catch{}
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    assert.fail('v11 document did not report its pageshow lifecycle');
  };

  const initialReads=server.metrics().reads;
  const initial=await evaluate(`(()=>{
    const link=document.querySelector('a.terminal-entry-link'),rect=link.getBoundingClientRect(),style=getComputedStyle(link);
    return {width:innerWidth,viewport:document.documentElement.clientWidth,body:document.body.scrollWidth,
      root:document.documentElement.scrollWidth,count:document.querySelectorAll('a.terminal-entry-link').length,
      text:link.textContent,href:link.getAttribute('href'),height:rect.height,linkWidth:rect.width,
      visible:rect.width>0&&rect.height>0&&style.display!=='none'&&style.visibility==='visible',
      outsideHistory:!link.closest('#version-panel')&&!link.closest('[hidden]'),
      historyHidden:document.getElementById('version-panel').hidden};
  })()`);
  assert.equal(initial.width,width);assert.equal(initial.viewport,width);
  assert.ok(initial.body<=width+1&&initial.root<=width+1,'initial page overflow at '+width);
  assert.equal(initial.count,1);assert.equal(initial.text,'Terminal öffnen');assert.equal(initial.href,'../v10/');
  assert.ok(initial.visible&&initial.outsideHistory&&initial.historyHidden,'entry is visible while history is closed');
  assert.ok(initial.height>=44&&initial.linkWidth>=44,'entry target is at least 44x44px');

  for(const tab of ['command','depot','bots','market','research']){
    await evaluate(`document.querySelector('#nav button[data-v="${tab}"]').focus();true`);
    await key('Enter','Enter',13);
    assert.deepEqual(await evaluate(`({
      view:[...document.querySelectorAll('.view')].filter(view=>!view.hidden).map(view=>view.id),
      current:[...document.querySelectorAll('#nav button[aria-current="page"]')].map(button=>button.dataset.v)
    })`),{view:['view-'+tab],current:[tab]},'native Enter tab navigation: '+tab);
    if(tab==='bots'){
      const bots=await evaluate(`(()=>{
        const panel=document.getElementById('view-bots');
        return {label:panel.querySelector('.limited').textContent,
          value:panel.querySelector('.portfolio-value').getAttribute('aria-label'),
          states:[...panel.querySelectorAll('.trust-cell')].map(cell=>[cell.querySelector('strong').textContent,cell.querySelector('span').textContent]),
          controls:panel.querySelectorAll('button,input,select,form').length,
          viewport:document.documentElement.clientWidth,body:document.body.scrollWidth,root:document.documentElement.scrollWidth};
      })()`);
      assert.equal(bots.label,'Nur lesend');
      assert.equal(bots.value,'Anzahl aktiver Bots unbekannt');
      assert.deepEqual(bots.states,[['Quelle','Snapshot unten'],['Aktualität','Je manueller Abfrage'],['Risiko','Nicht bestimmbar']]);
      assert.equal(server.metrics().reads,initialReads,'mount and navigation never fetch');
      assert.equal(bots.controls,4,'one credential input and three read/lock controls, no execution controls');
      assert.equal(bots.viewport,width);
      assert.ok(bots.body<=width+1&&bots.root<=width+1,'Bots panel overflow at '+width);
      const waitUntil=async predicate=>{
        for(let attempt=0;attempt<100;attempt++){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,20));}
        assert.fail('synthetic bot state timeout');
      };
      const accept=()=>evaluate(`document.getElementById('bot-read-token').value='synthetic-b3-token';document.getElementById('bot-read-provide').click();true`);
      const refresh=()=>evaluate(`document.querySelector('#bot-read-root button').click();true`);
      const readState=()=>evaluate(`document.querySelector('#bot-read-root [data-state]')?.dataset.state`);
      await accept();assert.equal(server.metrics().reads,initialReads,'accepting access does not fetch');
      assert.equal(await evaluate(`document.getElementById('bot-read-token').value`),'','input cleared');
      await refresh();await waitUntil(async()=>await readState()==='fresh');
      assert.equal(server.metrics().reads,initialReads+1,'one explicit read');
      assert.equal(await evaluate(`document.querySelectorAll('#bot-read-root li').length`),2);
      assert.equal(await evaluate(`document.getElementById('bot-read-root').textContent.includes('synthetic-b3-token')`),false);
      const cardMetrics=()=>evaluate(`(()=>{const c=document.querySelector('#bot-read-root .bot-card'),s=c.querySelector('summary'),r=s.getBoundingClientRect();return {open:c.open,text:s.textContent,body:document.body.scrollWidth,root:document.documentElement.scrollWidth,summaryHeight:r.height,display:getComputedStyle(s).display,unrotated:[...s.querySelectorAll('span')].every(n=>getComputedStyle(n).transform==='none'),headingWidth:s.querySelector('.bot-card-heading').getBoundingClientRect().width,phrasing:s.querySelectorAll('dl,div,p').length};})()`);
      let card=await cardMetrics();
      assert.equal(card.open,false);assert.equal(card.display,'block');assert.equal(card.unrotated,true);assert.ok(card.headingWidth>180,'heading has usable line width');assert.equal(card.phrasing,0);assert.ok(card.summaryHeight>=44);
      assert.match(card.text,/3×/);assert.match(card.text,/0,42 ETH/);assert.match(card.text,/-12,5 USD/);
      assert.equal(await evaluate(`getComputedStyle(document.querySelector('#bot-read-root .bot-pnl-negative')).color`),'rgb(255, 155, 155)');
      assert.equal(await evaluate(`getComputedStyle(document.querySelector('#bot-read-root .bot-pnl-positive')).color`),'rgb(110, 231, 183)');
      assert.equal(await evaluate(`document.querySelector('#bot-read-root .bot-pnl-positive').textContent`),'8,25 USD');
      assert.ok(card.body<=width+1&&card.root<=width+1,'collapsed card overflow');
      await evaluate(`document.querySelector('#bot-read-root summary').focus();true`);
      await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'});
      await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
      card=await cardMetrics();assert.equal(card.open,true,'native keyboard expands card');assert.equal(card.unrotated,true,'open card text must not inherit icon rotation');
      assert.ok(card.body<=width+1&&card.root<=width+1,'expanded card overflow');
      const expanded=await evaluate(`document.querySelector('#bot-read-root .bot-card-body').textContent`);
      assert.match(expanded,/Grid-Untergrenze/);assert.match(expanded,/2.000/);assert.match(expanded,/Nicht verfügbar/);
      assert.equal(server.metrics().reads,initialReads+1,'disclosure must never request data');
      const evidence=process.env.V11_A2_EVIDENCE_DIR;
      if(evidence){
        mkdirSync(evidence,{recursive:true});
        await evaluate(`document.getElementById('bot-read-root').scrollIntoView({block:'center'});true`);
        const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
        writeFileSync(join(evidence,`v11-b6-${width}-expanded.png`),Buffer.from(shot.data,'base64'));
      }
      await evaluate(`document.querySelector('#bot-read-root summary').click();true`);
      assert.equal((await cardMetrics()).open,false);
      if(evidence){
        await evaluate(`document.querySelector('#bot-read-root .bot-card').scrollIntoView({block:'center'});true`);
        const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
        writeFileSync(join(evidence,`v11-b6-${width}-collapsed.png`),Buffer.from(shot.data,'base64'));
        await evaluate(`document.querySelector('#bot-read-root .bot-pnl-positive').closest('.bot-card').scrollIntoView({block:'center'});true`);
        const positiveShot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
        writeFileSync(join(evidence,`v11-b6-${width}-positive.png`),Buffer.from(positiveShot.data,'base64'));
      }
      await evaluate(`document.querySelectorAll('#bot-read-root button')[1].click();true`);
      assert.equal(await readState(),'locked');assert.equal(await evaluate(`document.querySelector('#depot-read-root svg')===null`),true);assert.equal(await evaluate(`document.querySelectorAll('#bot-read-root li').length`),0);
      await refresh();assert.equal(server.metrics().reads,initialReads+1,'locked credential cannot request');
      await accept();server.setMode('pending');const aborts=server.metrics().aborts;
      await refresh();await waitUntil(()=>server.metrics().pending===1);
      // Synthetic hidden event exercises lifecycle logic; this is not real Safari background acceptance.
      await evaluate(`Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));delete document.hidden;true`);
      await waitUntil(()=>server.metrics().aborts>aborts);
      assert.equal(await readState(),'locked');assert.equal(await evaluate(`document.querySelector('#depot-read-root svg')===null`),true);assert.equal(server.metrics().pending,0);
      const readsAfterHide=server.metrics().reads;
      await evaluate(`window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('pageshow'));true`);
      await refresh();assert.equal(server.metrics().reads,readsAfterHide,'hidden cleared credential; focus does not fetch');
      server.setMode('fresh');

    }
    if(tab==='depot'){
      const initial=server.metrics().depotReads;
      const readState=()=>evaluate(`document.querySelector('#depot-read-root [data-state]')?.dataset.state`);
      const waitUntil=async check=>{for(let i=0;i<100;i++){if(await check())return;await new Promise(r=>setTimeout(r,20));}assert.fail('Depot state timeout');};
      await waitUntil(async()=>await readState()==='locked');
      assert.equal(server.metrics().depotReads,initial,'mount/navigation never reads Depot');
      const accept=async value=>evaluate(`(()=>{document.getElementById('depot-read-token').value=${JSON.stringify(value)};document.getElementById('depot-read-provide').click();return document.getElementById('depot-read-token').value;})()`);
      const refresh=()=>evaluate(`document.querySelector('#depot-read-root button').focus();document.querySelector('#depot-read-root button').click();true`);
      await accept('https://foreign.example/share');await refresh();assert.equal(server.metrics().depotReads,initial);
      assert.equal(await accept('synthetic-b7-password'),'');assert.equal(server.metrics().depotReads,initial,'provision never reads');
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
      server.setMode('pending');await accept('synthetic-b7-password');const aborts=server.metrics().depotAborts;
      await refresh();await waitUntil(()=>server.metrics().pending===1);
      await evaluate(`Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));delete document.hidden;true`);
      await waitUntil(()=>server.metrics().depotAborts>aborts);assert.equal(await readState(),'locked');assert.equal(await evaluate(`document.querySelector('#depot-read-root svg')===null`),true);
      assert.equal(await evaluate(`document.querySelector('#command-portfolio .portfolio-value').textContent`),'—');
      const stopped=server.metrics().depotReads;await evaluate(`window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('pageshow'));true`);
      await refresh();assert.equal(server.metrics().depotReads,stopped,'hide clears Depot access; focus never reads');server.setMode('fresh');
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
  assert.equal(await evaluate(`document.activeElement.matches('a.terminal-entry-link')`),true,
    'entry follows the history button in keyboard order');
  const focus=await evaluate(`(()=>{
    const style=getComputedStyle(document.activeElement);
    return {visible:document.activeElement.matches(':focus-visible'),outline:style.outlineStyle,width:parseFloat(style.outlineWidth)};
  })()`);
  assert.ok(focus.visible&&focus.outline!=='none'&&focus.width>=3,'keyboard focus indicator is visible');
  await evaluate(`document.addEventListener('click',event=>{
    const link=event.target.closest?.('a.terminal-entry-link');
    if(link)sessionStorage.setItem('meridian-terminal-entry-proof',JSON.stringify({
      trusted:event.isTrusted,prevented:event.defaultPrevented,href:link.getAttribute('href')
    }));
  },true);true`);
  await call('Page.addScriptToEvaluateOnNewDocument',{source:lifecycleSource});
  await evaluate(lifecycleSource);
  const initialDocumentId=await evaluate('window.__v11NavigationDocumentId');
  assert.ok(initialDocumentId,'initial v11 document identity was recorded');

  await key('Enter','Enter',13);
  const destination=new URL('../v10/',start).href;
  await waitForUrl(destination);
  const terminalState=await evaluate(`({
    url:location.href,title:document.title,
    build:document.querySelector('meta[name="meridian-build"]')?.content,
    root:!!document.querySelector('#app'),
    proof:JSON.parse(sessionStorage.getItem('meridian-terminal-entry-proof'))
  })`);
  assert.equal(terminalState.url,destination);assert.match(terminalState.title,/MERIDIAN v10/);
  assert.equal(terminalState.build,expectedBuild);assert.ok(terminalState.root,'actual v10 document was served');
  assert.deepEqual(terminalState.proof,{trusted:true,prevented:false,href:'../v10/'},
    'trusted Enter uses the uncancelled native anchor');
  assert.match(server.policies.get('/meridian/v10/'),/script-src 'none'/);
  assert.match(server.policies.get('/meridian/v10/'),/connect-src 'none'/);
  assert.match(server.policies.get('/meridian/v10/'),/worker-src 'none'/);
  const lifecycleAtV10=await evaluate(`JSON.parse(sessionStorage.getItem(${JSON.stringify(lifecycleKey)}))`);
  assert.ok(lifecycleAtV10.events.some(event=>
    event.type==='pagehide'&&event.documentId===initialDocumentId),
  'v11 reported leaving its original document');
  const history=await call('Page.getNavigationHistory');
  assert.equal(history.entries[history.currentIndex]?.url,destination,
    'browser Back starts from the v10 history entry');
  const previewEntry=history.entries[history.currentIndex-1];
  assert.equal(previewEntry?.url,start,'v11 is the previous browser history entry');
  await call('Page.navigateToHistoryEntry',{entryId:previewEntry.id});
  await waitForUrl(start);
  const lifecycle=await waitForPageShow(start);
  const historyAfterBack=await call('Page.getNavigationHistory');
  assert.equal(historyAfterBack.currentIndex,history.currentIndex-1,
    'browser Back moved to the immediately preceding history entry');
  assert.equal(historyAfterBack.entries[historyAfterBack.currentIndex]?.url,start,
    'browser Back returned to the v11 history entry');
  assert.equal(historyAfterBack.entries[historyAfterBack.currentIndex+1]?.url,destination,
    'browser Back returned from the v10 entry');
  assert.ok(lifecycle.events.some(event=>
    event.type==='pagehide'&&event.documentId===initialDocumentId),
  'navigation evidence includes the original v11 pagehide');
  const restoredState=await state();
  const lifecycleResult=await evaluate(`({
    documentId:window.__v11NavigationDocumentId
  })`);
  assert.equal(lifecycleResult.documentId,lifecycle.documentId);
  if(lifecycle.documentId===initialDocumentId){
    assert.equal(lifecycle.pageshow.persisted,true,
      'same-document restoration must report persisted pageshow');
    assert.deepEqual(restoredState,before,
      'BFCache restoration preserves the nondefault tab and open history');
  }else{
    assert.equal(lifecycle.pageshow.persisted,false,
      'a fresh document must report non-persisted pageshow');
    assert.deepEqual(restoredState,{
      views:['view-command'],current:['command'],historyHidden:true,historyExpanded:'false'
    },'fresh v11 documents show the documented safe defaults');
  }
  await evaluate(`document.getElementById('version-toggle').focus();true`);
  await key('Escape','Escape',27);
  assert.equal(await evaluate(`document.getElementById('version-panel').hidden&&document.activeElement.id==='version-toggle'`),true,
    'history still closes with Escape after Back');
  assert.ok(server.requests.every(request=>request.method==='GET'&&server.allowedPaths.has(request.path)),
    'only exact document/module paths and synthetic GET endpoint are served');
  return {width,terminal:terminalState,focus,before,lifecycle:lifecycleResult,pageshowPersisted:lifecycle.pageshow.persisted};
}

test('actual v11 terminal entry works in Chrome on four mobile widths and safely reaches v10',{timeout:180000},async()=>{
  if(typeof WebSocket!=='function'){
    assert.notEqual(process.env.V11_TERMINAL_CDP_CHILD,'1','WebSocket-enabled child has no WebSocket');
    const env={...process.env,V11_TERMINAL_CDP_CHILD:'1'};delete env.NODE_TEST_CONTEXT;
    const child=spawnSync(process.execPath,['--experimental-websocket',fileURLToPath(import.meta.url)],
      {encoding:'utf8',timeout:175000,env});
    assert.equal(child.status,0,'browser child failed: '+String(child.stdout).slice(-2500)+' '+String(child.stderr).slice(-1200));
    const results=String(child.stdout).split('\n').filter(line=>line.startsWith('V11_TERMINAL_WIDTH '));
    assert.equal(results.length,4,'expected actual Chrome results at all four widths');
    for(const result of results)console.log(result);
    return;
  }
  assert.ok(chrome,'Chrome binary required; browser acceptance cannot be skipped');
  const server=await deploymentServer();
  try{
    const start=server.base+'v11/';
    const expectedBuild=terminal.match(/<meta name="meridian-build" content="([^"]+)">/)?.[1];
    assert.ok(expectedBuild,'actual terminal build marker exists');
    for(const width of [320,375,390,430]){
      const result=await withMobileChrome(chrome,width,start,call=>browserRun(call,start,width,expectedBuild,server));
      console.log('V11_TERMINAL_WIDTH',JSON.stringify(result));
    }
  }finally{
    await server.close();
  }
});
