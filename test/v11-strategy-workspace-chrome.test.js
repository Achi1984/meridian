import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,normalize,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {parseArenaHistoricalResultFixture} from '../v11/arena-historical-result.js';
import {ARENA_SYMBOLS} from '../research/strategy-paper-arena.js';
import {exportHistoricalResult} from '../scripts/research/b1-7/export-historical-result.mjs';
import {canonicalJson,createExecution,sha256} from '../scripts/research/b1-7/engine.mjs';
import bridgeManifest from '../scripts/research-supervisor/b1_bridge_manifest.json' with {type:'json'};
import {createSyntheticSeries} from './fixtures/b1-7/synthetic-series.mjs';
import {
  createInsufficientEvidenceProfile,createInsufficientEvidenceSeries
} from '../scripts/research-supervisor/test_b1_generated_fixture.mjs';
import {withMobileChrome} from './helpers/v11-cdp.mjs';

const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium'].find(path=>path&&existsSync(path));
const repository=fileURLToPath(new URL('../',import.meta.url));
const campaign=JSON.parse(readFileSync(join(repository,'docs/strategy-lab/campaign-20261013.json'),'utf8'));
const v11=join(repository,'v11');
const sizes=[{width:320,height:568,mobile:true},{width:375,height:667,mobile:true},
  {width:390,height:844,mobile:true},{width:430,height:932,mobile:true},
  {width:1440,height:900,mobile:false}];

function staticServer(){
  const requests=[];
  const server=createServer((request,response)=>{
    const url=new URL(request.url,'http://localhost');
    requests.push({method:request.method,path:url.pathname});
    if(request.method!=='GET'){response.writeHead(405);response.end();return;}
    if(url.pathname==='/app-access'){
      response.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
      response.end(JSON.stringify({version:'7.64-CANONICAL-PORTFOLIO-HISTORY-V3',points:[]}));return;
    }
    const roots=[['/v11/',v11],['/research/',join(repository,'research')],['/docs/',join(repository,'docs')]];
    const match=roots.find(([prefix])=>url.pathname.startsWith(prefix));
    if(!match){response.writeHead(404);response.end();return;}
    const [prefix,root]=match;
    const path=normalize(join(root,decodeURIComponent(url.pathname.slice(prefix.length))));
    if(path!==root&&!path.startsWith(root.endsWith(sep)?root:root+sep)){response.writeHead(404);response.end();return;}
    try{
      let body=readFileSync(path);
      if(path===join(v11,'app-access.js')){
        body=body.toString().replace('https://p01--achi-meridian--ttvk44grdlp7.code.run/api/private/portfolio-history?range=1w','/app-access');
      }
      const type=path.endsWith('.html')?'text/html; charset=utf-8':
        path.endsWith('.json')?'application/json; charset=utf-8':'text/javascript; charset=utf-8';
      response.writeHead(200,{'content-type':type,'cache-control':'no-store'});
      response.end(body);
    }catch{response.writeHead(404);response.end();}
  });
  return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve({
    server,requests,url:`http://127.0.0.1:${server.address().port}/v11/index.html`
  })));
}

function syntheticPayload(){
  const day=86400000,start=Date.UTC(2025,0,1);
  const data=Object.fromEntries(ARENA_SYMBOLS.map(symbol=>[symbol,Array.from({length:210},(_,index)=>({
    openTime:start+index*day,closeTime:start+(index+1)*day-1,
    open:100+index,close:100+index+.5,high:101+index,low:99+index
  }))]));
  return {data,asOf:start+210*day,sourceKind:'SYNTHETIC',quoteCurrency:'USD',liquidateAtEnd:true};
}

function historicalUiFixture({screenStatus='PASS'}={}){
  const pathIds=Array.from({length:44},(_,index)=>(index+1).toString(16).padStart(64,'0'));
  const computationPathIds=[...pathIds].reverse();
  const variants=['primary-n30-f25','neighbour-n20-f25','neighbour-n45-f25',
    'neighbour-n30-f20','neighbour-n30-f35'];
  const scenarios=['base-15bp','stress-30bp','stress-30bp-delay-1d'];
  const descriptors=[
    ...variants.flatMap(variantId=>scenarios.flatMap(scenarioId=>
      ['development','diagnostic'].map(segmentId=>({variantId,scenarioId,segmentId})))),
    ...scenarios.flatMap(scenarioId=>['development','diagnostic']
      .map(segmentId=>({variantId:'full-basket-weekly',scenarioId,segmentId}))),
    ...['frozen-mean-exposure','frozen-risk-exposure']
      .flatMap(variantId=>scenarios.map(scenarioId=>({variantId,scenarioId,segmentId:'diagnostic'}))),
    {variantId:'cash-zero',scenarioId:'scenario-independent',segmentId:'development'},
    {variantId:'cash-zero',scenarioId:'scenario-independent',segmentId:'diagnostic'}
  ];
  const controlDefinitions={status:'FROZEN_DEVELOPMENT_ONLY',meanExposure:0.5,riskExposure:0.25,
    primaryDevelopmentSd:0.02,fullBasketDevelopmentSd:0.08,
    calibration:'DEVELOPMENT_15BP_DAILY_NET_RETURNS_AND_HELD_TARGETS'};
  const screen=screenStatus==='INSUFFICIENT_EVIDENCE'
    ?{status:'INSUFFICIENT_EVIDENCE',checks:{fullBasketDrawdownDenominator:false},relativeDrawdownReduction:null}
    :{status:'PASS',interpretation:'HISTORICAL_CANDIDATE_ONLY_NOT_HOLDOUT',comparisonSegment:'diagnostic',
      neighbourStressScenario:'stress-30bp-non-delayed',
      checks:{primaryDiagnosticNetPositive:true,primaryDiagnosticDrawdownAtMost25Percent:true,
        primaryReturnAtLeastBothFrozenControls:true,primaryDrawdownAtMostBothFrozenControls:true,
        relativeDrawdownReductionAtLeast20Percent:true,primaryNetPositiveAt30bpNonDelayed:true,
        primaryNetPositiveAt30bpPlusDelay:true,atLeastThreeOfFourNeighboursPositiveAt15bp:true,
        atLeastThreeOfFourNeighboursPositiveAt30bpNonDelayed:true},
      relativeDrawdownReduction:0.25,neighbourPositiveCounts:{base15bp:3,stress30bp:3},
      stopPolicy:'NO_FINITE_TRADE_STOP',tradeCRV:{status:'UNDEFINED_NO_FINITE_STOP',value:null}};
  const jobPaths=computationPathIds.map((pathId,index)=>({
    pathId,ordinal:index+1,phase:index<19?'DEVELOPMENT':'DIAGNOSTIC',state:'completed',
    startedAt:'2026-01-01T00:00:01Z',payloadSha256:'a'.repeat(64),completedAt:'2026-01-01T00:00:02Z'
  }));
  const result={
    attemptedPaths:44,authority:{researchOnly:true,executionAuthorized:false,strategyPnlAuthorized:false,
      discoveryAuthorized:false,validationAuthorized:false,holdoutAuthorized:false,paperAuthorized:false,
      liveAuthorized:false},
    budget:{},completedPaths:44,computedPaths:44,controlRealization:[],
    evidence:{syntheticFixture:false,priceSource:'PINNED_KRAKEN_SPOT_USD_CANDLES',
      sourceAuthenticity:'NOT_ESTABLISHED',historyLabel:'DEVELOPMENT_AND_HISTORICAL_DIAGNOSTIC',
      candidateInterpretation:'HISTORICAL_CANDIDATE_ONLY_IF_PROPOSED_REAL_SCREEN_PASSES',
      costModel:'OKX_INSPIRED_ASSUMED_15_30BP_NOT_EXECUTION_EVIDENCE',
      executionEvidence:'NOT_OKX_EXECUTION_EVIDENCE',holdoutClaim:false,trialLedger:'UNKNOWN',
      diagnosticRescaling:'NONE',stoppedPolicy:'NO_FINITE_TRADE_STOP',
      crv:{status:'UNDEFINED_NO_FINITE_STOP',value:null,researchOnly:true},survivorship:'generated-browser-fixture'},
    executionId:'b'.repeat(64),failure:null,
    identity:{datasetKind:'FROZEN_RESEARCH_INPUT',sourceCommit:'generated-browser-fixture',
      sourceProvenance:{normalizedFileSha256:{}},canonicalSeriesSha256:{},inputSha256:'c'.repeat(64)},
    implementationId:'generated-browser-fixture',implementationSha256:'d'.repeat(64),
    plannedPaths:44,protocolId:'generated-browser-fixture',protocolReview:{},protocolSha256:'a'.repeat(64),
    schema:'MERIDIAN_B1_7_ENGINE_RESULT_R3',screen,status:'COMPLETED',controlDefinitions,
    paths:pathIds.map((pathId,index)=>({pathId,...descriptors[index],status:'COMPLETED',computed:true,
      attempts:1,netReturn:0.123456789012345,sampledDrawdown:0.087654321098765}))
  };
  return {schema:'MERIDIAN_B1_HISTORICAL_UI_FIXTURE_V1',evidenceClass:'SYNTHETIC_ONLY',
    purpose:'UI_FIXTURE_NOT_PRODUCER_EXPORT',job:{
      trialId:'f'.repeat(64),trialKey:'trial-generated-browser-fixture',state:'completed',
      attempts:1,owner:'generated-browser-fixture',fence:7,profile:'MERIDIAN-B1-7-HISTORICAL-ONE-SHOT-R1',
      protocolSha256:'a'.repeat(64),sourceSha256:'b'.repeat(64),dataSha256:'c'.repeat(64),
      manifestSha256:'e'.repeat(64),pathIds,computationPathIds,
      timestamps:{createdAt:'2026-01-01T00:00:00Z',startedAt:'2026-01-01T00:00:01Z',
        finishedAt:'2026-01-01T00:00:03Z'},
      paths:jobPaths,controls:JSON.stringify(controlDefinitions),
      controlBindings:{primaryDevelopmentSha256:'a'.repeat(64),fullBasketDevelopmentSha256:'a'.repeat(64)},
      result:JSON.stringify(result),resultSha256:'f'.repeat(64),summarySha256:'1'.repeat(64),
      reason:null,unresolved:false,executionAuthorized:false,promotionAuthorized:false,
      profitabilityInferred:false
    }};
}

