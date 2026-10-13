# Meridian 11 B3 — iPhone/Safari-Abnahme

**Vorbereitet, nicht durchgeführt.** Dieses Protokoll erteilt keine Veröffentlichungs-
oder Aktivierungsfreigabe. Erst nach ausdrücklich genehmigter Testbereitstellung
oder kontrollierter Veröffentlichung ausführen. Die zuständige Entwicklungsleitung
liefert die geprüfte Adresse; hier ist bewusst keine Test-URL vorgegeben.

## Bindung an den Kandidaten

- PR: #740; Head: `31a4467c721c1e7201477fd61e57325649f6abde`.
- Basis: `78c694256a2b0da8f79c02733bcd9e18568aca02`.
- Vor Beginn muss die Bereitstellung diesem Head nachweislich entsprechen.
  Die sichtbare Kennung B3 allein genügt nicht. Bei Änderungen neu abgleichen.
- Gelesene Quellen: `v11/bot-read-bootstrap.js`, `bot-read-view.js`,
  `bot-read-client.js`, `bot-read-model.js`; keine privaten Kontodaten geprüft.
- Umfang: Safari-Tab auf einem echten iPhone. Keine PWA-, Engine-Paritäts-,
  Handels-, Rendite- oder vollständige Sicherheitsabnahme.

## Durchführung

Persönlichen Meridian-Lesezugang nur im Passwortfeld der bestätigten eigenen
Seite eingeben: niemals im Chat, Screenshot oder Protokoll. Keinen Börsen-API-
Schlüssel verwenden. Fehlerantworten, Fristen und nicht unterstützte Quellen
möglichst mit freigegebenen synthetischen Daten testen; keine Schlüssel ändern.

| Nr. | Schritt | Erwartung |
|---|---|---|
| 1 | Bestätigte Seite in Safari neu öffnen, Bots-Tab wählen. | B3, leeres Zugangsfeld, „Gesperrt“, keine Botzeilen. Ohne Eingabe Aktualisieren antippen: bleibt gesperrt. |
| 2 | Lesezugang eingeben und „Lesezugang übernehmen“ antippen. | Feld wird geleert. Hinweis: Prüfung erst beim Aktualisieren. Noch keine neuen Botzeilen oder Abfrage. „Übernommen“ bedeutet noch nicht authentifiziert. |
| 3 | Einmal „Bots aktualisieren“ antippen. | „Wird geladen“, dann bei gültigem aktuellem Snapshot „Aktueller Snapshot“, UTC-Zeit und Snapshot-Anzahl. Keine abgeschnittenen Texte oder verdeckten Schaltflächen; Hoch-/Querformat prüfen. |
| 4 | Ergebnis lesen; in Testbereitstellung unbekannte Quelle/Typen prüfen. | Snapshot-Anzahl ist keine Zahl nachweislich laufender Prozesse. Unbekannter Typ/Richtung bleibt „Unbekannt“; nicht unterstützte Snapshot-Quelle ergibt „Nicht verfügbar“ ohne Botzeilen. Kein Risiko-/Gewinnversprechen. |
| 5 | „Botansicht sperren“, danach wieder Aktualisieren. | Zugang und Zeilen sind gelöscht; erneutes Aktualisieren bleibt gesperrt. Erst ausdrückliche neue Eingabe kann wieder eine Abfrage auslösen. |
| 6 | Nach erneuter Eingabe/Abfrage Safari in den Hintergrund schicken und zurückkehren; zusätzlich während einer kontrolliert verzögerten Abfrage wiederholen. | Rückkehr gesperrt, Feld und Zeilen leer; verzögerte Antwort füllt nichts nach. Kein automatisches Nachladen. Gleiches beim Wegnavigieren und Zurückkehren prüfen. |
| 7 | Aktuellen Snapshot im Vordergrund ohne weitere Eingriffe bis zur tatsächlichen Frist offen lassen. | Nach `sourceSnapshotAt + freshnessLimitMs` wechselt die Anzeige zu „Daten veraltet“, Zeilen verschwinden. Einmalige lokale Invalidierung, keine neue Abfrage. Nicht pauschal 15 Minuten annehmen: gültige Quellfrist kann kürzer sein. |
| 8 | Offlinezustand kontrolliert herstellen, danach Zugang gegebenenfalls neu eingeben und manuell aktualisieren. | „Nicht verfügbar“, keine früheren Botzeilen; kein automatischer Wiederholungsversuch. Falls der Wechsel in Einstellungen Safari ausblendet, ist zunächst „Gesperrt“ korrekt. Nach Netzwiederkehr keine automatische Abfrage; manuelles Aktualisieren erforderlich. |
| 9 | In freigegebener Testbereitstellung je eine Antwort 401 und 403 auslösen. | „Gesperrt“, Memory-Zugang gelöscht, keine Serverdetails. Wiederholtes Aktualisieren sendet ohne neue Eingabe nichts. Andere Transportfehler zeigen „Nicht verfügbar“; sie sind keine erfolgreiche Anmeldung. |
| 10 | Mit VoiceOver Sperren, Laden, Erfolg und Fehler durchlaufen. | Status verständlich angekündigt; Eingabe beschriftet, Schaltflächen erreichbar, Fokus nutzbar. Danach sperren und Seite schließen. |

