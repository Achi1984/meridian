// Source preparation snapshot, not runtime telemetry or an admission evaluator.
// Update only with reviewed source evidence; no inputs can authorize a run.
const CONTRACT='docs/strategy-lab/FORWARD_PAPER_V1_CONTRACT_SPEC.md';
const HARNESS='docs/strategy-lab/SYNTHETIC_PAPER_HARNESS_RECEIPT.md';
function freeze(value){
  if(value&&typeof value==='object'){
    for(const item of Object.values(value))freeze(item);
    Object.freeze(value);
  }
  return value;
}
const choices=[
  ['strategy','Strategie und Version',['strategyIdentity'],'Eine qualifizierte Strategie mit unveränderlicher Version und Code-Identität auswählen.'],
  ['source','Datenquelle',['sourceIdentity'],'Quelle, Adapterversion und belegte Eigenschaften der Ereignisse festlegen.'],
  ['universe','Instrumente',['universe'],'Geordnete Instrumentliste und Regeln für Änderungen festlegen.'],
  ['product','Produkt und Abrechnung',['product'],'Produkttyp, Handelsplatz, Abrechnung und gegebenenfalls Margin bestimmen.'],
  ['capital','Simuliertes Kapital und Währung',['initialCapital','accountCurrency'],'Startbetrag und Kontowährung ausdrücklich wählen; keine automatische Währungsumrechnung.'],
  ['period','Beobachtungszeitraum',['observationPeriod'],'Start, Ende, Dauer und erforderliche Beobachtungen vorab bestimmen.'],
  ['costs','Gebühren, Slippage und Liquidität',['feePolicy','slippagePolicy','liquidityPolicy'],'Kosten und Ausführungspreismodell mit Einheiten belegen; Slippage nicht doppelt buchen.'],
  ['risk','Risiko und Verlustgrenzen',['riskPolicy','stopPolicy','exposureLimit','lossLimit'],'Stops, Positionsgrenzen, maximalen Verlust und Verhalten bei Überschreitung festlegen.'],
  ['timing','Entscheidung, Ausführung und Bewertung',['decisionTiming','fillEligibility','expiryPolicy','markPolicy'],'Zulässige Ereignisreihenfolge, Ablaufgrenzen und Bewertungskurse bestimmen.'],
  ['freshness','Aktualität und Datenlücken',['freshnessPolicy','gapPolicy','synchronizationPolicy'],'Zeitgrenzen, Umgang mit Lücken und gemeinsame Zeitpunkte aller Instrumente festlegen.'],
  ['bounds','Rechen- und Mengengrenzen',['computeBounds'],'Maximale Eingabegrößen, Ereignisse, Arbeitsschritte und Laufzeit explizit begrenzen.'],
  ['reconciliation','Klärung ungewisser Ergebnisse',['reconciliationAuthority'],'Zuständige Instanz und zulässige Belege für eine dauerhafte Klärung festlegen.'],
].map(([id,label,fields,detail])=>({id,label,fields,status:'REQUIRED_UNSET',detail}));
const snapshot=freeze({
  schemaVersion:'MERIDIAN_PAPER_READINESS/1',
  scope:'SOURCE_PREPARATION_ONLY',
  status:'NOT_READY',
  paperAuthorized:false,
  liveAuthorized:false,
  canStart:false,
  summary:'Die technische Vorbereitung ist teilweise umgesetzt. Ein laufender Paperbetrieb ist nicht eingerichtet oder freigegeben.',
  evidenceNote:'Stand der geprüften Quellen, keine laufende Systemprüfung. Synthetische Tests belegen keine Strategiequalität oder Betriebsbereitschaft.',
  prepared:[
    {id:'contracts',label:'Ereignis- und Buchungsregeln beschrieben',detail:'Verträge beschreiben Vorschlag, Bestätigung, Reihenfolge, Gebühren und ungewisse Ergebnisse. Die Beschreibung ist keine operative Implementierung.',evidencePath:CONTRACT},
    {id:'accounting',label:'Isoliertes Buchungsmodell getestet',detail:'Das vorhandene Testmodell prüft exakte Ganzzahlarithmetik, einmalige Gebühren, doppelte Ereignisse und konkurrierende Schreibversuche ausschließlich mit künstlichen Daten.',evidencePath:HARNESS},
    {id:'unknown',label:'Ungewisse Ergebnisse bleiben gesperrt',detail:'Im Testmodell blockieren verlorene Bestätigungen und ungewisse Buchungen weitere Änderungen. Eine Belegsuche löst die Sperre nicht automatisch.',evidencePath:HARNESS},
  ],
  choices,
  gates:[
    {id:'qualification',label:'D2 ohne Edge; Qualifikation offen',status:'UNVERIFIED',detail:'Quellenstand 31.10.2026: Der einzelne abgeschlossene D2-Versuch ist als NO_EDGE bewertet. Die unabhängige Abnahme des vollständigen privaten Ergebnisses bleibt offen. Das ist keine Bewertung aller zwölf Hypothesen. Historische Arena-Ergebnisse und synthetische Buchungstests ersetzen keine Strategiequalifikation.',evidencePath:CONTRACT,assessment:{sourceCheckedOn:'2026-10-31',sourcePath:'MERIDIAN_LIVE_CHECKPOINT.json',sourceKey:'currentWork.d2NoEdge935',issue:935,snapshotCommentId:6448721244,assessmentCommentId:6449045864,completedTrialCount:1,screenResult:'NO_EDGE',fullPrivateResultIndependentAcceptance:'PENDING'}},
    {id:'source-time',label:'Quelle und Ereignisreihenfolge belegen',status:'UNVERIFIED',detail:'Datenverfügbarkeit, Identität und eine belastbare Zeitzuordnung oder Quellensperre müssen nachweisen, dass ein Ausführungsereignis erst nach der bestätigten Entscheidung entstanden ist.',evidencePath:CONTRACT},
    {id:'journal',label:'Dauerhaftes Journal noch nicht nachgewiesen',status:'UNVERIFIED',detail:'Das Testjournal liegt nur im Arbeitsspeicher. Dauerhafte Buchungen, Neustart und Absturzverhalten benötigen ein getrennt geprüftes Speicherpaket.',evidencePath:'docs/strategy-lab/SYNTHETIC_PAPER_INFRASTRUCTURE_V1.md'},
    {id:'reconciliation-contract',label:'Vertrag zur Klärung noch offen',status:'UNSPECIFIED',detail:'Version 1 definiert keinen Beleg für die Auflösung ungewisser Ergebnisse. Vor einer Implementierung ist eine eigene Vertragsänderung erforderlich.',evidencePath:CONTRACT},
    {id:'admission',label:'Betriebsfreigabe ausstehend',status:'NOT_AUTHORIZED',detail:'Erst nach geprüfter Technik und festgelegten Betriebsparametern kann ein begrenzter Paperlauf gesondert freigegeben werden.',evidencePath:CONTRACT},
  ],
  nextStep:'Als Nächstes den Vertrag zur Klärung ungewisser Buchungen konkretisieren und prüfen; anschließend ein begrenztes Journalpaket mit künstlichen Daten und Absturztests vorbereiten. Das startet keinen Paperlauf.',
  proposalPath:'docs/strategy-lab/PAPER_READINESS_NEXT_PACKET.md',
});

export function getPaperReadiness(){return snapshot;}
