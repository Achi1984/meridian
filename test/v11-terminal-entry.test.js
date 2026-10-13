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
// pair below before hashing. The Depot packet reverses its exact asserted markup
// below as well. All other bytes and browser assertions stay guarded.
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
function restoreB2(source){
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

const moduleNames=['bot-read-bootstrap.js','bot-read-access.js','bot-read-client.js','bot-read-view.js','bot-read-model.js'];
function deploymentServer(){
  const inlineScript=html.match(/<script>([\s\S]*?)<\/script>/i)?.[1];
  assert.ok(inlineScript,'actual UI-only navigation script');
  const scriptHash=createHash('sha256').update(inlineScript).digest('base64');
  const policies=new Map(),requests=[],modules=new Map(),pending=new Set();
  let reads=0,aborts=0,mode='fresh';
  const endpoint='/meridian/__test/bot-snapshot';
  for(const name of moduleNames){
    let body=readFileSync(new URL('../v11/'+name,import.meta.url),'utf8');
    if(name==='bot-read-client.js'){
      const production='https://p01--achi-meridian--ttvk44grdlp7.code.run/api/private/asset-watch';
      assert.equal(body.split(production).length,2,'exact fixed endpoint replaced only in served test copy');
      body=body.replace(production,endpoint);
    }
    modules.set('/meridian/v11/'+name,body);
  }
  const server=createServer((request,response)=>{
    const url=new URL(request.url,'http://127.0.0.1'),path=url.pathname;
    requests.push({method:request.method,path}); // never record headers or token values
    const versionedModule=(path==='/meridian/v11/bot-read-bootstrap.js'||path==='/meridian/v11/bot-read-view.js')&&url.search==='?v=B6';
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
    if(modules.has(path)){
      response.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'});response.end(modules.get(path));return;
    }
    if(path!=='/meridian/v11/'&&path!=='/meridian/v10/'){response.writeHead(404);response.end();return;}
    const preview=path==='/meridian/v11/';
    const origin='http://127.0.0.1:'+server.address().port;
    const scriptSource=preview?`'sha256-${scriptHash}' `+moduleNames.map(name=>origin+'/meridian/v11/'+name).join(' '):"'none'";
    const policy=`default-src 'none'; script-src ${scriptSource}; style-src 'unsafe-inline'; connect-src ${preview?origin+endpoint:"'none'"}; worker-src 'none'; child-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; manifest-src 'none'`;
    policies.set(path,policy);
    response.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':policy});response.end(preview?html:terminal);
  });
  return new Promise((resolve,reject)=>{
    server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve({
      base:`http://127.0.0.1:${server.address().port}/meridian/`,policies,requests,
      metrics:()=>({reads,aborts,pending:pending.size}),setMode:value=>{mode=value;},
      allowedPaths:new Set(['/meridian/v11/','/meridian/v10/',endpoint,...modules.keys()]),
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
      assert.equal(await readState(),'locked');assert.equal(await evaluate(`document.querySelectorAll('#bot-read-root li').length`),0);
      await refresh();assert.equal(server.metrics().reads,initialReads+1,'locked credential cannot request');
      await accept();server.setMode('pending');const aborts=server.metrics().aborts;
      await refresh();await waitUntil(()=>server.metrics().pending===1);
      // Synthetic hidden event exercises lifecycle logic; this is not real Safari background acceptance.
      await evaluate(`Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));delete document.hidden;true`);
      await waitUntil(()=>server.metrics().aborts>aborts);
      assert.equal(await readState(),'locked');assert.equal(server.metrics().pending,0);
      const readsAfterHide=server.metrics().reads;
      await evaluate(`window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('pageshow'));true`);
      await refresh();assert.equal(server.metrics().reads,readsAfterHide,'hidden cleared credential; focus does not fetch');
      server.setMode('fresh');

    }
    if(tab==='depot'){
      const depot=await evaluate(`(()=>{
        const panel=document.getElementById('view-depot');
        return {label:panel.querySelector('.limited').textContent,
          value:panel.querySelector('.portfolio-value').getAttribute('aria-label'),
          states:[...panel.querySelectorAll('.trust-cell')].map(cell=>[cell.querySelector('strong').textContent,cell.querySelector('span').textContent]),
          viewport:document.documentElement.clientWidth,body:document.body.scrollWidth,root:document.documentElement.scrollWidth};
      })()`);
      assert.equal(depot.label,'Statische Vorschau');
      assert.equal(depot.value,'Gesamtwert unbekannt');
      assert.deepEqual(depot.states,[['Quelle','Nicht verbunden'],['Aktualität','Keine bestätigten Daten'],['Verlauf','Nicht verfügbar']]);
      assert.equal(depot.viewport,width);
      assert.ok(depot.body<=width+1&&depot.root<=width+1,'Depot panel overflow at '+width);
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
  const history=await call('Page.getNavigationHistory');
  const previewEntry=history.entries[history.currentIndex-1];
  assert.equal(previewEntry?.url,start,'v11 is the previous browser history entry');
  await call('Page.navigateToHistoryEntry',{entryId:previewEntry.id});
  await waitForUrl(start);
  assert.deepEqual(await state(),before,'browser Back restores the nondefault tab and open history');
  await evaluate(`document.getElementById('version-toggle').focus();true`);
  await key('Escape','Escape',27);
  assert.equal(await evaluate(`document.getElementById('version-panel').hidden&&document.activeElement.id==='version-toggle'`),true,
    'history still closes with Escape after Back');
  assert.ok(server.requests.every(request=>request.method==='GET'&&server.allowedPaths.has(request.path)),
    'only exact document/module paths and synthetic GET endpoint are served');
  return {width,terminal:terminalState,focus,before,backRestored:true};
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
