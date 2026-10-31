# Ein M11-Paket: Pionex Bot-Überblick und Datenklarheit

Basis: `a8c900881b0b19420e029567a8deadf0d4122b78`. Status: A (Modell), B (Oberfläche) und C (bestehende Browser-Fixtures) in einem Source-Kandidaten integriert. Fokussierte Autoren-/Integrationstests dokumentiert; vollständige Hosted-CI und unabhängige Claude-Prüfung stehen vor Freigabe aus. Keine Live-Abnahme behauptet. Die folgenden Abschnitte beschreiben den vereinbarten Umfang und die Akzeptanzkriterien.

## Ergebnis für den Nutzer

In Command und Bots sofort erkennen, wie viele TP-Abweichungen und ungeklärte Angaben im vorhandenen Snapshot liegen; mit einem Filter zu den betroffenen Bots gelangen. Gleiche Begriffe, Zähler und Quellenzeit auf beiden Oberflächen. Keine neue Datenbeschaffung und keine automatische Handelsentscheidung.

## Bereits fertig – wiederverwenden

- Symbolsuche, Richtung-/Kontraktfilter, Sortierung nach Symbol, Hebel und P/L, Trefferzahl gegenüber Snapshotzahl: `v11/bot-overview-model.js:30–67`, `v11/bot-read-view.js:485–509`.
- Exakte TP-Prüfung gegen obere Range, auch bei Short; echte Abweichung versus nicht prüfbar; Anzeige in eingeklappter Karte und Detail: `v11/bot-read-model.js:52–61`, `v11/bot-read-view.js:120–152`. Fehlende TP-Evidenz beweist keinen ungesetzten TP.
- Einzelnes/gesamtes Auf-/Zuklappen, Erhalt der Auswahl innerhalb desselben Snapshots, Command-Sprung und Rückkehr: bestehender Renderer und seine DOM-Tests.
- Drei bestätigte negative P/L-Werte in Command, keine Risikorangfolge; bestätigte Nullwerte von unbekannt getrennt; begrenzte Fehlgrundtexte und Originalwertumschalter.
- Quelle/Zeit, Teilabdeckung und getrennte Scope-Evidenz vorhanden; Ablauf/Fehler/Sperre entfernen alte Botdaten. Pionex-Bewertung bleibt unabhängig von Bot-Kapital/P/L.
- Pionex-Verlauf samt Begrenzungshinweis und sicheren Fehlerzuständen ist bereits separat umgesetzt. Dieses Paket erweitert den Verlauf nicht.

## Belegte verbleibende Nutzerlücken

| Lücke | Quellbeleg | Geplanter Nutzen |
| --- | --- | --- |
| TP-Probleme sind nur pro Karte erkennbar. Kein übergreifender TP-Zähler/-Filter/-Sortiermodus. | Overview-Zeilen enthalten nur Richtung, Kategorie, Hebel, P/L; Filterzustand hat nur query/direction/category/sort. | Eine kompakte TP-Zusammenfassung und direkte Eingrenzung statt Durchgehen aller Karten. |
| Fehlendes P/L wird individuell erklärt, aber nicht als Datenabdeckung zusammengefasst oder filterbar. | `pnlReason` in View:142–143; vorhandene Filter:502–507. | „P/L bestätigt: X von N“ und „P/L nicht verfügbar“ als präzise Auswahl; bestätigte 0 zählt als vorhanden. |
| Quelleninformationen existieren, sind zwischen Command und Bots unterschiedlich angeordnet; `expiresAt`/`ageMs` des ReadModels erreichen Overview nicht. | ReadModel:127–128, Overview-Rückgabe:67; Bots:213–218 versus Command:391–417. | Ein gemeinsamer kompakter Snapshotstatus, exakte Quelle/Zeit im Detail; vorhandenen Ablaufmechanismus nutzen. |

Grid-Gewinn und Risikopuffer bleiben unbekannt: ReadModel:80 setzt sie bewusst auf null. Dieses Paket behauptet keine neuen Messwerte. „TP fehlt“ wird ohne ausdrücklichen Quellnachweis nicht neu eingeführt. Futures Moon wird nicht aus einer Produktbezeichnung als Kontraktart geraten.

## Drei disjunkte Umsetzungsteile in einem gemeinsamen Kandidaten

**A – Reine Projektion und Vertrag, ein Modellautor.**
Pfadbesitz: `v11/bot-overview-model.js`, `test/v11-bot-overview-model.test.js`. Vorhandenes `takeProfitCheck` konsumieren, keine zweite Preisvergleichslogik. Gebundene Zustände `mismatch`, `match`, `unknown`; Snapshot-Gesamtzahlen getrennt von sichtbaren Treffern. Ergänzen: TP-Filter, P/L-Verfügbarkeitsfilter und deterministische Sortierung „TP-Prüfstatus“ (Abweichung, nicht prüfbar, übereinstimmend; Symbol/Ref als Tie-Break). Vorhandene ungefilterte Verlustliste bleibt unverändert. Validierte Quell-/Ablaufmetadaten durchreichen, keine neue Uhr/Abfrage. Vertrag zuerst knapp mit B abstimmen.

