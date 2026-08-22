# ACHI MERIDIAN v5.2.0 — ALERT CENTER

Neu:
- lokales Alert Center mit Status-Historie
- Statuskette WAIT → WATCH → ARM → START ZONE → TP HIT → NEW RANGE
- SOL / ETH / PEPE Scanner-Status wird auf Änderungen überwacht
- XRP / HBAR TP-Hit wird erkannt, sobald Livekurs den hinterlegten TP erreicht
- kritischer Liquidationspuffer wird als Risikoereignis markiert
- Statuswechsel werden lokal gespeichert; kein Kurs-Spam
- externer ChatGPT-Watch bleibt für Push-Benachrichtigungen zuständig
- Pionex Live Sync bleibt ausdrücklich deaktiviert; Pionex-Daten = SNAPSHOT

Hinweis:
Die lokale Alert-Historie läuft, wenn MERIDIAN geöffnet ist. Echte Pushs bei geschlossener App kommen weiterhin über den eingerichteten ChatGPT-Watch.
