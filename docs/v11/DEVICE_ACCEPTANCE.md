# Meridian 11 B7 — iPhone/Safari-Abnahme

Vorbereitet, **nicht durchgeführt**. B7 erweitert die B6-Botansicht um eine getrennte manuelle Depotbewertung. Grünes Chrome-CI ersetzt keine Geräteprüfung. Erst nach bestätigter Testbereitstellung durchführen: Die Leitung liefert Adresse, genauen Commit und Freigabe. Die Kennung B7 allein genügt nicht. Umfang: Issue #762.

Persönlichen Meridian-Lesezugang nur im Passwortfeld der bestätigten eigenen Seite eingeben, niemals im Chat oder Screenshot. Keinen Börsen-API-Schlüssel verwenden. Asset-Watch-Links gelten nur für Bots; das Depot benötigt das Meridian-Lesepasswort. Beide Zugänge bleiben getrennt im Arbeitsspeicher und werden beim Ausblenden oder Verlassen gelöscht. Rohe 43-stellige Base64url-Werte werden im Depot abgewiesen, damit isolierte Bot-Freigabetokens nicht übertragen werden.

Die Depotquelle liefert gespeicherte Gesamt-, Spot- und Pionex-Bewertungen. Sie belegt keine aktuellen Einzelpositionen, Börsenfristen oder aktuelle Kontovollständigkeit. Keine Live-Kurse oder Rendite daraus ableiten. Ein leeres oder veraltetes Ergebnis bleibt ausdrücklich nicht verfügbar.

| Schritt | Erwartung |
|---|---|
| Frisch öffnen; Depot und Bots wählen | Gesperrt, leere Felder; keine automatische Abfrage. |
| Botzugang übernehmen und manuell aktualisieren | Feld sofort leer, erst Aktualisieren liest. Details und P/L-Farben wie B6; kein Nachweis laufender Botprozesse. |
| Asset-Watch-Link im Depot eingeben | Lokal abgewiesen; keine Depotabfrage oder Übertragung als Passwort. |
| Meridian-Lesepasswort im Depot übernehmen | Feld sofort leer; keine Abfrage. Der getrennte Botzugang bleibt unverändert. |
| Depot aktualisieren | Laden, dann letzte vollständige Bewertung oder ehrlicher Fehlerzustand. Gesamtwert, Spot, Pionex und beide UTC-Zeiten lesbar; Datenlücken benannt. |
| Hoch-/Querformat, große Schrift, VoiceOver | Keine abgeschnittenen Werte, Schalter erreichbar, Status verständlich angekündigt; Aktualisieren behält Fokus. |
| Depot sperren, erneut aktualisieren | Zugang und Bewertung gelöscht; ohne neue Eingabe keine Abfrage. Bot-Sperre separat prüfen. |
| Beide Ansichten laden, Safari ausblenden/zurückkehren | Beide gesperrt und leer; kein automatisches Nachladen. Auch während kontrolliert verzögerter Anfrage prüfen: alte Antwort darf nichts nachfüllen. |
| Zum Terminal navigieren und zurück | Private Daten und Zugänge bleiben gelöscht; Navigation und Versionsverlauf funktionieren. |
| Im Vordergrund bis Ablauf beobachten | Depotwert verschwindet nach min(Bewertungszeit, Pionex-Quellzeit) + 15 Minuten. Keine neue Abfrage. Botfrist bleibt die geprüfte eigene Quellfrist. |
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
