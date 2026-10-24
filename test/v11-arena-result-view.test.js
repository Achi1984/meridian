import test from 'node:test';
import assert from 'node:assert/strict';
import {renderArenaResultView, ARENA_RESULT_DISCLOSURE_KEYS} from '../v11/arena-result-view.js';

// Constructed presentation projections, not engine runs or authenticated evidence.
// The importer is the validation boundary; these fixtures exercise its output shape.
function projectedResult({state='completed', insufficient=false, unresolved=false, screenStatus=null}={}) {
  const variants = ['primary-n30-f25','full-basket-weekly','frozen-mean-exposure',
    'frozen-risk-exposure','cash-zero','neighbour-n20-f25','neighbour-n45-f25',
    'neighbour-n30-f20','neighbour-n30-f35'];
  const scenarios = ['base-15bp','stress-30bp','stress-30bp-delay-1d'];
  const paths = variants.flatMap((variantId,index)=>
    (variantId==='cash-zero'?['scenario-independent']:scenarios).map(scenarioId=>({
      variantId,scenarioId,segmentId:'diagnostic',status:'COMPLETED',
      netReturn:index===4?0:0.123456789,sampledDrawdown:index===4?0:0.031415926
    })));
  const hasResult = state==='completed'||state==='failed';
  const result = !hasResult ? null : {
    status:insufficient?'INSUFFICIENT_EVIDENCE':'COMPLETED',
    plannedPaths:44,computedPaths:insufficient?19:44,completedPaths:insufficient?19:44,
    paths:insufficient?[]:paths,
    controlDefinitions:{status:'COMPLETED',meanExposure:0,riskExposure:0,
      primaryDevelopmentSd:0,fullBasketDevelopmentSd:0,calibration:false},
    screen:insufficient?{status:'INSUFFICIENT_EVIDENCE'}:{
      status:screenStatus||'SYNTHETIC_ONLY_NOT_ASSESSED',interpretation:'SYNTHETIC_FIXTURE_RULE_CHECKS_ONLY',
      comparisonSegment:'diagnostic',checks:{primaryDiagnosticNetPositive:false},
      relativeDrawdownReduction:0,neighbourPositiveCounts:{base15bp:0,stress30bp:0},
      stopPolicy:'NO_FINITE_TRADE_STOP',tradeCRV:{status:'UNDEFINED_NO_FINITE_STOP',value:null}
    },
    identity:{inputSha256:'b'.repeat(64)},
    authority:{executionAuthorized:false,paperAuthorized:false,liveAuthorized:false},
    evidence:{sourceAuthenticity:'NOT_ESTABLISHED',historyLabel:'SYNTHETIC_ONLY',
      holdoutClaim:false,costModel:'ASSUMED',executionEvidence:false}
  };
  return {status:'PRESENT_UNVERIFIED',provenance:{syntheticFixture:true,
    assertionStatus:'UNVERIFIED',source:'CALLER_SUPPLIED_INSPECT_B1',sourceAuthenticity:'NOT_ESTABLISHED'},
    job:{state,attempts:state==='queued'?0:1,fence:state==='queued'?0:1,unresolved,
      trialId:'a'.repeat(64),trialKey:'display-fixture',profile:'SYNTHETIC_DISPLAY',
      protocolSha256:'c'.repeat(64),sourceSha256:'d'.repeat(64),dataSha256:'b'.repeat(64),
      manifestSha256:'e'.repeat(64),resultSha256:result?'f'.repeat(64):null,
      summarySha256:result?'0'.repeat(64):null,
      pathIds:['descriptor-b','descriptor-a'],computationPathIds:['descriptor-a','descriptor-b'],
      paths:[],controls:'{"exact":1e-7}',controlBindings:{},timestamps:{
        createdAt:'2026-01-01T00:00:00Z',
        startedAt:state==='queued'?null:'2026-01-01T00:00:01Z',
        finishedAt:result?'2026-01-01T00:00:02Z':null
      },
      owner:null,reason:null,result:result?' {"raw":1.2300,"text":"<source>"} ':null,
      executionAuthorized:false,promotionAuthorized:false,profitabilityInferred:false},result};
}

