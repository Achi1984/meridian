# Vorbereitung des Meridian-Livetests, 27. November 2026

## Testumfang

| Kandidat | Beobachtung | Ergebnisauswertung |
|---|---|---|
| Top 100 | Lauf 46069348362, drei Modelle mit je 1.000 virtuellen USDT auf identischen Kontrakten | Alle drei Konten zum selben Stichtag vergleichen. Offene Positionen, realisiertes und offenes Ergebnis, Gebühren und Funding getrennt ausweisen. Bei fehlender Bewertung bleibt das Ergebnis offen. |
| Solana | Haltertest 45900543591, Versuch 2. Folgelauf 46023156198 steht in der Warteschlange. | Basisstrategie und Halterfilter getrennt auswerten. Anzahl gemeinsamer, übersprungener und unbewerteter Trades sowie Ergebnis ohne besten Coin festhalten. Die Variante B aus dem A–F-Vergleich dient als historische Ausstiegsreferenz. |

Die bisherigen Varianten C und F des A–F-Vergleichs erhalten in diesem Test kein eigenes Konto. Das Kennzeichen C im Haltertest gehört zur Basisstrategie dieses separaten Experiments.

## Technische Probe mit öffentlichen Kursen

Vom Repository-Stamm aus `python3 scripts/research/quote_rehearsal.py` starten. Das Skript holt Kontraktdaten und das öffentliche Orderbuch. Es simuliert beide Seiten im selben Snapshot. Das Ausgabe-Feld `ordersSent` ist immer 0. Die 100 USDT sind ein simulierter Nominalwert. Das Skript bricht bei veraltetem Buch, zu geringer Tiefe oder unterschrittener Mindestgröße ab.

Beobachtete BTC-Probe am 27. November: 0,16 Kontrakte, 95,63776 USDT Nominalwert, Buchalter 126 ms. Modellgebühren für beide Seiten 0,095637680 USDT, Spreadkosten 0,00016 USDT. Die Gebühr ist eine Modellannahme. Marktbewegung zwischen zwei Aufträgen, zusätzliche Slippage und Funding sind in dieser Momentaufnahme offen.

## Ablauf für eine erste Ausführungsprobe

1. Vor dem Test Konto, Handelsplatz, Instrument, maximale Positionsgröße, maximalen Gesamtverlust, maximale Laufzeit und Umgang mit einer offenen Position beim Abbruch festlegen. Die Beträge der virtuellen Konten gehören ausschließlich zum Papervergleich.
2. In einer Demo-Umgebung die Signalkette mit persistenter Auftragskennung, Teilfüllung, Ablehnung und Verbindungsabbruch durchspielen. Nach einem Timeout die bekannte Kennung beim Handelsplatz abgleichen, bevor ein Folgeauftrag zulässig ist. Offene Aufträge und Positionen nach Neustart mit dem Testkonto abgleichen.
3. Für Solana Ein- und Ausstiegsquote für die tatsächliche Tokenmenge samt Gebühren und Preiswirkung prüfen. Bei fehlendem Rückweg keinen Einstieg freigeben. Ablauf des Blockhash, fehlende Bestätigung und erneuter Start müssen ohne doppelte Signaturübermittlung mit neuer Transaktion behandelt werden.
4. Bei Stoppsignal neue Einstiege sperren, offene Aufträge und Positionen erfassen und gemäß vereinbartem Abbruchverfahren behandeln. Nach dem Test Endsaldo, Gebühren, offene Positionen und Auftragsstatus unabhängig vom Strategieprozess prüfen.

Der Bericht der öffentlichen Kursprobe belegt den Marktlesepfad. Nachweise für Demo-Fills, Wiederanlauf, Abbruch mit offener Position und Kontoabgleich stehen aus. Handelszugang und Echtgeldeinsatz sind offen.