„Keine Anfrage“ und „Abbruch“ lassen sich durch unveränderte Bildschirmtexte allein
nicht beweisen. Zusätzlich in einer freigegebenen Testumgebung nur Request-Anzahl,
Methode, Statuscode und Abbruchereignis protokollieren. Kein HAR, kein Header-,
Response- oder Storage-Dump. Ohne diese Messung entsprechende Netzwerkprüfung
als **NICHT GEPRÜFT** markieren. Sichtbare Safari-Bedienung bleibt ein eigener Befund.

Für Schritt 7 liefert die Testleitung ausschließlich die nicht geheimen Zeitwerte
und die gültige Frist. Ist die Frist unbekannt, keine Ablaufabnahme behaupten.
Eine kurze synthetische Frist ist zulässig; sie ersetzt keine Prüfung tatsächlicher
Safari-Hintergrundereignisse. Eine iOS-Appwechsel-Vorschau ist kein Beleg für
gelöschten DOM-Inhalt; persönliche Botansichten nicht als Nachweis weitergeben.

## Ergebnisblatt — ohne Kontoinhalte

| Feld | Eintrag |
|---|---|
| Datum/Uhrzeit und Zeitzone | offen |
| iPhone-Modell; iOS/Safari-Version | offen |
| Head-Nachweis der Bereitstellung; Freigabe-Referenz | offen |
| Ausführung | NICHT DURCHGEFÜHRT |
| Schritte 1–10, jeweils PASS / FAIL / NICHT GEPRÜFT | offen |
| Request-Zähler vorher/nachher; HTTP-Status; Abbruch ja/nein | offen |
| Synthetische oder echte Daten verwendet | offen |
| Snapshot-Zeit, gültige Frist, beobachteter Ablaufzeitpunkt | offen |
| Bedien-/Layoutbefund, ohne Werte oder Botidentitäten | offen |
| Prüfer; Entscheidung; nächster Schritt | offen |

Keine Zugangswerte, Kontosummen, Botreferenzen oder Antwortkörper erfassen.
Bei Bedarf nur einen bereits gesperrten, bereinigten Bildschirm dokumentieren.

## Entscheidung und Rücknahme

Bei unbeabsichtigter Abfrage, verbleibenden Privatdaten nach Sperren/Hintergrund,
Nachfüllen durch eine alte Antwort, falschem Frischezustand oder unbedienbarer
Sperre: **FAIL**, sofort sperren/schließen und die Ausweitung der Bereitstellung
stoppen. Entwicklungsleitung entscheidet über Rückkehr zum vorher genehmigten
Stand anhand des bestehenden Releaseverfahrens. Dieses Dokument führt keinen
Rollback, Merge oder Deploy aus. Ungeprüfte Punkte bleiben offen; ein grüner
CI-Lauf oder vorbereiteter Testplan ersetzt diese Geräteabnahme nicht.