test('absent, invalid and loading replace stale metrics and raw data',()=>{
  const old=projectedResult();
  const loading=renderArenaResultView({projection:old,busy:true});
  const invalid=renderArenaResultView({projection:{...old,status:'INVALID'}});
  const absent=renderArenaResultView({projection:{...old,status:'UNKNOWN'}});
  for(const html of [loading,invalid,absent]) {
    assert.doesNotMatch(html,/0\.123456789|display-fixture|raw|SYNTHETIC_ONLY_NOT_ASSESSED/);
    assert.match(html,/keine Neuberechnung/);
  }
  assert.match(loading,/aria-busy="true"/);
  assert.match(invalid,/role="alert"/);
  assert.match(absent,/Kein Producer-Ergebnis importiert/);
});

test('completed projection keeps exact values, zero, false and missing distinct',()=>{
  const html=renderArenaResultView({projection:projectedResult()});
  assert.match(html,/<dt>Nettoertrag<\/dt><dd>0\.123456789<\/dd>/);
  assert.match(html,/<th scope="row">Cash<\/th><td>COMPLETED<\/td><td>0<\/td><td>0<\/td>/);
  assert.match(html,/<dt>Primärer Diagnose-Nettoertrag positiv<\/dt><dd>false<\/dd>/);
  assert.match(html,/<dt>Primärer Diagnose-Drawdown höchstens 25 %<\/dt><dd>Nicht verfügbar<\/dd>/);
  assert.match(html,/<dt>Trade-CRV-Wert<\/dt><dd>Nicht verfügbar<\/dd>/);
  assert.match(html,/<dt>Input SHA-256 · Job<\/dt><dd>b{64}<\/dd>/);
  assert.match(html,/<dt>Input SHA-256 · Ergebnis<\/dt><dd>b{64}<\/dd>/);
  assert.match(html,/SYNTHETIC_ONLY · UNVERIFIED/);
  assert.match(html,/CALLER_SUPPLIED_INSPECT_B1/);
});

test('identity preserves missing and conflicting supplied values without reconciliation',()=>{
  const projection=projectedResult();
  projection.job.dataSha256='job-input-digest';
  projection.result.identity.inputSha256='result-input-digest';
  projection.job.protocolSha256='job-protocol-digest';
  projection.result.protocolSha256='result-protocol-digest';
  projection.job.sourceSha256=null;
  projection.job.summarySha256=undefined;
  const html=renderArenaResultView({projection});
  assert.match(html,/<dt>Input SHA-256 · Job<\/dt><dd>job-input-digest<\/dd>/);
  assert.match(html,/<dt>Input SHA-256 · Ergebnis<\/dt><dd>result-input-digest<\/dd>/);
  assert.match(html,/<dt>Quelle SHA-256<\/dt><dd>Nicht verfügbar<\/dd>/);
  assert.match(html,/<dt>Summary SHA-256<\/dt><dd>Nicht verfügbar<\/dd>/);
  assert.match(html,/job-protocol-digest/);
  assert.match(html,/result-protocol-digest/);
  assert.match(html,/Nächster Schritt für fehlende Angaben:/);
  assert.match(html,/Quelle SHA-256/);
});

test('missing timestamps stay explicit and suggest checking the supplied evidence',()=>{
  const projection=projectedResult();
  projection.job.timestamps={createdAt:null,startedAt:undefined};
  const html=renderArenaResultView({projection});
  assert.match(html,/<dt>Zeitstempel · createdAt<\/dt><dd>Nicht verfügbar<\/dd>/);
  assert.match(html,/<dt>Zeitstempel · startedAt<\/dt><dd>Nicht verfügbar<\/dd>/);
  assert.match(html,/<dt>Zeitstempel · finishedAt<\/dt><dd>Nicht verfügbar<\/dd>/);
  assert.match(html,/Zeitstempel createdAt, Zeitstempel startedAt, Zeitstempel finishedAt im bereitgestellten Producer-Beleg prüfen/);
});

