# Paper-Bot-Übersicht — technische Integration

Diese isolierte, schreibgeschützte Ansicht ist für drei getrennte Paper-Bot-
Identitäten vorgesehen: BTC/EUR Trend, BTC/USD Lives und LowVol V2. Sie ersetzt
nicht den gepaarten Vergleich: Baseline, Challenger und Cash sind Arme eines
einzelnen BTC/EUR-Laufs. Die Ansicht ist vorbereitet, aber weder in Meridian
eingehängt noch bereitgestellt. Sie greift nicht auf Konten zu und startet keine
Bots.

## Technischer Mount-Punkt

Der Host importiert `v11/spot-paper-bot-overview-controller.js` und übergibt je
Bot ausschließlich einen bereinigten Bericht und dessen expliziten Projektor:

```js
import {mountSpotPaperBotOverview} from './spot-paper-bot-overview-controller.js';

const overview = mountSpotPaperBotOverview(container, {
  adapters: [
    {id: 'btc-eur-trend', report: sanitizedTrendReport, project: projectTrendReport},
    {id: 'btc-usd-lives', report: sanitizedLivesReport, project: projectLivesReport}
  ],
  document
});

overview.update(nextAdapters);
overview.dispose();
```

Adapter-IDs sind `btc-eur-trend`, `btc-usd-lives` und `lowvol-v2`. Die Projektoren
bilden ausschließlich bereits bereinigte Quelldaten auf die unten genannten
Ansichtsfelder ab. Die Komponente errät keine Quellformate und ruft keine Daten
ab. Bei fehlenden Laufdaten bleiben die ersten beiden Bots unbekannt. LowVol V2
bleibt stets „In Vorbereitung“, bis ein eigener kanonischer Adapter für das
native USDT-M-Perpetual-Instrument und dessen Universum vorhanden ist. Bis dahin
werden auch übergebene LowVol-Berichte nicht als Laufzeitdaten angenommen. Es
gibt keinen Demo-Fallback.

## Adapter presentation fields

Projectors may return `state` (`PREPARED`, `RUNNING`, `PAUSED`, `COMPLETED`, or
`UNKNOWN`), `runtimeEvidence: 'VALIDATED'` for any runtime state, strategy and
version labels, exact market and quote currency, and the reported metrics:
`capital`, `netPnl`, `equity`, `realizedPnl`, `unrealizedPnl`, `fees`,
`slippage`, and `funding` as `{amount, currency}`. `netPnlPercent` is shown only
with `{value, basis: 'INITIAL_CAPITAL'}`. The projector also supplies
`roundTrips`, `timeInvestedMs`, `lastTradeAt`, `freshness` (`status`, `at`,
`ageMs`, `reason`), and the applicable `pauseReason` or `noTradeReason`.
Trade details are an optional bounded `trades` array of timestamp, side,
quantity, currency-tagged price and amount, and an optional reason. All strings
are inserted as text, not markup. Trade quantity is labelled with the base
asset from the validated market identity.

Für die beiden angebundenen Ansichtstypen werden nur EUR und USD akzeptiert;
Instrument und Währung müssen jeweils zusammenpassen. Ein Widerspruch wird
abgewiesen. Fehlende oder ungültige Werte bleiben „Unbekannt“. Veraltete oder
unbekannt frische Daten unterdrücken Finanz- und Handelsdetails. Die Ansicht
leitet Datenfrische nicht aus der Rechneruhr ab.

Die Lives-Risikowerte benötigen `risk.status: 'VALIDATED'`, das USD-100-Limit,
Höchststand, Eigenkapital, Rückgang, verbleibenden Betrag sowie den
Pause-Latch-Status. Die Ansicht prüft die rechnerische Übereinstimmung:
Rückgang = Höchststand − Eigenkapital und Restbetrag = max(0, Limit − Rückgang).
Bei erreichtem Limit muss die Pause aktiv und mit einer Beobachtungs-ID
begründet sein. Eine ausgelöste Pause bleibt auch nach Erholung aktiv. Bei
fehlenden oder widersprüchlichen Angaben bleiben Risikowerte unbekannt; ein
gemeldeter Überschreitungsbetrag wird nicht abgeschnitten.

Kurven werden nur mit mindestens zwei geeigneten Laufdaten verglichen. Jeder
Kurvenpunkt muss innerhalb der gemeldeten Abdeckung liegen, zeitlich strikt
ansteigen und beim Abdeckungsbeginn auf 100 normiert sein. Verglichene Kurven
benötigen dieselbe Abdeckung und dieselben Zeitpunkte. Nicht geeignete Bots
werden ausgeschlossen und benannt; unterschiedliche Horizonte werden nicht
gerankt. Es gibt keine EUR/USD-Gesamtsumme.

## Projektionsfelder und Integrationsgrenze

Laufstatus wird nur aus geprüften, übergebenen Quelldaten angezeigt. Produkttexte
übersetzen technische Fehlercodes in verständliche deutsche Hinweise; der Host
behält Quellschema, Authentifizierung und Datenerhebung.

Der vorliegende Stand ist eine mountbare UI-Vorbereitung. Es sind keine
Produktionsadapter, keine Meridian-Einbindung, kein Laufzeitverhalten und keine
Bereitstellung enthalten.

Die fokussierten Modell- und Mobiltests laufen mit:

```sh
node --test test/v11-spot-paper-bot-overview.test.js
```

The mobile test writes visibly synthetic preview screenshots to
`V11_SPOT_PAPER_BOT_OVERVIEW_EVIDENCE_DIR`, or to the default temporary
`meridian-spot-paper-bot-overview-evidence` directory.
