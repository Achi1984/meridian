# Meridian 11 B8 — iPhone/Safari-Abnahme

Vorbereitet, **nicht durchgeführt**. B8 trennt die serverseitige Depotbewertung von der gespeicherten Historie und ergänzt einen Verlauf mit 1h / 1 Tag / 1 Woche. Grünes Chrome-CI ersetzt keine Geräteprüfung. Erst nach bestätigter Testbereitstellung durchführen: Die Leitung liefert Adresse, genauen Commit und Freigabe. Die Kennung B8 allein genügt nicht. Umfang: Issue #764.

Persönlichen Meridian-Lesezugang nur im Passwortfeld der bestätigten eigenen Seite eingeben, niemals im Chat oder Screenshot. Keinen Börsen-API-Schlüssel verwenden. Asset-Watch-Links gelten nur für Bots; das Depot benötigt das Meridian-Lesepasswort. Beide Zugänge bleiben getrennt im Arbeitsspeicher und werden beim Ausblenden oder Verlassen gelöscht. Rohe 43-stellige Base64url-Werte werden im Depot abgewiesen, damit isolierte Bot-Freigabetokens nicht übertragen werden.

Der Depotwert verwendet serverseitige Referenzen und öffentliche Kurse; lokale Referenzen aus V10 werden nicht übernommen. Wenn die aktuelle Quelle unvollständig ist, kann eine noch frische gespeicherte Bewertung ausdrücklich als solche erscheinen. Der Verlauf enthält nur echte gespeicherte Gesamtbewertungen; Ein- und Auszahlungen sind nicht bereinigt. Sie belegt keine aktuellen Einzelpositionen, Börsenfristen oder aktuelle Kontovollständigkeit. Keine Live-Kurse oder Rendite daraus ableiten. Ein leeres oder veraltetes Ergebnis bleibt ausdrücklich nicht verfügbar.

| Schritt | Erwartung |
|---|---|
| Frisch öffnen; Depot und Bots wählen | Gesperrt, leere Felder; keine automatische Abfrage. |
| Botzugang übernehmen und manuell aktualisieren | Feld sofort leer, erst Aktualisieren liest. Details und P/L-Farben wie B6; kein Nachweis laufender Botprozesse. |
| Asset-Watch-Link im Depot eingeben | Lokal abgewiesen; keine Depotabfrage oder Übertragung als Passwort. |
| Meridian-Lesepasswort im Depot übernehmen | Feld sofort leer; keine Abfrage. Der getrennte Botzugang bleibt unverändert. |
| Depot aktualisieren | Drei begrenzte GET-Abfragen: Dashboard und Historie mit Lesezugang, öffentliche Gesamtkursliste ohne Zugang. Keine Abfrage beim Öffnen. Aktueller Depotwert bleibt bei fehlender Historie verfügbar; alternativ ausdrücklich gespeicherte Bewertung oder ehrlicher Fehlerzustand. Gesamtwert, Spot, Pionex und beide UTC-Zeiten lesbar; Datenlücken benannt. |
| 1h / 1 Tag / 1 Woche wählen | Kein neuer Abruf. Nur gespeicherte Punkte, Lücken bleiben offen; kein erfundener Anschluss an den aktuellen Depotwert. |
| Leere Historie / einzelne Messung | Verständliche Leermeldung bzw. einzelner Punkt; keine erfundene Kurve oder Rendite. |
| Hoch-/Querformat, große Schrift, VoiceOver | Keine abgeschnittenen Werte, Schalter erreichbar, Status verständlich angekündigt; Aktualisieren behält Fokus. |
| Depot sperren, erneut aktualisieren | Zugang und Bewertung gelöscht; ohne neue Eingabe keine Abfrage. Bot-Sperre separat prüfen. |
| Beide Ansichten laden, Safari ausblenden/zurückkehren | Beide gesperrt und leer; kein automatisches Nachladen. Auch während kontrolliert verzögerter Anfrage prüfen: alte Antwort darf nichts nachfüllen. |
| Zum Terminal navigieren und zurück | Private Daten und Zugänge bleiben gelöscht; Navigation und Versionsverlauf funktionieren. |
| Im Vordergrund bis Ablauf beobachten | Aktueller Wert verfällt spätestens mit der ältesten Quellenfrist: Spot-Referenzen24h, Pionex15min, verwendete Kursabfrage3min. Noch frische gespeicherte Bewertung wird ggf. als solche angezeigt. Historische Punkte sind ausdrücklich historisch und verschwinden beim Sperren/Appwechsel. Keine neue Abfrage. Botfrist bleibt die geprüfte eigene Quellfrist. |
| Offline und kontrollierte Fehlerantwort | Keine alten Werte. 401/403 löscht jeweiligen Zugang; keine weitere Abfrage ohne neue Eingabe, keine Serverdetails. |

Fehlerfälle und verkürzte Fristen mit freigegebenen synthetischen Antworten testen; keine Schlüssel ändern. Bildschirmtexte beweisen keine fehlenden Netzwerkzugriffe. In der genehmigten Testumgebung nur Anzahl, Methode, Statuscode und Abbruch erfassen; keine Header, Antwortkörper oder HAR-Dateien. Nicht messbare Punkte bleiben **NICHT GEPRÜFT**. Synthetische Sichtbarkeitsereignisse ersetzen keinen echten Safari-Appwechsel.

| Ergebnisfeld | Eintrag |
|---|---|
| Ausführung | NICHT DURCHGEFÜHRT |
| Datum/Zeitzone; iPhone, iOS/Safari | offen |
| Bestätigter Commit und Testfreigabe | offen |
| Schritte jeweils PASS / FAIL / NICHT GEPRÜFT | offen |
| Synthetische oder echte Quelle, ohne Kontoinhalte | offen |
| Netzwerkzählung und Abbrüche, soweit messbar | offen |
| Bedienbarkeit, VoiceOver, tatsächlicher Appwechsel | offen |
| Entscheidung und nächster Schritt | offen |

Bei ungewollter Abfrage, nachgefüllten/verbleibenden Privatdaten, falschem Frischezustand oder unbedienbarer Sperre: FAIL, sperren/schließen und Ausweitung stoppen. Die Leitung entscheidet über Korrektur oder Rücknahme. Dieses Protokoll aktiviert keine Engine, PWA, Handel oder Hintergrundautomation.

## B9 — Command valuation and history axis

B8 owner screenshots (2026-10-13 23:00 Vienna) show stored valuation and nine history points on iPhone. This verifies visible stored data and chart, not the current-source path, all range interactions or lock behavior.

B9 device acceptance NOT PERFORMED. Check Command after manual Depot refresh: same value and current/stored source label; no extra request on tab navigation. Lock, replace access, hide or leave: Command value clears together with Depot. Expired values clear or switch only to a still-valid stored valuation with corresponding label. History axis retains the selected query window, indicates local time and separately names actual first/last measurements. Sparse data is not stretched or extrapolated. Check 320/375/390/430 widths and actual iPhone.