test('lifecycle, result and screen remain separately labelled',()=>{
  const html=renderArenaResultView({projection:projectedResult({state:'failed',insufficient:true})});
  assert.match(html,/Lifecycle failed/);
  assert.match(html,/<dt>Engine-Ergebnis<\/dt><dd>INSUFFICIENT_EVIDENCE/);
  assert.match(html,/<dt>Screen<\/dt><dd>INSUFFICIENT_EVIDENCE/);
  assert.match(html,/<dt>Ergebnisse abgeschlossen<\/dt><dd>19/);
  assert.match(html,/<dt>Pfade geplant<\/dt><dd>44/);
  assert.match(html,/<dt>Nettoertrag<\/dt><dd>Nicht verfügbar/);
  assert.doesNotMatch(html,/0\.123456789/);
});

test('44 completed paths and insufficient evidence remain independent dimensions',()=>{
  const html=renderArenaResultView({projection:projectedResult({screenStatus:'INSUFFICIENT_EVIDENCE'})});
  assert.match(html,/<dt>Engine-Ergebnis<\/dt><dd>COMPLETED<\/dd>/);
  assert.match(html,/<dt>Screen<\/dt><dd>INSUFFICIENT_EVIDENCE<\/dd>/);
  assert.match(html,/<dt>Technische Vollständigkeit<\/dt><dd>COMPLETED · abgeschlossen 44 \/ geplant 44<\/dd>/);
  assert.match(html,/Abgeschlossene Pfade sind kein Nachweis ausreichender Evidenz/);
  assert.doesNotMatch(html,/Optimierung erfolgreich|Gewinner|Freigabe erteilt/);
});

test('caller-supplied authority assertions never grant authorization',()=>{
  const projection=projectedResult();
  projection.job.executionAuthorized=true;
  projection.job.promotionAuthorized=true;
  projection.job.profitabilityInferred=true;
  projection.result.authority={executionAuthorized:true,liveAuthorized:true};
  const html=renderArenaResultView({projection});
  assert.match(html,/data-arena-result-state="present"/);
  assert.match(html,/<dt>Autorisierung · Caller-Assertions<\/dt><dd>Execution true · Promotion true · Profitabilität true<\/dd>/);
  assert.match(html,/executionAuthorized · Caller-Assertion/);
  assert.match(html,/&quot;liveAuthorized&quot;:true/);
  assert.match(html,/Producer- oder Caller-Assertions erteilen keine Autorität/);
  assert.doesNotMatch(html,/authoriz(?:ed|ation).*granted|execution granted|live enabled/i);
});

test('queued and unresolved have useful next steps without invented results',()=>{
  const queued=renderArenaResultView({projection:projectedResult({state:'queued'})});
  const running=renderArenaResultView({projection:projectedResult({state:'running',unresolved:true})});
  assert.match(queued,/Wartend · Lifecycle queued/);
  assert.match(queued,/<dt>Versuch<\/dt><dd>0/);
  assert.match(queued,/kein Lauf wird gestartet/);
  assert.match(running,/data-arena-result-state="unresolved"/);
  assert.match(running,/ausdrücklich abstimmen/);
  assert.match(running,/<dt>Fence<\/dt><dd>1/);
  for(const html of [queued,running])assert.doesNotMatch(html,/Primärpfad · Diagnose|data-arena-result-section="controls"/);
});

test('rejected, timed-out and partial unresolved observations do not imply completion',()=>{
  for(const state of ['rejected','timed_out','claimed']) {
    const projection=projectedResult({state,unresolved:state==='claimed'});
    projection.job.paths=[{pathId:'partial-observation',state:'completed'}];
    const html=renderArenaResultView({projection});
    assert.match(html,new RegExp(`Lifecycle ${state}`));
    assert.match(html,/<dt>Engine-Ergebnis<\/dt><dd>Nicht verfügbar/);
    assert.match(html,/<dt>Ergebnisse abgeschlossen<\/dt><dd>Nicht verfügbar/);
    assert.doesNotMatch(html,/0\.123456789|Primärpfad · Diagnose/);
    assert.match(html,/partial-observation/);
  }
});