**B – Gemeinsame Nutzeroberfläche, ein UI-Autor.**
Pfadbesitz: `v11/bot-read-view.js`, `v11/index.html` (nur benötigte Layoutregeln), `test/v11-bot-read-view.test.js`. Kompakte Zähler und neue Filter in bestehende Bedienung integrieren; Command und Bots beziehen identische Aussagen aus A. Eindeutige Bezeichnungen „TP abweichend“, „TP nicht prüfbar“, „TP entspricht oberer Range“, „P/L nicht verfügbar“. Zustände sind weder Handelsfreigabe noch Risikoscore. Keine zweite Filterleiste oder zusätzliche Startabfrage. Bestehende Disclosure-/Sprung-/Rückkehrmechanik um neue Filterwerte erweitern; Quellenangaben kompakt, Detail weiter zugänglich. Ablaufanzeige nur aus vorhandener Revalidierung, kein zusätzlicher Timer.

**C – Integrierte Akzeptanz und Release, Lead mit einem Testautor.**
Testautor besitzt ausschließlich `test/v11-b11-bot-cockpit-chrome.test.js` und bei Bedarf `test/v11-bot-read-view-chrome.test.js`: bestehende synthetische Fixtures erweitern, keine neue parallele Browser-Testwelt. Lead integriert danach Cacheidentität über bestehende fünf Einstiegspunkte/Modulgraph und betroffene Harnesses, einschließlich `test/v11-module-cache-identity.test.js` und `test/v11-terminal-entry.test.js`. Historische Hashvorgaben bleiben unverändert. Kein Agent schreibt fremde Teilpfade; Konflikte und Cacheintegration bleiben beim Lead.

## Akzeptanzfälle

1. Gemischter Snapshot mit TP-Abweichung, Übereinstimmung, fehlendem TP-Nachweis und fehlender oberer Range: gleiche Zähler in Command/Bots; unbekannt wird niemals „nicht gesetzt“ oder „korrekt“.
2. Alle neuen Filter kombinieren sich mit Symbol/Richtung/Kontrakt. Snapshotzahlen bleiben konstant, sichtbare Treffer ändern sich; Filterreset setzt sämtliche Kriterien zurück. Unbekannte Filterwerte fallen auf sichere Standardwerte zurück.
3. P/L positiv, negativ, ausdrücklich bestätigt 0 und unbekannt: drei bestätigte Werte; nur unbekannt im Verfügbarkeitsfilter. Keine Summierung unterschiedlicher Gewinnbegriffe und keine Veränderung der Verlustliste.
4. Gleiche Symbole/abweichende Ref bleiben eindeutig. TP-Sortierung stabil; Auf-/Zuklappen wirkt auf sichtbare Bots; Aus-/Einfiltern erhält den Zustand innerhalb desselben Snapshots. Command-Sprung und Rückkehr erhalten die vollständige Auswahl.
5. Loading, Fehler, Sperre, Ablauf und neuer Snapshot entfernen alte Zähler, Filterrückkehr und Details nach bestehenden Regeln. Keine zusätzliche HTTP-Anfrage durch Zähler/Filter/Sortierung.
6. Bestehende Browser-Matrix 320/355/375/390/430/1440: keine horizontale Überlagerung, erreichbare Aktionen und Fokus, verständliche Screenreader-Namen. Eine Cloud-Browser-Nachprüfung durch Lead bei verfügbarem Transport; keine erfundene Live- oder iPhone-Abnahme.

## Ein Release statt Mini-Fix-Zug

Ein Integrationsbranch, ein PR, ein stabiler Kandidat. A/B führen nur passende fokussierte Tests aus; C prüft die zusammengeführte Oberfläche einmal. Danach einmal vollständige Hosted-CI und eine vollständige Claude-Prüfung auf exakt demselben Head/Base-Paar; bei konkreten Fehlern nur notwendige Deltakorrektur im selben PR. Merge, erforderliche Postchecks und optische Abnahme abschließend durch Lead. Keine neuen Agenten nur für zusätzliche Diagnose oder Wiederholung grüner Tests.

Roadmapbezug: `docs/MERIDIAN_STAGE_ROADMAP.md`, Prinzip „Complex inside – simple outside“, Stage 2 und Operating model. Die dortigen datierten Main-/Mailboxangaben sind historische Snapshots, keine aktuelle Routing- oder Ausführungsfreigabe. Keine Provider-/Trading-/Schema-/Auth-/Workflow-/Scheduler-/OKX-/Ledger-Erweiterung und keine neue Research-Autorität in diesem Paket.

## Lead execution decision
Scope approved for implementation on a8c900881b0b19420e029567a8deadf0d4122b78. Model author history_backend_fix owns A; UI author history_browser_fix owns B; browser-test author history_review owns C test files. Direct contract coordination; one integrated PR. No cache bump by authors, no independent publication. Root owns integration and final CI/Claude. 1079 all postchecks green, private live acceptance remains pending browser transport recovery. No new provider/database/trading authority.