async function queuedProducerExport(){
  const trialKey='trial-m11-browser-queued';
  const observation={
    trialId:sha256(Buffer.from(trialKey,'utf8')),trialKey,state:'queued',attempts:0,owner:null,fence:0,
    profile:bridgeManifest.profile,protocolSha256:bridgeManifest.protocolSha256,
    sourceSha256:sha256(canonicalJson(bridgeManifest.sourceSha256)),
    dataSha256:bridgeManifest.inputSha256,manifestSha256:bridgeManifest.manifestSha256,
    pathIds:bridgeManifest.pathIds,
    computationPathIds:bridgeManifest.computationOrder.map(index=>bridgeManifest.pathIds[index]),
    timestamps:{createdAt:'2026-01-01T00:00:00Z',startedAt:null,finishedAt:null},
    paths:[],controls:null,controlBindings:null,result:null,resultSha256:null,summarySha256:null,
    reason:null,unresolved:false,executionAuthorized:false,promotionAuthorized:false,
    profitabilityInferred:false
  };
  return exportHistoricalResult({observation,resultBytes:null,syntheticFixture:true});
}

async function generatedProducerExport(insufficient=false){
  const profile=insufficient?createInsufficientEvidenceProfile():bridgeManifest;
  const series=insufficient?createInsufficientEvidenceSeries():createSyntheticSeries();
  const execution=createExecution({
    seriesByAsset:series,source:{kind:'SYNTHETIC_FIXTURE'},
    implementationSha256:profile.implementationSha256
  });
  while(execution.status==='READY')execution.advanceOne();
  const result=execution.finalResult();
  const trialKey=`trial-m11-browser-${insufficient?'insufficient':'completed'}`;
  const generator=String.raw`
import hashlib, json, sys
def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False)
def sha(value):
    return hashlib.sha256(value).hexdigest()
profile, result, state, trial_key = (lambda v: (v['profile'],v['result'],v['state'],v['trialKey']))(json.load(sys.stdin))
result_bytes = canonical(result).encode('ascii')
by_id = {path['pathId']: path for path in result['paths']}
computation_ids = [profile['pathIds'][i] for i in profile['computationOrder']]
count = 44 if result['status'] == 'COMPLETED' else 19
paths = [{
    'pathId': path_id, 'ordinal': index + 1,
    'phase': 'DEVELOPMENT' if index < 19 else 'DIAGNOSTIC',
    'state': 'completed', 'startedAt': '2026-01-01T00:00:01Z',
    'payloadSha256': sha(canonical(by_id[path_id]).encode('ascii')),
    'completedAt': '2026-01-01T00:00:01Z'
} for index, path_id in enumerate(computation_ids[:count])]
summary = {key: value for key, value in result.items() if key not in ('paths', 'controlDefinitions')}
controls = canonical(result['controlDefinitions'])
job = {
    'trialId': sha(trial_key.encode('utf8')), 'trialKey': trial_key,
    'state': state, 'attempts': 1, 'owner': 'synthetic-generated-sample', 'fence': 1,
    'profile': profile['profile'], 'protocolSha256': profile['protocolSha256'],
    'sourceSha256': profile.get('sourceIdentitySha256') or
                    sha(canonical(profile['sourceSha256']).encode('ascii')),
    'dataSha256': profile['inputSha256'], 'manifestSha256': profile['manifestSha256'],
    'pathIds': profile['pathIds'], 'computationPathIds': computation_ids,
    'timestamps': {'createdAt': '2026-01-01T00:00:00Z', 'startedAt': '2026-01-01T00:00:01Z',
                   'finishedAt': '2026-01-01T00:00:01Z'},
    'paths': paths, 'controls': controls,
    'controlBindings': {
        'primaryDevelopmentSha256': paths[0]['payloadSha256'],
        'fullBasketDevelopmentSha256': paths[15]['payloadSha256']},
    'result': result_bytes.decode('utf8'), 'resultSha256': sha(result_bytes),
    'summarySha256': sha(canonical(summary).encode('ascii')),
    'reason': None if result['status'] == 'COMPLETED' else
              'INVALID_OR_ZERO_DEVELOPMENT_RISK_DENOMINATOR',
    'unresolved': False, 'executionAuthorized': False,
    'promotionAuthorized': False, 'profitabilityInferred': False
}
sys.stdout.write(json.dumps(job, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False))
`;
  const generated=spawnSync('python3',['-c',generator],{
    input:JSON.stringify({profile,result,state:insufficient?'failed':'completed',trialKey}),
    encoding:'utf8',maxBuffer:8*1024*1024
  });
  assert.equal(generated.status,0,generated.stderr);
  const observation=JSON.parse(generated.stdout);
  const resultBytes=new Uint8Array(Buffer.from(observation.result,'utf8'));
  return {envelope:await exportHistoricalResult({observation,resultBytes,syntheticFixture:true}),result};
}