test('all disclosure identities are stable and explicit expansion survives new projection',()=>{
  const options={projection:projectedResult(),idPrefix:'comparison-left',expandedSections:['controls','technical','provenance','untrusted-key']};
  const first=renderArenaResultView(options);
  const next=renderArenaResultView({...options,projection:projectedResult({state:'failed',insufficient:true})});
  for(const key of ARENA_RESULT_DISCLOSURE_KEYS){
    for(const html of [first,next]){
      assert.match(html,new RegExp(`id="comparison-left-${key}-summary"`));
      assert.match(html,new RegExp(`data-arena-result-section="${key}"[^>]*${options.expandedSections.includes(key)?' open':''}>`));
    }
  }
  assert.doesNotMatch(first,/data-arena-result-section="untrusted-key"/);
  assert.doesNotMatch(renderArenaResultView({projection:projectedResult()}),/ open>/);
});

test('every actionable disclosure has a 44px target and wrapping raw block',()=>{
  const html=renderArenaResultView({projection:projectedResult(),expandedSections:[...ARENA_RESULT_DISCLOSURE_KEYS]});
  assert.equal((html.match(/<summary /g)||[]).length,5);
  assert.equal((html.match(/min-height:44px/g)||[]).length,5);
  assert.ok((html.match(/white-space:pre-wrap;overflow-wrap:anywhere/g)||[]).length>=6);
  assert.doesNotMatch(html,/tabindex="-1"/);
  assert.match(html,/<caption>Producerwerte · feste fachliche Reihenfolge, ohne Berechnung oder Sortierung<\/caption>/);
  const comparison=html.slice(html.indexOf('<caption>'),html.indexOf('</table>'));
  assert.ok(comparison.indexOf('Baseline · Primär · Basis 15 bp')<comparison.indexOf('Control · Vollkorb'));
  assert.ok(comparison.indexOf('Control · risikobasierte Exposition')<comparison.indexOf('Cash'));
  assert.ok(comparison.indexOf('Cash')<comparison.indexOf('Nachbar · Fenster 20'));
  assert.ok(comparison.indexOf('Nachbar · Fenster 20')<comparison.indexOf('Stress · Primär · 30 bp'));
});

test('untrusted text is escaped, raw producer spelling and source order preserved',()=>{
  const projection=projectedResult();
  projection.job.trialKey='<img src=x onerror="bad()">';
  projection.result.paths[0].status='<script>bad()</script>';
  const html=renderArenaResultView({projection});
  assert.doesNotMatch(html,/<img|<script>/);
  assert.match(html,/&lt;img src=x onerror=&quot;bad\(\)&quot;&gt;/);
  assert.match(html,/ \{&quot;raw&quot;:1\.2300,&quot;text&quot;:&quot;&lt;source&gt;&quot;\} /);
  assert.match(html,/\[&quot;descriptor-b&quot;,&quot;descriptor-a&quot;\]/);
  assert.match(html,/\[&quot;descriptor-a&quot;,&quot;descriptor-b&quot;\]/);
});

test('renderer does not mutate projection or caller disclosure state',()=>{
  const projection=projectedResult();
  const before=structuredClone(projection);
  const expandedSections=Object.freeze(['technical']);
  const deepFreeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(deepFreeze);Object.freeze(value);}};
  deepFreeze(projection);
  assert.equal(renderArenaResultView({projection,expandedSections}),renderArenaResultView({projection,expandedSections}));
  assert.deepEqual(projection,before);
  assert.deepEqual(expandedSections,['technical']);
});

test('invalid DOM ID prefixes are rejected and distinct instances do not share IDs',()=>{
  for(const idPrefix of ['', '<script>', 'x" onclick="bad', 'x'.repeat(65),null]){
    assert.throws(()=>renderArenaResultView({idPrefix}),TypeError);
  }
  const a=renderArenaResultView({projection:projectedResult(),idPrefix:'left'});
  const b=renderArenaResultView({projection:projectedResult(),idPrefix:'right'});
  const ids=html=>[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
  assert.equal(ids(a).length,new Set(ids(a)).size);
  assert.equal(ids(a).filter(id=>ids(b).includes(id)).length,0);
});
