import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,normalize,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {parseArenaHistoricalResultFixture} from '../v11/arena-historical-result.js';
import {ARENA_SYMBOLS} from '../research/strategy-paper-arena.js';
import {withMobileChrome} from './helpers/v11-cdp.mjs';

const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium'].find(path=>path&&existsSync(path));
const repository=fileURLToPath(new URL('../',import.meta.url));
const v11=join(repository,'v11');
const sizes=[{width:320,height:568,mobile:true},{width:375,height:667,mobile:true},
  {width:390,height:844,mobile:true},{width:1440,height:900,mobile:false}];

function staticServer(){
  const requests=[];
  const server=createServer((request,response)=>{
    const url=new URL(request.url,'http://localhost');
    requests.push({method:request.method,path:url.pathname});
    if(request.method!=='GET'){response.writeHead(405);response.end();return;}
    const roots=[['/v11/',v11],['/research/',join(repository,'research')],['/docs/',join(repository,'docs')]];
    const match=roots.find(([prefix])=>url.pathname.startsWith(prefix));
    if(!match){response.writeHead(404);response.end();return;}
    const [prefix,root]=match;
    const path=normalize(join(root,decodeURIComponent(url.pathname.slice(prefix.length))));
    if(path!==root&&!path.startsWith(root.endsWith(sep)?root:root+sep)){response.writeHead(404);response.end();return;}
    try{
      const body=readFileSync(path);
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

test('M11 Strategies native shell, synthetic Arena and responsive evidence at four widths',{timeout:240000},async()=>{
  const completed=historicalUiFixture();
  const insufficientScreen=historicalUiFixture({screenStatus:'INSUFFICIENT_EVIDENCE'});
  assert.equal(parseArenaHistoricalResultFixture(JSON.stringify(completed)).status,'PRESENT_UNVERIFIED');
  assert.equal(parseArenaHistoricalResultFixture(JSON.stringify(insufficientScreen)).status,'PRESENT_UNVERIFIED');
  if(typeof WebSocket!=='function'){
    const env={...process.env};delete env.NODE_TEST_CONTEXT;
    const child=spawnSync(process.execPath,['--experimental-websocket',fileURLToPath(import.meta.url)],
      {env,encoding:'utf8',timeout:235000});
    assert.equal(child.status,0,String(child.stdout).slice(-2500)+String(child.stderr).slice(-1000));
    const rows=child.stdout.split('\n').filter(line=>line.startsWith('V11_B12_SIZE '));
    assert.equal(rows.length,4);rows.forEach(row=>console.log(row));return;
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
          assert.ok(!result.exceptionDetails,'M11 strategy page expression failed');
          return result.result?.value;
        };
        const key=async(name,code,keyCode)=>{
          const text=name==='Enter'?'\r':null;
          await call('Input.dispatchKeyEvent',{type:'keyDown',key:name,code,windowsVirtualKeyCode:keyCode,
            ...(text===null?{}:{text,unmodifiedText:text})});
          await call('Input.dispatchKeyEvent',{type:'keyUp',key:name,code,windowsVirtualKeyCode:keyCode});
        };
        await call('Emulation.setDeviceMetricsOverride',{width:size.width,height:size.height,
          deviceScaleFactor:1,mobile:size.mobile,screenWidth:size.width,screenHeight:size.height});
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
        const catalog=await evaluate(`(()=>{
          const root=document.documentElement,view=document.getElementById('view-strategies');
          return {visible:!view.hidden,active:document.querySelector('.view.active').id,
            current:[...document.querySelectorAll('#nav [aria-current="page"]')].map(button=>button.dataset.v),
            families:[...document.querySelectorAll('#strategy-catalog [data-strategy-id^="H"]')].length,
            candidate:document.querySelector('[data-strategy-id="B1-7"]')?.innerText,
            h9:document.querySelector('[data-strategy-id="H9"]')?.innerText,
            models:[...document.querySelectorAll('.arena-model-card')].map(card=>card.innerText),
            overflow:root.scrollWidth>innerWidth+1,
            controls:[...document.querySelectorAll('#strategy-catalog details summary,#strategy-arena-root button,#strategy-arena-root input')].map(node=>node.getBoundingClientRect().height),
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
        assert.ok(catalog.controls.every(height=>height>=44));
        assert.ok(catalog.resources.every(path=>!/\/v10\/|\/api\/|\/market|\/ticker|\/klines/i.test(path)));
        assert.ok(catalog.resources.includes('/docs/strategy-lab/campaign-20261013.json'));
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
        const navClear=await evaluate(`(()=>{const root=document.documentElement,section=document.querySelector('#strategy-arena-root');window.scrollTo(0,root.scrollHeight);return section.lastElementChild.getBoundingClientRect().bottom<=document.getElementById('nav').getBoundingClientRect().top+1;})()`);
        assert.equal(navClear,true);

        await evaluate(`document.querySelector('#strategy-catalog [data-strategy-id="H1"] summary').focus()`);
        await key('Enter','Enter',13);
        assert.equal(await evaluate(`document.querySelector('#strategy-catalog [data-strategy-id="H1"] details').open`),true);
        assert.match(await evaluate(`document.querySelector('#strategy-catalog [data-strategy-id="H1"] details').innerText`),/Hindernis/);
        await evaluate(`document.querySelector('#strategy-catalog [data-strategy-id="H1"] summary').click()`);

        await evaluate(`(()=>{
          const picker=document.querySelector('[data-arena-input]');
          const transfer=new DataTransfer();
          transfer.items.add(new File(['{}'],'malformed-arena.json',{type:'application/json'}));
          picker.files=transfer.files;picker.dispatchEvent(new Event('change',{bubbles:true}));
        })()`);
        for(let attempt=0;attempt<100;attempt++){
          if(await evaluate(`document.querySelector('#strategy-arena-root [role="alert"]')?.innerText`))break;
          await new Promise(resolve=>setTimeout(resolve,20));
        }
        assert.ok(await evaluate(`document.querySelector('#strategy-arena-root [role="alert"]')?.innerText`),
          'malformed import exposes a visible error instead of results');

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
        await evaluate(`document.querySelector('.command-open-strategies').click()`);
        assert.equal(await evaluate(`document.querySelector('.view.active').id`),'view-strategies',
          'Command offers direct native navigation to strategies');
        assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth+1`),true);
        const requestPaths=hosted.requests.map(request=>request.path);
        assert.ok(!requestPaths.some(path=>/\/v10\/|\/api\/|\/klines|\/ticker|\/market/i.test(path)));
        return {width:size.width,sourceFetches:requestPaths.filter(path=>path==='/docs/strategy-lab/campaign-20261013.json').length,
          families:catalog.families,models:arena.cards,overflow:catalog.overflow,synthetic:true};
      },size.height);
      assert.equal(metrics.sourceFetches-previousSourceRequests,1);
      assert.equal(metrics.families,12);
      assert.equal(metrics.models,5);
      console.log('V11_B12_SIZE',`${size.width}x${size.height}`,JSON.stringify(metrics));
    }
  }finally{await new Promise(resolve=>hosted.server.close(resolve));}
});
