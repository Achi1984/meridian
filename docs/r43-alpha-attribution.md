# R43 Alpha Attribution Lab

R43 trennt die Suche nach Alpha von der Ausführung. Jeder reguläre Scan erzeugt höchstens alle vier Stunden eine Beobachtung je Symbol – unabhängig davon, ob der bestehende Score einen Trade freigibt. Dadurch werden auch abgelehnte Signale erfasst und der bisherige Selektionsbias reduziert.

## Forward Labels

- Horizonte: 4 Stunden, 12 Stunden, 24 Stunden, 3 Tage und 7 Tage
- Ergebnis: richtungsbereinigte Kursbewegung abzüglich modellierter Roundtrip-Kosten
- Features: Score, Confidence, RSI, ADX, Volumen, MACD sowie EMA-Abstände auf 15m, 1h und 4h
- Speicherung: maximal 12.000 Beobachtungen im getrennten Research-State `alpha_lab_r43`

Eine Beobachtung wird erst beschriftet, wenn ein späterer Scan den jeweiligen Forward-Horizont erreicht. Ein Kurs darf nur innerhalb eines begrenzten Fensters um den Zielhorizont als Label dienen. Wird der 4h-Termin beispielsweise wegen eines Ausfalls erst nach 24 Stunden wieder gesehen, wird der 4h-Ausgang als `LABEL_WINDOW_MISSED` markiert und nicht mit dem 24h-Kurs erfunden. Funding und andere haltedauerabhängige Kosten sind noch nicht Bestandteil dieser Richtungslabels.

## Entscheidungsschutz

- Kein Einfluss auf Orders, Positionsgrößen oder bestehende Bots
- Keine automatische Promotion
- Der alte aggregierte Score gilt als verworfen
- Faktor-Hypothesen werden frühestens nach 100 gültigen 24h-Labels, 25 unterschiedlichen 4h-Zeitfenstern und drei Symbolen gezeigt
- Hypothesen beruhen auf Rangkorrelation, Quartilen und Monotonie; sie sind weder ein Produktionssignal noch ein Profitabilitätsnachweis
- Die Richtung stammt weiterhin vom bestehenden Scanner; ausgewertet werden dessen periodische Ausgaben, nicht alle theoretisch möglichen Long- und Short-Richtungen

Überlappende Horizonte und mehrere Symbole erzeugen keine statistisch unabhängigen Stichproben. Vor einer späteren Strategieänderung sind deshalb Walk-forward-Auswertung, Kosten-Stresstest und ein vollständig prospektiver Paper-Lauf erforderlich.

## Vergangenheit und Forward-Test

Historische Daten werden bewusst genutzt, aber nicht mit dem prospektiven R43-State vermischt:

- Trend Pullback wurde über 90 Tage und fünf frische Kalenderfenster verworfen.
- Relative Momentum wurde über 167 Tage walk-forward getestet und mit PF 0,14 verworfen.
- Residual Pairs lieferte in 28 festgelegten Paaren keinen robusten Einstieg.
- Der vorhandene gemeinsame Snapshot enthält für diese Tests 4h-Schlusskurse und Funding, aber keine vollständigen historischen 15m-/1h-/4h-OHLCV-Scannerzustände.

Für einen exakten historischen R43-Replay müssen daher die Rohkerzen chronologisch neu eingelesen und sämtliche Indikatoren ausschließlich aus den jeweils damals bekannten Kerzen rekonstruiert werden. Dieser Rücktest dient zur Hypothesenauswahl. Die unabhängige Bestätigung bleibt der unveränderte Forward-Lauf; historische Treffer werden nicht auf dessen 100-Label-Schwelle angerechnet.

`replayHistoricalAlphaScans` erzwingt dafür chronologische, als `closedCandles` bestätigte Eingaben und erzeugt einen separaten `HISTORICAL_REPLAY`-State. Der produktive Forward-State `alpha_lab_r43` wird dadurch weder gelesen noch verändert.

## R44-Auswertungsuhr

Die PAPER-Ansicht zeigt die nächste erwartete 24h-Beschriftung und eine Schätzung bis zur ersten deskriptiven Faktorprüfung. Diese Schätzung basiert auf der zuletzt beobachteten Symbolzahl und ist keine Zusage, wann ein profitables Signal entsteht. Ist der Scanner-State älter als 15 Minuten, werden beide Termine durch `DATEN FEHLEN` ersetzt.

Abgeschlossene bzw. versiegelte Bots werden aus der Standardansicht ausgeblendet. Ihre PostgreSQL-Ledger und Ausführungsschutzschalter bleiben unverändert erhalten. Eine noch offene Position bleibt unabhängig vom Bot-Lebenszyklus sichtbar.