test('M11 Strategies native shell, synthetic Arena and responsive evidence at five widths',{timeout:240000},async()=>{
  const completed=historicalUiFixture();
  const insufficientScreen=historicalUiFixture({screenStatus:'INSUFFICIENT_EVIDENCE'});
  const producerExport=await queuedProducerExport();
  const completedProducer=await generatedProducerExport();
  const insufficientProducer=await generatedProducerExport(true);
  assert.equal(parseArenaHistoricalResultFixture(JSON.stringify(completed)).status,'PRESENT_UNVERIFIED');
  assert.equal(parseArenaHistoricalResultFixture(JSON.stringify(insufficientScreen)).status,'PRESENT_UNVERIFIED');
  if(typeof WebSocket!=='function'){
    const env={...process.env};delete env.NODE_TEST_CONTEXT;
    const child=spawnSync(process.execPath,['--experimental-websocket',fileURLToPath(import.meta.url)],
      {env,encoding:'utf8',timeout:235000});
    assert.equal(child.status,0,String(child.stdout).slice(-2500)+String(child.stderr).slice(-1000));
    const rows=child.stdout.split('\n').filter(line=>line.startsWith('V11_B12_SIZE '));
    assert.equal(rows.length,5);rows.forEach(row=>console.log(row));return;
  }
  assert.ok(chrome,'Chrome is required for native M11 strategy acceptance.');
  const hosted=await staticServer();
  const evidence=process.env.V11_B12_EVIDENCE_DIR;
  if(evidence)mkdirSync(evidence,{recursive:true});
  try{
    for(const size of sizes){
      const previousSourceRequests=hosted.requests.filter(request=>request.path==='/docs/strategy-lab/campaign-20261013.json').length;
      const metrics=await withMobileChrome(chrome,size.width,hosted.url,async call=>{
        const evaluate=async expression=>{
          const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
          const exception=result.exceptionDetails;
          if(exception){
            const name=String(exception.exception?.className||'Exception')
              .replace(/[^A-Za-z0-9_.-]/g,'').slice(0,40)||'Exception';
            const detail=String(exception.exception?.description||exception.text||'')
              .split('\n',1)[0]
              .replace(/\b(password|token|secret|credential)\b\s*[:=]\s*[^\s,;]+/gi,'$1=[redacted]')
              .replace(/\bBearer\s+\S+/gi,'******')
              .replace(/[^\x20-\x7e]/g,'?').slice(0,180);
            assert.fail(`M11 strategy page expression failed (${name})${detail?': '+detail:''}`);
          }
          return result.result?.value;
        };
        const waitForProducerText=text=>evaluate(`new Promise(resolve=>{
          const root=document.getElementById('strategy-arena-root');
          const matches=()=>root.querySelector('[aria-label="Separates historisches Arena-Ergebnis · Producer-Export"]')
            ?.innerText.includes(${JSON.stringify(text)});
          if(matches())return resolve(true);
          const observer=new MutationObserver(()=>{
            if(matches()){observer.disconnect();resolve(true);}
          });
          observer.observe(root,{childList:true,subtree:true,characterData:true});
        })`);
        const waitForProducerAlert=text=>evaluate(`new Promise(resolve=>{
          const root=document.getElementById('strategy-arena-root');
          const matches=()=>root.querySelector('[aria-label="Separates historisches Arena-Ergebnis · Producer-Export"] [role="alert"]')
            ?.innerText.includes(${JSON.stringify(text)});
          if(matches())return resolve(true);
          const observer=new MutationObserver(()=>{
            if(matches()){observer.disconnect();resolve(true);}
          });
          observer.observe(root,{childList:true,subtree:true,characterData:true});
        })`);
        const key=async(name,code,keyCode)=>{
          const text=name==='Enter'?'\r':null;
          await call('Input.dispatchKeyEvent',{type:'keyDown',key:name,code,windowsVirtualKeyCode:keyCode,
            ...(text===null?{}:{text,unmodifiedText:text})});
          await call('Input.dispatchKeyEvent',{type:'keyUp',key:name,code,windowsVirtualKeyCode:keyCode});
        };
        await call('Emulation.setDeviceMetricsOverride',{width:size.width,height:size.height,
          deviceScaleFactor:1,mobile:size.mobile,screenWidth:size.width,screenHeight:size.height});
        await evaluate(`(()=>{const input=document.getElementById('app-access-password');input.value='synthetic-password';
          document.getElementById('app-access-form').requestSubmit();return true;})()`);
        for(let attempt=0;attempt<100;attempt++){
          if(await evaluate(`!document.getElementById('app').hidden`))break;
          await new Promise(resolve=>setTimeout(resolve,10));
        }
        assert.equal(await evaluate(`document.getElementById('app').hidden`),false,'shared app password unlocks the shell');
        const initial=await evaluate(`(()=>{
          const nav=[...document.querySelectorAll('#nav button')];
          return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,
            nav:nav.map(button=>({name:button.dataset.v,label:button.innerText,height:button.getBoundingClientRect().height})),
            active:document.querySelector('.view.active')?.id,
            v10Links:[...document.querySelectorAll('a')].filter(link=>/v10/i.test(link.href)).length};
        })()`);
        assert.equal(initial.width,size.width);
        assert.equal(initial.overflow,false);
        assert.equal(initial.active,'view-command');
        assert.equal(initial.nav.length,5);
        assert.deepEqual(initial.nav.map(item=>item.name),['command','depot','bots','market','strategies']);
        assert.ok(initial.nav.every(item=>item.height>=44));
        assert.equal(initial.v10Links,0);

        await evaluate(`document.querySelector('#nav button[data-v="strategies"]').focus()`);
        await key('Enter','Enter',13);
        for(let attempt=0;attempt<100;attempt++){
          if(await evaluate(`document.querySelectorAll('#strategy-catalog [data-strategy-id^="H"]').length===12`))break;
          await new Promise(resolve=>setTimeout(resolve,25));
        }
        // Measure settled layout, not the active view's translateY appearance animation.
        // With reduced motion getAnimations() is empty and this resolves immediately.
        await evaluate(`(async()=>{
          const view=document.getElementById('view-strategies');
          if(view.hidden||!view.classList.contains('active'))throw Error('Strategies view is not active');
          await Promise.all(view.getAnimations().map(animation=>animation.finished));
          return true;
        })()`);
        const catalog=await evaluate(`(()=>{
          const root=document.documentElement,view=document.getElementById('view-strategies');
          return {visible:!view.hidden,active:document.querySelector('.view.active').id,
            current:[...document.querySelectorAll('#nav [aria-current="page"]')].map(button=>button.dataset.v),
            families:[...document.querySelectorAll('#strategy-catalog [data-strategy-id^="H"]')].length,
            candidate:document.querySelector('[data-strategy-id="B1-7"]')?.innerText,
            h9:document.querySelector('[data-strategy-id="H9"]')?.innerText,
            models:[...document.querySelectorAll('#strategy-arena-root .arena-model-card')].map(card=>card.innerText),
            overflow:root.scrollWidth>innerWidth+1,
            controls:[...document.querySelectorAll('#strategy-catalog details summary,#strategy-catalog select,#strategy-catalog [data-strategy-compare-reset],#strategy-catalog .strategy-history input,#strategy-catalog [data-strategy-history-reset],#strategy-arena-root button,#strategy-arena-root input')].map(node=>node.getBoundingClientRect().height),
            comparison:{
              selectors:[...document.querySelectorAll('#strategy-catalog [data-strategy-compare]')].map(node=>({
                value:node.value,focused:document.activeElement===node,height:node.getBoundingClientRect().height
              })),
              families:[...document.querySelectorAll('.strategy-comparison [data-comparison-family]')].map(node=>node.dataset.comparisonFamily),
              text:document.querySelector('.strategy-comparison [aria-live="polite"]')?.innerText,
              overflow:document.querySelector('.strategy-comparison').scrollWidth>document.querySelector('.strategy-comparison').clientWidth+1
            },
            history:(()=>{
              const section=document.querySelector('.strategy-history');
              return {text:section.innerText,
                rationales:[...section.querySelectorAll('dl')].map(fields=>fields.querySelectorAll('dd')[2]?.innerText),
                count:section.querySelector('[aria-live="polite"]').innerText,
                searchLabel:section.querySelector('label[for="strategy-history-search"]')?.innerText,
                entries:section.querySelectorAll('.arena-model-card').length,
                searchHeight:section.querySelector('input').getBoundingClientRect().height,
                resetHeight:section.querySelector('[data-strategy-history-reset]').getBoundingClientRect().height,
                overflow:section.scrollWidth>section.clientWidth+1,
                documentOverflow:root.scrollWidth>innerWidth+1,
                strategyIds:section.querySelectorAll('[data-strategy-id],[data-comparison-family]').length};
            })(),
            resources:performance.getEntriesByType('resource').map(row=>new URL(row.name).pathname)};
        })()`);
        assert.equal(catalog.visible,true);assert.equal(catalog.active,'view-strategies');
        assert.deepEqual(catalog.current,['strategies']);assert.equal(catalog.families,12);
        assert.match(catalog.candidate,/7 Assets · 44 geplante Pfade/);
        assert.match(catalog.candidate,/15 bp Basis, 30 bp Stress, \+1 Tag/);
        assert.match(catalog.candidate,/keine Ergebnisse/i);
        assert.match(catalog.h9,/BLOCKED_DATA/);
        assert.equal(catalog.models.length,5);
        assert.equal(catalog.overflow,false);
        assert.ok(catalog.controls.every(height=>height>=44),`settled controls at ${size.width}px: ${JSON.stringify(catalog.controls)}`);
        const paperReadiness=await evaluate(`(()=>{
          const panel=document.getElementById('paper-readiness-root');
          const groups=[...panel.querySelectorAll('[data-paper-readiness]')];
          return {count:document.querySelectorAll('#paper-readiness-root').length,
            visible:panel.getBoundingClientRect().height>0,
            precedesCatalog:!!(panel.compareDocumentPosition(document.getElementById('strategy-catalog'))&Node.DOCUMENT_POSITION_FOLLOWING),
            text:panel.innerText,groups:groups.map(node=>({id:node.dataset.paperReadiness,open:node.open,
              height:node.querySelector('summary').getBoundingClientRect().height})),
            interactiveActions:panel.querySelectorAll('button,input,select,form,a').length,
            overflow:panel.scrollWidth>panel.clientWidth+1||document.documentElement.scrollWidth>innerWidth+1,
            requests:performance.getEntriesByType('resource').length};
        })()`);
        assert.equal(paperReadiness.count,1);
        assert.equal(paperReadiness.visible,true);
        assert.equal(paperReadiness.precedesCatalog,true);
        assert.match(paperReadiness.text,/kein laufender Paper-Betrieb/);
        assert.match(paperReadiness.text,/Paperstart gesperrt · Echtgeldhandel nicht freigegeben/);
        assert.match(paperReadiness.text,/D2 ohne Edge; Qualifikation offen/);
        assert.match(paperReadiness.text,/Quellenstand 2026-10-31/);
        assert.match(paperReadiness.text,/Nächster Schritt/);
        assert.match(paperReadiness.text,/Vertrag zur Klärung ungewisser Buchungen/);
        assert.deepEqual(paperReadiness.groups.map(row=>row.id),['prepared','gates','choices']);
        assert.ok(paperReadiness.groups.every(row=>!row.open&&row.height>=44));
        assert.equal(paperReadiness.interactiveActions,0);
        assert.equal(paperReadiness.overflow,false);
        await evaluate(`document.querySelector('[data-paper-readiness="choices"] summary').focus()`);
        await key('Enter','Enter',13);
        const paperChoices=await evaluate(`(()=>{
          const panel=document.getElementById('paper-readiness-root');
          const group=panel.querySelector('[data-paper-readiness="choices"]');
          return {open:group.open,focused:document.activeElement===group.querySelector('summary'),
            count:group.querySelectorAll(':scope > ul > li').length,text:group.innerText,
            overflow:panel.scrollWidth>panel.clientWidth+1||document.documentElement.scrollWidth>innerWidth+1};
        })()`);
        assert.equal(paperChoices.open,true);
        assert.equal(paperChoices.focused,true);
        assert.equal(paperChoices.count,12);
        assert.match(paperChoices.text,/Diese Übersicht speichert keine Auswahl/);
        assert.match(paperChoices.text,/Gebühren, Slippage und Liquidität/);
        assert.equal(paperChoices.overflow,false);
        await key('Enter','Enter',13);
        assert.equal(await evaluate(`document.querySelector('[data-paper-readiness="choices"]').open`),false);
        await evaluate(`document.querySelector('[data-paper-readiness="gates"] summary').click()`);
        const paperGates=await evaluate(`(()=>{
          const panel=document.getElementById('paper-readiness-root');
          const group=panel.querySelector('[data-paper-readiness="gates"]');
          return {open:group.open,text:group.innerText,
            overflow:panel.scrollWidth>panel.clientWidth+1||document.documentElement.scrollWidth>innerWidth+1};
        })()`);
        assert.equal(paperGates.open,true);
        assert.match(paperGates.text,/NO_EDGE/);
        assert.match(paperGates.text,/keine Bewertung aller zwölf Hypothesen/);
        assert.match(paperGates.text,/unabhängige Abnahme.*bleibt offen/);
        assert.equal(paperGates.overflow,false);
        await evaluate(`document.querySelector('[data-paper-readiness="gates"] summary').click()`);
        await evaluate(`document.querySelector('[data-paper-readiness="prepared"] summary').click()`);
        const paperPrepared=await evaluate(`(()=>{
          const panel=document.getElementById('paper-readiness-root');
          const group=panel.querySelector('[data-paper-readiness="prepared"]');
          group.querySelectorAll('details').forEach(node=>{node.open=true;});
          return {open:group.open,text:group.innerText,
            overflow:panel.scrollWidth>panel.clientWidth+1||document.documentElement.scrollWidth>innerWidth+1,
            requests:performance.getEntriesByType('resource').length};
        })()`);
        assert.equal(paperPrepared.open,true);
        assert.match(paperPrepared.text,/Synthetische Tests belegen keine Strategiequalität oder Betriebsbereitschaft/);
        assert.match(paperPrepared.text,/SYNTHETIC_PAPER_HARNESS_RECEIPT/);
        assert.equal(paperPrepared.overflow,false);
        assert.equal(paperPrepared.requests,paperReadiness.requests);
        await evaluate(`document.querySelector('[data-paper-readiness="prepared"] summary').click()`);
        assert.deepEqual(catalog.comparison.selectors.map(node=>node.value),['H1','H2']);
        assert.deepEqual(catalog.comparison.families,['H1','H2']);
        assert.match(catalog.comparison.text,/Hypotheses|Hypothese|Hypoth/i);
        assert.equal(catalog.comparison.overflow,false);
        assert.ok(catalog.comparison.selectors.every(node=>node.height>=44));
        assert.match(catalog.history.text,/Historische Zusammenfassungen aus dem Entwurfsregister/);
        assert.match(catalog.history.text,/nicht neu verifizierte Evidenz/);
        assert.match(catalog.history.text,/Keine Zuordnung zu H1–H12, keine Vererbung von PASS und keine Paper-Freigabe/);
        assert.match(catalog.history.text,/Quelle: Historische Zusammenfassungen aus dem Entwurfsregister/);
        assert.deepEqual(catalog.history.rationales,campaign.knownEvidence.map(entry=>entry.reason));
        assert.equal(catalog.history.count,'5 von 5 Zusammenfassungen angezeigt.');
        assert.match(catalog.history.searchLabel,/Familie, Entscheidung, Begründung/);
        assert.equal(catalog.history.entries,5);
        assert.equal(catalog.history.strategyIds,0);
        assert.equal(catalog.history.overflow,false);
        assert.equal(catalog.history.documentOverflow,false);
        assert.ok(catalog.history.searchHeight>=44);
        assert.ok(catalog.history.resetHeight>=44);
        await evaluate(`document.querySelector('#strategy-history-search').focus()`);
        await call('Input.insertText',{text:'TAKER ORDER FLOW V1'});
        const searchedFamily=await evaluate(`(()=>{
          const section=document.querySelector('.strategy-history'),input=section.querySelector('input');
          return {value:input.value,focused:document.activeElement===input,
            count:section.querySelector('[aria-live="polite"]').innerText,
            entries:[...section.querySelectorAll('.arena-model-card')].map(card=>card.innerText),
            overflow:section.scrollWidth>section.clientWidth+1};
        })()`);
        assert.equal(searchedFamily.value,'TAKER ORDER FLOW V1');
        assert.equal(searchedFamily.focused,true);
        assert.equal(searchedFamily.count,'1 von 5 Zusammenfassungen angezeigt.');
        assert.equal(searchedFamily.entries.length,1);
        assert.match(searchedFamily.entries[0],/Taker order flow V1/);
        assert.equal(searchedFamily.overflow,false);
        for(const query of ['HOLDOUT_FAIL','PF BELOW GATE']){
          const searchResult=await evaluate(`(()=>{
            const section=document.querySelector('.strategy-history'),input=section.querySelector('input');
            input.value=${JSON.stringify(query)};input.dispatchEvent(new Event('input',{bubbles:true}));
            return {count:section.querySelector('[aria-live="polite"]').innerText,
              entries:[...section.querySelectorAll('.arena-model-card')].map(card=>card.innerText),
              overflow:section.scrollWidth>section.clientWidth+1};
          })()`);
          assert.equal(searchResult.count,'1 von 5 Zusammenfassungen angezeigt.');
          assert.equal(searchResult.entries.length,1);
          assert.equal(searchResult.overflow,false);
        }
        const noHistoryMatch=await evaluate(`(()=>{
          const section=document.querySelector('.strategy-history'),input=section.querySelector('input');
          input.value='not present in the draft';input.dispatchEvent(new Event('input',{bubbles:true}));
          return {count:section.querySelector('[aria-live="polite"]').innerText,
            empty:section.innerText.includes('Keine historischen Zusammenfassungen entsprechen der Suche.'),
            entries:section.querySelectorAll('.arena-model-card').length,
            overflow:section.scrollWidth>section.clientWidth+1};
        })()`);
        assert.equal(noHistoryMatch.count,'0 von 5 Zusammenfassungen angezeigt.');
        assert.equal(noHistoryMatch.empty,true);
        assert.equal(noHistoryMatch.entries,0);
        assert.equal(noHistoryMatch.overflow,false);
        await evaluate(`document.querySelector('[data-strategy-history-reset]').focus()`);
        await key('Enter','Enter',13);
        const resetHistory=await evaluate(`(()=>{
          const section=document.querySelector('.strategy-history'),input=section.querySelector('input');
          return {value:input.value,focused:document.activeElement===section.querySelector('[data-strategy-history-reset]'),
            count:section.querySelector('[aria-live="polite"]').innerText,
            entries:section.querySelectorAll('.arena-model-card').length,
            overflow:section.scrollWidth>section.clientWidth+1};
        })()`);
        assert.equal(resetHistory.value,'');
        assert.equal(resetHistory.focused,true);
        assert.equal(resetHistory.count,'5 von 5 Zusammenfassungen angezeigt.');
        assert.equal(resetHistory.entries,5);
        assert.equal(resetHistory.overflow,false);
        assert.ok(catalog.resources.every(path=>!/\/v10\/|\/api\/|\/market|\/ticker|\/klines/i.test(path)));
        assert.ok(catalog.resources.includes('/docs/strategy-lab/campaign-20261013.json'));
        await evaluate(`(()=>{
          const first=document.querySelector('#strategy-comparison-first');
          const second=document.querySelector('#strategy-comparison-second');
          second.focus();
        })()`);
        await key('ArrowDown','ArrowDown',40);
        const keyboardSelection=await evaluate(`({
          value:document.querySelector('#strategy-comparison-second').value,
          focused:document.activeElement===document.querySelector('#strategy-comparison-second'),
          cards:[...document.querySelectorAll('.strategy-comparison [data-comparison-family]')].map(node=>node.dataset.comparisonFamily)
        })`);
        assert.equal(keyboardSelection.value,'H3');
        assert.equal(keyboardSelection.focused,true);
        assert.deepEqual(keyboardSelection.cards,['H1','H3']);
        const identical=await evaluate(`(()=>{
          const second=document.querySelector('#strategy-comparison-second');
          second.value='H1';second.dispatchEvent(new Event('change',{bubbles:true}));
          const output=document.querySelector('.strategy-comparison [aria-live="polite"]');
          return {text:output.innerText,cards:[...output.querySelectorAll('[data-comparison-family]')].map(node=>node.dataset.comparisonFamily),
            overflow:output.scrollWidth>output.clientWidth+1};
        })()`);
        assert.match(identical.text,/Dieselbe Familie \(H1\) ist auf beiden Seiten ausgewählt/);
        assert.deepEqual(identical.cards,['H1','H1']);
        assert.equal(identical.overflow,false);
        await evaluate(`document.querySelector('[data-strategy-compare-reset]').focus()`);
        await key('Enter','Enter',13);
        const resetSelection=await evaluate(`({
          values:[...document.querySelectorAll('#strategy-catalog [data-strategy-compare]')].map(node=>node.value),
          focused:document.activeElement===document.querySelector('[data-strategy-compare-reset]'),
          cards:[...document.querySelectorAll('.strategy-comparison [data-comparison-family]')].map(node=>node.dataset.comparisonFamily),
          overflow:document.querySelector('.strategy-comparison').scrollWidth>document.querySelector('.strategy-comparison').clientWidth+1
        })`);
        assert.deepEqual(resetSelection.values,['H1','H2']);
        assert.equal(resetSelection.focused,true);
        assert.deepEqual(resetSelection.cards,['H1','H2']);
        assert.equal(resetSelection.overflow,false);
        if(evidence){
          await evaluate('window.scrollTo(0,0)');
          const image=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
          writeFileSync(join(evidence,`v11-b12-strategies-${size.width}x${size.height}.png`),Buffer.from(image.data,'base64'));
        }

        const beforeInspection=await evaluate(`({requests:performance.getEntriesByType('resource').length,cards:document.querySelector('.arena-models').innerHTML})`);
        await evaluate(`(()=>{
          const report={schema:'MERIDIAN_B1_INSPECTION_REPORT_V1',profile:'MERIDIAN-B1-7-GENERATED-FIXTURE-BRIDGE-R1',
            evidenceClass:'SYNTHETIC_ONLY',trialId:'a'.repeat(64),state:'queued',unresolved:false,requiresExplicitReconciliation:false,
            attempts:0,fence:0,fenceInterpretation:'NO_UNRESOLVED_FENCE_FOR_THIS_TRIAL',integrity:'STORED_JOURNAL_VALIDATED_NOT_SOURCE_AUTHENTICITY',
            timestamps:{createdAt:'2026-01-01T00:00:00Z',startedAt:null,finishedAt:null},
            identities:{protocolSha256:'b'.repeat(64),sourceSha256:'c'.repeat(64),dataSha256:'d'.repeat(64),manifestSha256:'e'.repeat(64),resultSha256:null,summarySha256:null},
            pathsStarted:0,pathsCompleted:0,reasonCode:null,executionAuthorized:false,promotionAuthorized:false,profitabilityInferred:false,recoveryPerformed:false};
          const picker=document.querySelector('[data-arena-inspection]'),transfer=new DataTransfer();
          transfer.items.add(new File([JSON.stringify(report)],'synthetic-inspection.json',{type:'application/json'}));
          picker.files=transfer.files;picker.dispatchEvent(new Event('change',{bubbles:true}));
        })()`);
        for(let attempt=0;attempt<100;attempt++){
          if(await evaluate(`document.querySelector('[aria-label="Separater synthetischer Prüfbericht"]').innerText.includes('Status: queued')`))break;
          await new Promise(resolve=>setTimeout(resolve,20));
        }
        const inspection=await evaluate(`(()=>{
          const section=document.querySelector('[aria-label="Separater synthetischer Prüfbericht"]');
          section.querySelector('details').open=true;
          return {text:section.innerText,overflow:document.documentElement.scrollWidth>innerWidth+1,
            summaryHeight:section.querySelector('summary').getBoundingClientRect().height,
            requests:performance.getEntriesByType('resource').length,cards:document.querySelector('.arena-models').innerHTML};
        })()`);
        assert.match(inspection.text,/SYNTHETIC_ONLY · Status: queued/);
        assert.match(inspection.text,/keine Echtheitsbestätigung/);
        assert.equal(inspection.overflow,false);assert.ok(inspection.summaryHeight>=44);
        assert.equal(inspection.requests,beforeInspection.requests);assert.equal(inspection.cards,beforeInspection.cards);

        const beforeHistorical=await evaluate(`({requests:performance.getEntriesByType('resource').length,cards:document.querySelector('.arena-models').innerHTML})`);
        for(const [fixtureName,fixtureValue,expectedScreen] of [
          ['completed',completed,'Screenstatus: PASS'],
          ['completed-insufficient-screen',insufficientScreen,'Screenstatus: INSUFFICIENT_EVIDENCE']
        ]){
          const historicalText=JSON.stringify(fixtureValue);
          await evaluate(`(()=>{
            const picker=document.querySelector('[data-arena-historical-fixture]'),transfer=new DataTransfer();
            transfer.items.add(new File([${JSON.stringify(historicalText)}],
              'generated-historical-${fixtureName}.json',{type:'application/json'}));
            picker.files=transfer.files;picker.dispatchEvent(new Event('change',{bubbles:true}));
          })()`);
          for(let attempt=0;attempt<100;attempt++){
            if(await evaluate(`document.querySelector('[aria-label="Separates historisches Arena-Ergebnis · UI-Fixture"]')?.innerText.includes('Lifecycle: completed')`))break;
            await new Promise(resolve=>setTimeout(resolve,20));
          }
          const historical=await evaluate(`(()=>{
            const section=document.querySelector('[aria-label="Separates historisches Arena-Ergebnis · UI-Fixture"]');
            const panel=section.getBoundingClientRect();
            const calibration=[...section.querySelectorAll('dd')].find(node=>
              node.innerText==='DEVELOPMENT_15BP_DAILY_NET_RETURNS_AND_HELD_TARGETS');
            const disclosure=section.querySelector('details');
            const summary=disclosure.querySelector('summary');
            summary.focus();
            return {text:section.innerText,overflow:document.documentElement.scrollWidth>innerWidth+1 ||
                section.scrollWidth>section.clientWidth+1,
              summaryHeight:summary.getBoundingClientRect().height,
              focused:document.activeElement===summary,summarySemantic:summary.tagName==='SUMMARY',
              panelWidth:panel.width,calibration:calibration?.innerText,
              calibrationHeight:calibration?.getBoundingClientRect().height,
              calibrationWrap:calibration?getComputedStyle(calibration).overflowWrap:null,
              calibrationOverflow:calibration?.scrollWidth>calibration?.clientWidth+1,
              requests:performance.getEntriesByType('resource').length,
              cards:document.querySelector('.arena-models').innerHTML};
          })()`);
          assert.match(historical.text,/SYNTHETIC_ONLY/);
          assert.match(historical.text,/kein Producer-Export/);
          assert.match(historical.text,/Lifecycle: completed/);
          assert.match(historical.text,/Engine-Ergebnisstatus: COMPLETED/);
          assert.match(historical.text,/Abgeschlossene Ergebnisse: 44 von 44 geplanten Pfaden/);
          assert.match(historical.text,/DEVELOPMENT_15BP_DAILY_NET_RETURNS_AND_HELD_TARGETS/);
          assert.match(historical.text,new RegExp(expectedScreen));
          assert.match(historical.text,/Abgeschlossene Ergebnisse sind kein Nachweis ausreichender Screen-Evidenz/);
          assert.doesNotMatch(historical.text,/protocolSha256/);
          assert.equal(historical.overflow,false);assert.ok(historical.summaryHeight>=44);
          assert.equal(historical.focused,true);assert.equal(historical.summarySemantic,true);
          assert.equal(historical.calibration,'DEVELOPMENT_15BP_DAILY_NET_RETURNS_AND_HELD_TARGETS');
          if(size.mobile)assert.ok(historical.calibrationHeight>=32);
          assert.equal(historical.calibrationWrap,'anywhere');
          assert.equal(historical.calibrationOverflow,false);
          assert.equal(historical.requests,beforeHistorical.requests);assert.equal(historical.cards,beforeHistorical.cards);
          if(evidence){
            await evaluate(`([...document.querySelectorAll('[aria-label="Separates historisches Arena-Ergebnis · UI-Fixture"] dd')].find(node=>node.innerText==='DEVELOPMENT_15BP_DAILY_NET_RETURNS_AND_HELD_TARGETS')).scrollIntoView({block:'center'})`);
            const image=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
            writeFileSync(join(evidence,`v11-m11-historical-${fixtureName}-${size.width}x${size.height}.png`),Buffer.from(image.data,'base64'));
          }
          await key('Enter','Enter',13);
          const technical=await evaluate(`(()=>{
            const disclosure=document.querySelector('[aria-label="Separates historisches Arena-Ergebnis · UI-Fixture"] details');
            return {open:disclosure.open,text:disclosure.innerText,
              overflow:document.documentElement.scrollWidth>innerWidth+1,
              summaryHeight:disclosure.querySelector('summary').getBoundingClientRect().height};
          })()`);
          assert.equal(technical.open,true);
          assert.match(technical.text,/protocolSha256/);
          assert.match(technical.text,/[a-f0-9]{64}/);
          assert.equal(technical.overflow,false);assert.ok(technical.summaryHeight>=44);
          if(evidence){
            await evaluate(`document.querySelector('[aria-label="Separates historisches Arena-Ergebnis · UI-Fixture"] details summary').scrollIntoView({block:'center'})`);
            const image=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
            writeFileSync(join(evidence,`v11-m11-historical-${fixtureName}-details-${size.width}x${size.height}.png`),Buffer.from(image.data,'base64'));
          }
          assert.equal(await evaluate(`document.querySelector('.arena-models').innerHTML===${JSON.stringify(beforeHistorical.cards)}`),true);
        }
        await evaluate(`(()=>{
          window.__m11StorageCalls=0;
          for(const method of ['setItem','removeItem','clear']){
            const original=Storage.prototype[method];
            Storage.prototype[method]=function(...args){
              window.__m11StorageCalls++;return original.apply(this,args);
            };
          }
        })()`);
        const beforeProducer=await evaluate(`({requests:performance.getEntriesByType('resource').length,
          cards:document.querySelector('.arena-models').innerHTML,storageCalls:window.__m11StorageCalls})`);
        const producerText=JSON.stringify(producerExport);
        await evaluate(`(()=>{
          const picker=document.querySelector('[data-arena-historical-export]'),transfer=new DataTransfer();
          transfer.items.add(new File([${JSON.stringify(producerText)}],
            'generated-producer-export.json',{type:'application/json'}));
          picker.files=transfer.files;picker.dispatchEvent(new Event('change',{bubbles:true}));
        })()`);
        for(let attempt=0;attempt<100;attempt++){
          if(await evaluate(`document.querySelector('[aria-label="Separates historisches Arena-Ergebnis · Producer-Export"]')?.innerText.includes('Lifecycle queued')`))break;
          await new Promise(resolve=>setTimeout(resolve,20));
        }
        const producer=await evaluate(`(()=>{
          const section=document.querySelector('[aria-label="Separates historisches Arena-Ergebnis · Producer-Export"]');
          const summary=section.querySelector('details summary');
          summary.focus();
          return {text:section.innerText,overflow:document.documentElement.scrollWidth>innerWidth+1 ||
              section.scrollWidth>section.clientWidth+1,
            summaryHeight:summary.getBoundingClientRect().height,
            focused:document.activeElement===summary,
            requests:performance.getEntriesByType('resource').length,
            cards:document.querySelector('.arena-models').innerHTML,
            storageCalls:window.__m11StorageCalls,
            inputLabel:section.querySelector('input').closest('label').innerText};
        })()`);
        assert.match(producer.text,/UNVERIFIED · Herkunft nicht bestätigt/);
        assert.match(producer.text,/CALLER_SUPPLIED_INSPECT_B1/);
        assert.match(producer.text,/NOT_ESTABLISHED/);
        assert.match(producer.text,/SYNTHETIC_ONLY/);
        assert.match(producer.text,/Lifecycle queued/);
        assert.match(producer.text,/Engine-Ergebnis\s+Nicht verfügbar/);
        assert.match(producer.text,/Screen\s+Nicht verfügbar/);
        assert.doesNotMatch(producer.text,/UI-Fixture|kein Producer-Export/);
        assert.match(producer.inputLabel,/Versionierten Producer-Export importieren/);
        assert.equal(producer.overflow,false);assert.ok(producer.summaryHeight>=44);
        assert.equal(producer.focused,true);
        assert.equal(producer.requests,beforeProducer.requests);assert.equal(producer.cards,beforeProducer.cards);
        assert.equal(producer.storageCalls,beforeProducer.storageCalls);
        await key('Enter','Enter',13);
        assert.equal(await evaluate(`document.querySelector('[aria-label="Separates historisches Arena-Ergebnis · Producer-Export"] [data-arena-result-section="provenance"]').open`),true);
        for(const producerCase of [
          {name:'completed',...completedProducer,state:'completed',screen:'SYNTHETIC_ONLY_NOT_ASSESSED'},
          {name:'insufficient',...insufficientProducer,state:'failed',screen:'INSUFFICIENT_EVIDENCE'}
        ]){
          const beforeImport=await evaluate(`({requests:performance.getEntriesByType('resource').length,
            cards:document.querySelector('.arena-models').innerHTML,storageCalls:window.__m11StorageCalls})`);
          const serialized=JSON.stringify(producerCase.envelope);
          await evaluate(`(()=>{
            window.__m11ImportRead={started:false,release:null};
            const file=new File([${JSON.stringify(serialized)}],
              'generated-producer-${producerCase.name}.json',{type:'application/json'});
            Object.defineProperty(file,'arrayBuffer',{value:()=>new Promise(resolve=>{
              window.__m11ImportRead.started=true;window.__m11ImportRead.release=resolve;
            })});
            const picker=document.querySelector('[data-arena-historical-export]'),transfer=new DataTransfer();
            picker.focus();
            transfer.items.add(file);
            picker.files=transfer.files;picker.dispatchEvent(new Event('change',{bubbles:true}));
          })()`);
          const loading=await evaluate(`(()=>{
            const section=document.querySelector('[aria-label="Separates historisches Arena-Ergebnis · Producer-Export"]');
            return {state:section.querySelector('[data-arena-result-state]').dataset.arenaResultState,
              text:section.innerText,focused:document.activeElement?.matches('[data-arena-historical-export]'),
              inputId:section.querySelector('[data-arena-historical-export]').id,
              inputDisabled:section.querySelector('[data-arena-historical-export]').disabled,
              hasComparison:!!section.querySelector('table tbody'),
              readStarted:window.__m11ImportRead.started};
          })()`);
          assert.equal(loading.state,'loading');
          assert.match(loading.text,/Producer-Export wird geprüft/);
          assert.equal(loading.focused,true);
          assert.match(loading.inputId,/^arena-producer-\d+-input$/);
          assert.equal(loading.inputDisabled,false);
          assert.equal(loading.hasComparison,false);
          assert.equal(loading.readStarted,true,'the result remains cleared while the controlled file read is pending');
          if(producerCase.name==='insufficient'){
            const prior=completedProducer.result.paths.find(path=>path.variantId==='primary-n30-f25'&&
              path.scenarioId==='base-15bp'&&path.segmentId==='diagnostic');
            assert.ok(!loading.text.includes(String(prior.netReturn)));
          }
          await evaluate(`window.__m11ImportRead.release(new TextEncoder().encode(${JSON.stringify(serialized)}).buffer)`);
          assert.equal(await waitForProducerText(`Lifecycle ${producerCase.state}`),true);
          assert.equal(await evaluate(`document.activeElement?.matches('[data-arena-historical-export]')`),true,
            'producer import preserves focus on the stable file input');
          for(const disclosure of ['paths','screen']){
            await evaluate(`document.querySelector('[data-arena-result-section="${disclosure}"] summary').focus()`);
            if(await evaluate(`document.querySelector('[data-arena-result-section="${disclosure}"]').open`))
              await key('Enter','Enter',13);
            await key('Enter','Enter',13);
            assert.equal(await evaluate(`document.querySelector('[data-arena-result-section="${disclosure}"]').open`),
              true,`${disclosure} disclosure opens through keyboard interaction`);
          }
          const imported=await evaluate(`(()=>{
            const section=document.querySelector('[aria-label="Separates historisches Arena-Ergebnis · Producer-Export"]');
            const summary=section.querySelector('details summary');
            const paths=section.querySelector('[data-arena-result-section="paths"]');
            const screen=section.querySelector('[data-arena-result-section="screen"]');
            const falseCheck=[...screen.querySelectorAll('div')].find(row=>
              row.querySelector('dt')?.innerText.trim()==='Primärer Ertrag mindestens beide eingefrorenen Controls');
            return {text:section.innerText,overflow:document.documentElement.scrollWidth>innerWidth+1 ||
                section.scrollWidth>section.clientWidth+1,summaryHeight:summary.getBoundingClientRect().height,
              pathsOpen:paths.open,screenOpen:screen.open,
              comparison:[...paths.querySelectorAll('tbody tr')].map(row=>
                [...row.cells].map(cell=>cell.innerText.trim())),
              falseCheck:falseCheck?.querySelector('dd')?.innerText.trim(),
              requests:performance.getEntriesByType('resource').length,
              cards:document.querySelector('.arena-models').innerHTML,
              storageCalls:window.__m11StorageCalls,
              fixtureStillSeparate:!!document.querySelector('[aria-label="Separates historisches Arena-Ergebnis · UI-Fixture"]')};
          })()`);
          assert.match(imported.text,/SYNTHETIC_ONLY · UNVERIFIED · Herkunft nicht bestätigt/);
          assert.match(imported.text,/CALLER_SUPPLIED_INSPECT_B1/);
          assert.match(imported.text,/NOT_ESTABLISHED/);
          assert.match(imported.text,new RegExp(`Lifecycle ${producerCase.state}`));
          assert.match(imported.text,new RegExp(`Engine-Ergebnis\\s+${producerCase.result.status}`));
          assert.match(imported.text,new RegExp(`Screen\\s+${producerCase.screen}`));
          assert.match(imported.text,producerCase.name==='completed'
            ?/Ergebnisse abgeschlossen\s+44[\s\S]*Pfade geplant\s+44/
            :/Ergebnisse abgeschlossen\s+19[\s\S]*Pfade geplant\s+44/);
          assert.equal(imported.pathsOpen,true);assert.equal(imported.screenOpen,true);
          if(producerCase.name==='completed'){
            const primary=producerCase.result.paths.find(path=>path.variantId==='primary-n30-f25'&&
              path.scenarioId==='base-15bp'&&path.segmentId==='diagnostic');
            assert.deepEqual(imported.comparison.find(row=>row[0]==='Baseline · Primär · Basis 15 bp'),
              ['Baseline · Primär · Basis 15 bp','COMPLETED',String(primary.netReturn),String(primary.sampledDrawdown)]);
            assert.deepEqual(imported.comparison.find(row=>row[0]==='Cash'),
              ['Cash','COMPLETED','0','0']);
            assert.equal(imported.falseCheck,'false');
          }else{
            assert.match(imported.text,/Nettoertrag\s+Nicht verfügbar/);
            assert.match(imported.text,/Relativer Drawdown-Rückgang \(Producerwert\)\s+Nicht verfügbar/);
          }
          assert.equal(imported.overflow,false);assert.ok(imported.summaryHeight>=44);
          assert.equal(imported.requests,beforeImport.requests);
          assert.equal(imported.cards,beforeImport.cards);
          assert.equal(imported.storageCalls,beforeImport.storageCalls);
          assert.equal(imported.fixtureStillSeparate,true);
          const explorerInitial=await evaluate(`(()=>{
            const explorer=document.querySelector('[data-arena-path-explorer]');
            return {ids:[...explorer.querySelectorAll('[data-arena-path-row]')].map(row=>row.dataset.arenaPathRow),
              checked:explorer.querySelectorAll('input:checked').length,
              detail:explorer.querySelector('[id$="-path-detail"]').innerText,
              filters:[...explorer.querySelectorAll('select')].map(node=>node.value),
              targets:[...explorer.querySelectorAll('select,button,input')].map(node=>node.getBoundingClientRect().height)};
          })()`);
          assert.deepEqual(explorerInitial.ids,producerCase.result.paths.map(path=>path.pathId));
          assert.equal(explorerInitial.checked,0,'a new report clears prior selection');
          assert.match(explorerInitial.detail,/Über „Details“ einen Pfad auswählen/);
          assert.deepEqual(explorerInitial.filters,['','','','']);
          assert.ok(explorerInitial.targets.every(height=>height>=44));
          const tableViewport=await evaluate(`(()=>{
            const region=document.querySelector('[id$="-path-table"]');
            region.focus();
            return {width:innerWidth,clientWidth:region.clientWidth,scrollWidth:region.scrollWidth,
              scrollable:region.scrollWidth>region.clientWidth,
              scrollLeft:region.scrollLeft,focused:document.activeElement===region,
              overflowX:getComputedStyle(region).overflowX,
              column:region.querySelector('th').getBoundingClientRect().width};
          })()`);
          assert.ok(tableViewport.column>=190,'path actions have a legible column at mobile widths');
          if(size.width<840){
            assert.equal(tableViewport.scrollable,true);
            const focusState=await evaluate(`(()=>{
              const region=document.querySelector('[id$="-path-table"]');
              region.focus();
              window.__pathTableArrowRight=null;
              region.addEventListener('keydown',event=>{
                if(event.key==='ArrowRight')window.__pathTableArrowRight={
                  key:event.key,code:event.code,targetIsRegion:event.target===region,
                  defaultPrevented:event.defaultPrevented};
              },{once:true});
              return {focused:document.activeElement===region,scrollLeft:region.scrollLeft,
                scrollWidth:region.scrollWidth,clientWidth:region.clientWidth};
            })()`);
            assert.equal(focusState.focused,true,'horizontal path region must receive focus before keyboard input');
            await key('ArrowRight','ArrowRight',39);
            const afterKeyboardScroll=await evaluate(`new Promise(resolve=>{
              const region=document.querySelector('[id$="-path-table"]');
              const started=performance.now(),timeoutMs=1200;
              const metrics=()=>({width:innerWidth,clientWidth:region.clientWidth,scrollWidth:region.scrollWidth,
                scrollLeft:region.scrollLeft,focused:document.activeElement===region,
                overflowX:getComputedStyle(region).overflowX,keyEvent:window.__pathTableArrowRight||null,
                elapsedMs:Math.round(performance.now()-started)});
              let timer;
              const finish=()=>{clearTimeout(timer);region.removeEventListener('scroll',onScroll);resolve(metrics());};
              const onScroll=()=>{if(region.scrollLeft>0)finish();};
              const inspect=()=>{
                if(region.scrollLeft>0||performance.now()-started>=timeoutMs)return finish();
                setTimeout(inspect,25);
              };
              timer=setTimeout(finish,timeoutMs);
              region.addEventListener('scroll',onScroll,{passive:true});
              inspect();
            })`);
            assert.equal(afterKeyboardScroll.focused,true,
              'ArrowRight must not move focus away from the scroll region: '+JSON.stringify(afterKeyboardScroll));
            assert.deepEqual(afterKeyboardScroll.keyEvent,
              {key:'ArrowRight',code:'ArrowRight',targetIsRegion:true,defaultPrevented:false},
              'the focused scroll region must receive an unhandled native ArrowRight event: '+JSON.stringify(afterKeyboardScroll));
            assert.ok(afterKeyboardScroll.scrollLeft>0,
              'native ArrowRight did not scroll the horizontally scrollable path region before the bounded timeout: '+
                JSON.stringify({focusState,tableViewport,afterKeyboardScroll}));
          }
          for(const dimension of ['segmentId','variantId','scenarioId','status']){
            for(const filterValue of new Set(producerCase.result.paths.map(path=>path[dimension]))){
              const filtered=await evaluate(`(()=>{
                const filter=document.querySelector('[data-arena-path-filter="${dimension}"]');
                filter.focus();filter.value=${JSON.stringify(filterValue)};
                filter.dispatchEvent(new Event('change',{bubbles:true}));
                return {ids:[...document.querySelectorAll('[data-arena-path-row]')].map(row=>row.dataset.arenaPathRow),
                  focused:document.activeElement?.dataset.arenaPathFilter===${JSON.stringify(dimension)}};
              })()`);
              assert.deepEqual(filtered.ids,producerCase.result.paths.filter(path=>path[dimension]===filterValue).map(path=>path.pathId));
              assert.equal(filtered.focused,true);
            }
            await evaluate(`document.querySelector('[data-arena-path-filter-reset]').click()`);
          }
          await evaluate(`document.querySelector('[data-arena-path-filter="segmentId"]').focus()`);
          await key('ArrowDown','ArrowDown',40);
          const keyboardFilter=await evaluate(`({
            value:document.querySelector('[data-arena-path-filter="segmentId"]').value,
            focused:document.activeElement?.dataset.arenaPathFilter==='segmentId'
          })`);
          assert.equal(keyboardFilter.value,producerCase.result.paths[0].segmentId);
          assert.equal(keyboardFilter.focused,true);
          await evaluate(`document.querySelector('[data-arena-path-filter-reset]').focus()`);
          await key('Enter','Enter',13);
          assert.equal(await evaluate(`document.activeElement?.hasAttribute('data-arena-path-filter-reset')`),true);
          const firstId=producerCase.result.paths[0].pathId;
          const secondId=producerCase.result.paths[3].pathId;
          await evaluate(`document.querySelector('[data-arena-path-select="${firstId}"]').focus()`);
          await key(' ','Space',32);
          assert.equal(await evaluate(`document.querySelector('[data-arena-path-select="${firstId}"]').checked`),true);
          assert.equal(await evaluate(`document.activeElement?.dataset.arenaPathSelect===${JSON.stringify(firstId)}`),true);
          await evaluate(`document.querySelector('[data-arena-path-select="${secondId}"]').focus()`);
          await key(' ','Space',32);
          const bounded=await evaluate(`(()=>{
            const explorer=document.querySelector('[data-arena-path-explorer]');
            const third=explorer.querySelector('input:not(:checked)');
            const disabled=third.disabled;
            third.checked=true;third.dispatchEvent(new Event('change',{bubbles:true}));
            return {disabled,selected:[...document.querySelectorAll('[aria-label^="Vergleichspfad "]')].map(node=>node.getAttribute('aria-label')),
              checked:document.querySelectorAll('[data-arena-path-select]:checked').length,
              text:document.querySelector('[data-arena-path-explorer]').innerText};
          })()`);
          assert.equal(bounded.disabled,true);
          assert.equal(bounded.checked,2);
          assert.deepEqual(bounded.selected,[firstId,secondId].map(id=>'Vergleichspfad '+id));
          assert.match(bounded.text,/Segmente: unterschiedlich · Szenarien: unterschiedlich/);
          const noMatch=await evaluate(`(()=>{
            const set=(key,value)=>{
              const filter=document.querySelector('[data-arena-path-filter="'+key+'"]');
              filter.value=value;filter.dispatchEvent(new Event('change',{bubbles:true}));
            };
            set('variantId','cash-zero');set('scenarioId','base-15bp');
            return {count:document.querySelector('[data-arena-path-count]').innerText,
              text:document.querySelector('[data-arena-path-explorer]').innerText,
              selected:document.querySelectorAll('[aria-label^="Vergleichspfad "]').length};
          })()`);
          assert.equal(noMatch.count,'0 von 44 Pfaden angezeigt.');
          assert.match(noMatch.text,/Keine Pfade entsprechen den Filtern/);
          assert.equal(noMatch.selected,2);
          await evaluate(`document.querySelector('[data-arena-path-filter-reset]').click()`);
          await evaluate(`document.querySelector('[data-arena-path-detail="${firstId}"]').focus()`);
          await key('Enter','Enter',13);
          const detailState=await evaluate(`(()=>{
            const detail=document.querySelector('[id$="-path-detail"]');
            return {focused:document.activeElement===detail.querySelector('h5'),
              quarters:[...detail.querySelectorAll('tbody tr')].map(row=>[...row.cells].map(cell=>cell.innerText)),
              titles:[...detail.querySelectorAll('svg g title')].map(node=>node.textContent),
              text:detail.innerText,
              overflow:document.documentElement.scrollWidth>innerWidth+1 ||
                document.querySelector('[data-arena-path-explorer]').scrollWidth>document.querySelector('[data-arena-path-explorer]').clientWidth+1};
          })()`);
          assert.equal(detailState.focused,true);
          assert.equal(detailState.overflow,false);
          assert.deepEqual(detailState.quarters,producerCase.result.paths[0].quarterlyReturns.map(item=>[item.quarter,String(item.netReturn)]));
          assert.deepEqual(detailState.titles,producerCase.result.paths[0].quarterlyReturns.map(item=>item.quarter+': '+String(item.netReturn)));
          for(const [label,field] of [['Kosten','totalCosts'],['Umsatznotional','turnoverNotional'],
            ['Mittlere realisierte Exposition','meanRealizedExposure'],['Maximale Drawdown-Dauer','maxDrawdownDuration']]){
            assert.ok(detailState.text.includes(label+'\n'+String(producerCase.result.paths[0][field])));
          }
          if(evidence){
            await evaluate(`document.querySelector('[id$="-path-detail"] figure').scrollIntoView({block:'center'})`);
            const image=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
            writeFileSync(join(evidence,`v11-b14-detail-${producerCase.name}-${size.width}x${size.height}.png`),Buffer.from(image.data,'base64'));
            await evaluate(`document.querySelector('[aria-label^="Vergleichspfad "]').parentElement.scrollIntoView({block:'start'})`);
            const comparison=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
            writeFileSync(join(evidence,`v11-b14-comparison-${producerCase.name}-${size.width}x${size.height}.png`),Buffer.from(comparison.data,'base64'));
            await evaluate(`document.querySelector('[data-arena-path-explorer]').scrollIntoView({block:'start'})`);
            const filters=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
            writeFileSync(join(evidence,`v11-b14-explorer-${producerCase.name}-${size.width}x${size.height}.png`),Buffer.from(filters.data,'base64'));
          }
          await evaluate(`document.querySelector('[data-arena-path-selection-reset]').focus()`);
          await key('Enter','Enter',13);
          assert.equal(await evaluate(`document.querySelectorAll('[data-arena-path-select]:checked').length`),0);
          assert.equal(await evaluate(`document.activeElement?.hasAttribute('data-arena-path-selection-reset')`),true);
          // Leave a selection and filter behind to verify that the next import clears both.
          await evaluate(`(()=>{
            document.querySelector('[data-arena-path-select="${firstId}"]').click();
            const filter=document.querySelector('[data-arena-path-filter="segmentId"]');
            filter.value='development';filter.dispatchEvent(new Event('change',{bubbles:true}));
          })()`);
          await evaluate(`document.querySelector('[data-arena-result-section="technical"] summary').focus()`);
          if(await evaluate(`document.querySelector('[data-arena-result-section="technical"]').open`))
            await key('Enter','Enter',13);
          await key('Enter','Enter',13);
          const technicalState=await evaluate(`(()=>{
            const panel=document.querySelector('[data-arena-result-section="technical"]');
            return {open:panel.open,focused:document.activeElement===panel.querySelector('summary'),
              identity:panel.innerText.includes('protocolSha256'),
              rawResult:[...panel.querySelectorAll('h5')].find(heading=>
                heading.innerText==='Ergebnis · unveränderter Producertext')?.nextElementSibling?.innerText};
          })()`);
          assert.equal(technicalState.open,true);
          assert.equal(technicalState.focused,true);
          assert.equal(technicalState.identity,true);
          assert.equal(technicalState.rawResult,producerCase.envelope.job.result);
          if(producerCase.name==='completed'){
            const beforeArenaImport=await evaluate(`({requests:performance.getEntriesByType('resource').length,
              cards:document.querySelector('.arena-models').innerHTML})`);
            await evaluate(`(()=>{
              const picker=document.querySelector('[data-arena-input]'),transfer=new DataTransfer();
              transfer.items.add(new File(['{}'],'invalid-independent-arena.json',{type:'application/json'}));
              picker.files=transfer.files;picker.dispatchEvent(new Event('change',{bubbles:true}));
            })()`);
            for(let attempt=0;attempt<100;attempt++){
              if(await evaluate(`!!document.querySelector('#strategy-arena-root [role="alert"]')`))break;
              await new Promise(resolve=>setTimeout(resolve,20));
            }
            const retained=await evaluate(`(()=>{
              const panel=document.querySelector('[data-arena-result-section="technical"]');
              return {open:panel.open,focused:document.activeElement===panel.querySelector('summary'),
                lifecycle:document.querySelector('[data-arena-result-state="present"] [role="status"]')?.innerText,
                requests:performance.getEntriesByType('resource').length,
                cards:document.querySelector('.arena-models').innerHTML};
            })()`);
            assert.equal(retained.open,true);
            assert.equal(retained.focused,true);
            assert.match(retained.lifecycle,/Lifecycle completed/);
            assert.equal(retained.requests,beforeArenaImport.requests);
            assert.equal(retained.cards,beforeArenaImport.cards);
          }
        }
        const invalidProducer=structuredClone(completedProducer.envelope);
        invalidProducer.payloadSha256='0'.repeat(64);
        const invalidProducerText=JSON.stringify(invalidProducer);
        await evaluate(`(()=>{
          const picker=document.querySelector('[data-arena-historical-export]'),transfer=new DataTransfer();
          transfer.items.add(new File([${JSON.stringify(invalidProducerText)}],
            'invalid-generated-producer.json',{type:'application/json'}));
          picker.files=transfer.files;picker.dispatchEvent(new Event('change',{bubbles:true}));
        })()`);
        assert.equal(await waitForProducerAlert('Export konnte nicht angenommen werden.'),true);
        const rejectedProducer=await evaluate(`(()=>{
          const section=document.querySelector('[aria-label="Separates historisches Arena-Ergebnis · Producer-Export"]');
          const alert=section.querySelector('[role="alert"]');
          return {alertRole:alert?.getAttribute('role'),alertText:alert?.innerText,text:section.innerText};
        })()`);
        assert.equal(rejectedProducer.alertRole,'alert');
        assert.match(rejectedProducer.alertText,/Export konnte nicht angenommen werden\. Kein Ergebnis wird angezeigt\./);
        assert.doesNotMatch(rejectedProducer.text,/Lifecycle (completed|failed)|Engine-Ergebnis\s+COMPLETED|Screen\s+SYNTHETIC_ONLY_NOT_ASSESSED|Cash\s+COMPLETED/);
        const delayedProducerText=JSON.stringify(completedProducer.envelope);
        await evaluate(`(()=>{
          const state=window.__m11DelayedRead={started:false,release:null,digestCalls:0,digestSettled:0};
          const originalDigest=crypto.subtle.digest.bind(crypto.subtle);
          state.originalDigest=originalDigest;
          state.finished=new Promise(resolve=>{state.resolveFinished=resolve;});
          crypto.subtle.digest=(...args)=>{
            state.digestCalls++;
            return originalDigest(...args).then(value=>{
              state.digestSettled++;
              if(state.digestCalls===7&&state.digestSettled===7){
                const channel=new MessageChannel();
                channel.port1.onmessage=()=>{
                  channel.port1.close();channel.port2.close();state.resolveFinished();
                };
                channel.port2.postMessage('digests-settled');
              }
              return value;
            });
          };
          const file=new File([${JSON.stringify(delayedProducerText)}],
            'delayed-generated-producer.json',{type:'application/json'});
          Object.defineProperty(file,'arrayBuffer',{value:()=>new Promise(resolve=>{
            window.__m11DelayedRead.started=true;window.__m11DelayedRead.release=resolve;
          })});
          const picker=document.querySelector('[data-arena-historical-export]'),transfer=new DataTransfer();
          transfer.items.add(file);picker.files=transfer.files;picker.dispatchEvent(new Event('change',{bubbles:true}));
        })()`);
        assert.equal(await evaluate('window.__m11DelayedRead.started'),true);
        await evaluate(`(()=>{
          const file=new File(['{}'],'unreadable-generated-producer.json',{type:'application/json'});
          Object.defineProperty(file,'arrayBuffer',{value:()=>Promise.reject(Error('synthetic read failure'))});
          const picker=document.querySelector('[data-arena-historical-export]'),transfer=new DataTransfer();
          transfer.items.add(file);picker.files=transfer.files;picker.dispatchEvent(new Event('change',{bubbles:true}));
        })()`);
        assert.equal(await waitForProducerAlert('Export konnte nicht angenommen werden.'),true);
        await evaluate(`window.__m11DelayedRead.release(new TextEncoder().encode(${JSON.stringify(delayedProducerText)}).buffer)`);
        await evaluate('window.__m11DelayedRead.finished');
        const afterStaleRead=await evaluate(`(()=>{
          const section=document.querySelector('[aria-label="Separates historisches Arena-Ergebnis · Producer-Export"]');
          const alert=section.querySelector('[role="alert"]');
          crypto.subtle.digest=window.__m11DelayedRead.originalDigest;
          return {alertRole:alert?.getAttribute('role'),alertText:alert?.innerText,text:section.innerText,
            digestCalls:window.__m11DelayedRead.digestCalls,digestSettled:window.__m11DelayedRead.digestSettled};
        })()`);
        assert.equal(afterStaleRead.digestCalls,7);
        assert.equal(afterStaleRead.digestSettled,7);
        assert.equal(afterStaleRead.alertRole,'alert');
        assert.match(afterStaleRead.alertText,/Export konnte nicht angenommen werden\. Kein Ergebnis wird angezeigt\./);
        assert.doesNotMatch(afterStaleRead.text,/Lifecycle completed|Engine-Ergebnis\s+COMPLETED/);
        const hostilePresentation=await evaluate(`(async()=>{
          const {renderArenaResultView}=await import('/v11/arena-result-view.js?v=B16-M11-FIX11');
          const hostile='"><img src=x onerror="alert(1)">'+ 'identity'.repeat(60);
          const root=document.createElement('div');
          root.style.cssText='max-width:100%;min-width:0';
          document.getElementById('strategy-arena-root').append(root);
          // Deliberately hostile presentation input, not an accepted producer export.
          const path={pathId:hostile,kind:hostile,variantId:hostile,segmentId:hostile,
            scenarioId:hostile,status:hostile,computed:false,attempts:0,
            quarterlyReturns:[{quarter:hostile,netReturn:-0.123456789},{quarter:'zero',netReturn:0}]};
          root.innerHTML=renderArenaResultView({idPrefix:'hostile-preview',projection:{
            status:'PRESENT_UNVERIFIED',provenance:{syntheticFixture:true},
            job:{state:'completed',paths:[]},result:{paths:[path]}},
            explorer:{selectedPathIds:[hostile],detailPathId:hostile}});
          const result={unsafe:!!root.querySelector('img,script'),overflow:root.scrollWidth>root.clientWidth+1 ||
              document.documentElement.scrollWidth>innerWidth+1,
            exact:root.querySelector('tbody th')?.textContent.includes(hostile),
            columns:root.querySelector('table th').getBoundingClientRect().width};
          root.remove();return result;
        })()`);
        assert.equal(hostilePresentation.unsafe,false);
        assert.equal(hostilePresentation.overflow,false);
        assert.equal(hostilePresentation.exact,true);
        assert.ok(hostilePresentation.columns>=190);
        if(size.width===320){
          const disposal=await evaluate(`(async()=>{
            const {createStrategyArenaView}=await import('/v11/strategy-arena.js?v=B16-M11-FIX11');
            const existingIds=new Set([...document.querySelectorAll('#strategy-arena-root [id^="arena-producer-"]')].map(node=>node.id));
            const root=document.createElement('div');document.body.append(root);
            const view=createStrategyArenaView(root,{fetchImpl:async()=>{throw Error('synthetic provenance read failure');}});
            const uniqueIds=[...root.querySelectorAll('[id^="arena-producer-"]')]
              .every(node=>!existingIds.has(node.id));
            const button=root.querySelector('[data-arena-provenance]');
            button.focus();button.click();
            await new Promise(resolve=>setTimeout(resolve,0));
            const toolbarFocusRetained=document.activeElement?.id===button.id;
            const file=new File([${JSON.stringify(delayedProducerText)}],
              'disposed-generated-producer.json',{type:'application/json'});
            let release;
            Object.defineProperty(file,'arrayBuffer',{value:()=>new Promise(resolve=>{release=resolve;})});
            const picker=root.querySelector('[data-arena-historical-export]'),transfer=new DataTransfer();
            transfer.items.add(file);picker.files=transfer.files;picker.dispatchEvent(new Event('change',{bubbles:true}));
            view.dispose();
            release(new TextEncoder().encode(${JSON.stringify(delayedProducerText)}).buffer);
            await new Promise(resolve=>setTimeout(resolve,50));
            const result=root.innerHTML;
            root.remove();
            return {result,uniqueIds,toolbarFocusRetained};
          })()`);
          assert.equal(disposal.result,'');
          assert.equal(disposal.uniqueIds,true);
          assert.equal(disposal.toolbarFocusRetained,true);
        }
        const navClear=await evaluate(`(()=>{const root=document.documentElement,section=document.querySelector('#strategy-arena-root');window.scrollTo(0,root.scrollHeight);return section.lastElementChild.getBoundingClientRect().bottom<=document.getElementById('nav').getBoundingClientRect().top+1;})()`);
        assert.equal(navClear,true);

        await evaluate(`document.querySelector('#strategy-catalog [data-strategy-id="H1"] summary').focus()`);
        await key('Enter','Enter',13);
        assert.equal(await evaluate(`document.querySelector('#strategy-catalog [data-strategy-id="H1"] details').open`),true);
        assert.match(await evaluate(`document.querySelector('#strategy-catalog [data-strategy-id="H1"] details').innerText`),/Hindernis/);
        await evaluate(`document.querySelector('#strategy-catalog [data-strategy-id="H1"] summary').click()`);

        await evaluate(`(()=>{
          window.__m11InvalidSnapshotRead={started:false,release:null};
          const file=new File(['{}'],'malformed-arena.json',{type:'application/json'});
          Object.defineProperty(file,'text',{value:()=>new Promise(resolve=>{
            window.__m11InvalidSnapshotRead.started=true;
            window.__m11InvalidSnapshotRead.release=resolve;
          })});
          const picker=document.querySelector('[data-arena-input]');
          const transfer=new DataTransfer();
          transfer.items.add(file);
          picker.files=transfer.files;picker.dispatchEvent(new Event('change',{bubbles:true}));
        })()`);
        for(let attempt=0;attempt<100;attempt++){
          if(await evaluate(`window.__m11InvalidSnapshotRead?.started`))break;
          await new Promise(resolve=>setTimeout(resolve,20));
        }
        assert.equal(await evaluate(`window.__m11InvalidSnapshotRead?.started`),true,
          'malformed snapshot read is held for deterministic lifecycle assertions');
        const snapshotBusy=await evaluate(`({
          status:document.querySelector('#strategy-arena-root .strategy-arena > [role="status"]')?.innerText,
          disabled:document.querySelector('#strategy-arena-root [data-arena-input]')?.disabled,
          producerAlert:!!document.querySelector('[aria-label="Separates historisches Arena-Ergebnis · Producer-Export"] [role="alert"]')
        })`);
        assert.match(snapshotBusy.status,/Snapshot wird geprüft/);
        assert.equal(snapshotBusy.disabled,true);
        assert.equal(snapshotBusy.producerAlert,true);
        await evaluate(`window.__m11InvalidSnapshotRead.release('{}')`);
        for(let attempt=0;attempt<100;attempt++){
          if(await evaluate(`!!document.querySelector('#strategy-arena-root .strategy-arena > [role="alert"]') &&
            !document.querySelector('#strategy-arena-root [data-arena-input]')?.disabled`))break;
          await new Promise(resolve=>setTimeout(resolve,20));
        }
        const snapshotFailure=await evaluate(`({
          alert:document.querySelector('#strategy-arena-root .strategy-arena > [role="alert"]')?.innerText,
          disabled:document.querySelector('#strategy-arena-root [data-arena-input]')?.disabled,
          producerAlert:!!document.querySelector('[aria-label="Separates historisches Arena-Ergebnis · Producer-Export"] [role="alert"]')
        })`);
        assert.ok(snapshotFailure.alert,'malformed snapshot reports its own visible error');
        assert.equal(snapshotFailure.disabled,false,'snapshot input is re-enabled after validation');
        assert.equal(snapshotFailure.producerAlert,true,'producer-export rejection remains separate');

        const payload=JSON.stringify(syntheticPayload());
        await evaluate(`(()=>{
          const picker=document.querySelector('[data-arena-input]');
          const transfer=new DataTransfer();
          transfer.items.add(new File([${JSON.stringify(payload)}],'synthetic-arena.json',{type:'application/json'}));
          picker.files=transfer.files;picker.dispatchEvent(new Event('change',{bubbles:true}));
        })()`);
        for(let attempt=0;attempt<200;attempt++){
          if(await evaluate(`document.querySelector('#strategy-arena-root .arena-evidence')?.innerText.includes('SYNTHETISCHE TESTDATEN')`))break;
          await new Promise(resolve=>setTimeout(resolve,25));
        }
        const arena=await evaluate(`(()=>{
          const root=document.documentElement;
          return {notice:document.querySelector('#strategy-arena-root .arena-evidence')?.innerText,
            cards:[...document.querySelectorAll('#strategy-arena-root .arena-model-card')].length,
            h9:document.querySelector('#strategy-arena-root').innerText.includes('BLOCKED_DATA'),
            overflow:root.scrollWidth>innerWidth+1,
            bottom:(()=>{window.scrollTo(0,root.scrollHeight);const last=document.getElementById('strategy-arena-root').lastElementChild.getBoundingClientRect();const nav=document.getElementById('nav').getBoundingClientRect();return last.bottom<=nav.top+1;})(),
            network:performance.getEntriesByType('resource').map(row=>row.name)};
        })()`);
        assert.match(arena.notice,/SYNTHETISCHE TESTDATEN · KEINE MARKTEVIDENZ/);
        assert.equal(arena.cards,5);assert.equal(arena.h9,true);assert.equal(arena.overflow,false);assert.equal(arena.bottom,true);
        assert.ok(arena.network.every(url=>new URL(url).origin===new URL(hosted.url).origin),'no external or market requests');
        if(evidence){
          await evaluate(`document.querySelector('#strategy-arena-root .arena-model-card').scrollIntoView({block:'start'})`);
          const image=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
          writeFileSync(join(evidence,`v11-b12-arena-${size.width}x${size.height}-synthetic.png`),Buffer.from(image.data,'base64'));
        }

        await evaluate(`document.querySelector('#nav button[data-v="command"]').click()`);
        await evaluate(`document.querySelector('#nav button[data-v="strategies"]').click()`);
        assert.equal(await evaluate(`document.querySelector('.view.active').id`),'view-strategies',
          'the consolidated navigation opens strategies from Command');
        assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth+1`),true);
        const requestPaths=hosted.requests.map(request=>request.path);
        assert.ok(!requestPaths.some(path=>/\/v10\/|\/api\/|\/klines|\/ticker|\/market/i.test(path)));
        return {width:size.width,sourceFetches:requestPaths.filter(path=>path==='/docs/strategy-lab/campaign-20261013.json').length,
          families:catalog.families,models:arena.cards,overflow:catalog.overflow,synthetic:true,
          explorerPaths:44,selectionLimit:2,quarterlyValues:'producer-exact',importReset:true,
          paperReadiness:{groups:3,choices:12,activationActions:0,overflow:false}};
      },size.height);
      assert.equal(metrics.sourceFetches-previousSourceRequests,1);
      assert.equal(metrics.families,12);
      assert.equal(metrics.models,5);
      console.log('V11_B12_SIZE',`${size.width}x${size.height}`,JSON.stringify(metrics));
    }
  }finally{await new Promise(resolve=>hosted.server.close(resolve));}
});

