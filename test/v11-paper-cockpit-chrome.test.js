import assert from 'node:assert/strict';
import {test} from 'node:test';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {withMobileChrome} from './helpers/v11-cdp.mjs';
import {unlockAppThroughGate} from './helpers/v11-app-access-browser.mjs';
import {startV11StaticServer} from './helpers/v11-static-server.mjs';
import {projectOperatorReport} from '../scripts/memecoin-paper/operator-report.mjs';
import {reportFixtures} from './fixtures/memecoin-paper-operator-report/scenarios.mjs';
import {PAPER_REPORT_ENVELOPE_SCHEMA} from '../scripts/memecoin-paper-report-bridge/index.mjs';
import {PAPER_REPORT_ENDPOINT} from '../v11/paper-cockpit-controller.js';

const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium'].find(path=>path&&existsSync(path));
const sizes=[
  {width:320,height:568,mobile:true},{width:375,height:667,mobile:true},
  {width:390,height:844,mobile:true},{width:430,height:932,mobile:true},
  {width:1440,height:900,mobile:false}
];
const evidence=process.env.V11_PAPER_COCKPIT_EVIDENCE_DIR;
const PAPER_PASSWORD='synthetic-browser-gate-password';

async function interceptGeneratedPaperReport(call,report){
  const body=Buffer.from(JSON.stringify({
    schema:PAPER_REPORT_ENVELOPE_SCHEMA,runId:report.experiment.id,report
  })).toString('base64');
  let reads=0,failure=null;
  const off=call.onEvent('Fetch.requestPaused',event=>{
    void (async()=>{
      assert.equal(event.request.url,PAPER_REPORT_ENDPOINT);
      if(event.request.method==='OPTIONS'){
        await call('Fetch.fulfillRequest',{requestId:event.requestId,responseCode:204,responseHeaders:[
          {name:'Access-Control-Allow-Origin',value:'*'},
          {name:'Access-Control-Allow-Methods',value:'GET'},
          {name:'Access-Control-Allow-Headers',value:'accept,authorization'},
          {name:'Access-Control-Max-Age',value:'0'}]});
        return;
      }
      assert.equal(event.request.method,'GET');
      const authorization=Object.entries(event.request.headers||{})
        .find(([name])=>name.toLowerCase()==='authorization')?.[1];
      assert.equal(authorization,'Bearer '+PAPER_PASSWORD);
      reads++;
      await call('Fetch.fulfillRequest',{requestId:event.requestId,responseCode:200,responseHeaders:[
        {name:'Access-Control-Allow-Origin',value:'*'},
        {name:'Content-Type',value:'application/json; charset=utf-8'},
        {name:'Cache-Control',value:'no-store'}],body});
    })().catch(error=>{failure=error;});
  });
  await call('Fetch.enable',{patterns:[{urlPattern:PAPER_REPORT_ENDPOINT+'*',requestStage:'Request'}]});
  return {
    count:()=>reads,
    assertHealthy(){if(failure)throw failure;},
    async close(){off();await call('Fetch.disable');}
  };
}

test('M11 Paper cockpit demo is responsive and keyboard accessible at five widths',{timeout:240000},async()=>{
  if(typeof WebSocket!=='function'){
    const env={...process.env};delete env.NODE_TEST_CONTEXT;
    const child=spawnSync(process.execPath,['--experimental-websocket',fileURLToPath(import.meta.url)],
      {env,encoding:'utf8',timeout:235000});
    assert.equal(child.status,0,String(child.stdout).slice(-2500)+String(child.stderr).slice(-1000));
    const rows=child.stdout.split('\n').filter(line=>line.startsWith('V11_PAPER_COCKPIT_SIZE '));
    assert.equal(rows.length,sizes.length);rows.forEach(row=>console.log(row));return;
  }
  assert.ok(chrome,'Chrome required; cockpit browser acceptance cannot be skipped');
  const hosted=await startV11StaticServer();
  try{
    for(const size of sizes){
      const metrics=await withMobileChrome(chrome,size.width,hosted.url,async call=>{
        const evaluate=async expression=>{
          const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
          assert.ok(!result.exceptionDetails,'browser expression exception: '+JSON.stringify(result.exceptionDetails));
          return result.result?.value;
        };
        const key=async(name,code,keyCode,modifiers=0)=>{
          const text=name==='Enter'?'\r':name===' '?' ':null;
          await call('Input.dispatchKeyEvent',{type:'keyDown',key:name,code,windowsVirtualKeyCode:keyCode,modifiers,
            ...(text===null?{}:{text,unmodifiedText:text})});
          await call('Input.dispatchKeyEvent',{type:'keyUp',key:name,code,windowsVirtualKeyCode:keyCode,modifiers});
        };
        await call('Emulation.setDeviceMetricsOverride',{width:size.width,height:size.height,
          deviceScaleFactor:1,mobile:size.mobile,screenWidth:size.width,screenHeight:size.height});
        await unlockAppThroughGate(call);
        const report=projectOperatorReport(reportFixtures.readOnlyCheckpoint());
        report.evidence.observedThrough=new Date().toISOString();
        report.valuation.cashCents='90071992547409931234';
        const intercepted=await interceptGeneratedPaperReport(call,report);
        await evaluate(`document.querySelector('#nav button[data-v="strategies"]').click()`);
        assert.equal(intercepted.count(),0,'unlock and navigation do not read a Paper report');
        for(let attempt=0;attempt<150;attempt++){
          if(await evaluate(`document.querySelector('#paper-cockpit-root.paper-cockpit') !== null`))break;
          await new Promise(resolve=>setTimeout(resolve,10));
        }
        const liveRead=await evaluate(`(()=>{
          const button=document.querySelector('#paper-cockpit-root button');
          return button?{text:button.textContent,height:button.getBoundingClientRect().height,
            disabled:button.disabled}:null;
        })()`);
        assert.ok(liveRead,'native browser module graph mounts the real controller');
        assert.equal(liveRead.height>=44,true,'manual report read target is at least 44px');
        assert.equal(intercepted.count(),0,'controller mount remains a no-read operation');
        await evaluate(`document.querySelector('#paper-cockpit-root button').click()`);
        for(let attempt=0;attempt<150;attempt++){
          if(await evaluate(`document.querySelector('#paper-cockpit-root').textContent.includes('Observation-only')`))break;
          await new Promise(resolve=>setTimeout(resolve,10));
        }
        intercepted.assertHealthy();
        assert.equal(intercepted.count(),1,'one click produces exactly one generated-report GET');
        const delivered=await evaluate(`(()=>{
          const root=document.querySelector('#paper-cockpit-root');
          return {report:root.textContent.includes('Observation-only'),
            exactCash:root.textContent.includes('90071992547409931234 cents'),
            terminal:root.textContent.includes('Terminal report: INCOMPLETE'),
            noWorkerClaim:!root.textContent.includes('RUNNING')};
        })()`);
        assert.deepEqual(delivered,{report:true,exactCash:true,terminal:true,noWorkerClaim:true});
        await evaluate(`document.querySelector('#nav button[data-v="command"]').click()`);
        assert.equal(await evaluate(`!document.querySelector('#paper-cockpit-root').textContent.includes('Observation-only')`),true,
          'navigation clears private report DOM');
        await evaluate(`document.querySelector('#nav button[data-v="strategies"]').click()`);
        assert.equal(intercepted.count(),1,'returning to the cockpit does not read automatically');
        await intercepted.close();
        await evaluate(`(async()=>{
          const model=await import('./paper-cockpit-model.js?v=B16-M11-FIX12');
          const view=await import('./paper-cockpit-view.js?v=B16-M11-FIX12');
          const report=model.getDemoPaperCockpitReport();
          const demoReport=model.getDemoPaperCockpitReport();
          report.experiment.id='run-'+('R'.repeat(220));
          report.controls.reservations=3;
          report.valuation.cashCents='92000';
          report.valuation.realizedNetPnlCents='250';
          report.trading.noTradeReasons=[{
            gate:'gate-'+('G'.repeat(96)),status:'UNKNOWN',reason:'reason-'+('R'.repeat(220))
          }];
          demoReport.experiment.id='demo-'+('D'.repeat(220));
          demoReport.trading.noTradeReasons=[{
            gate:'demo-gate-'+('G'.repeat(96)),status:'UNKNOWN',reason:'demo-reason-'+('R'.repeat(220))
          }];
          view.renderPaperCockpit(document.getElementById('paper-cockpit-root'),report,document,{
            demoReport,state:'ready',message:'Manual one-shot report read.',
            onRefresh:()=>{},loading:false
          });
          return true;
        })()`);
        const before=await evaluate(`(()=>{
          const root=document.querySelector('#paper-cockpit-root.paper-cockpit');
          const demo=root.querySelector(':scope > details');
          const summary=demo.querySelector(':scope > summary');
          const cells=[...root.querySelectorAll('.trust-cell')];
          const cash=cells.find(cell=>cell.querySelector('strong')?.textContent==='Cash');
          const pnl=cells.find(cell=>cell.querySelector('strong')?.textContent==='Realized net PnL');
          return {
            width:innerWidth,viewport:document.documentElement.clientWidth,
            documentWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,
            panelWidth:root.clientWidth,panelScrollWidth:root.scrollWidth,
            demoOpen:demo.open,summaryText:summary.innerText.trim(),
            accessibleName:summary.getAttribute('aria-label'),
            summaryHeight:summary.getBoundingClientRect().height,
            refreshHeight:root.querySelector('button').getBoundingClientRect().height,
            cashLabel:cash.querySelector('span').textContent,cashTone:cash.querySelector('span').className,
            pnlLabel:pnl.querySelector('span').textContent,pnlTone:pnl.querySelector('span').className,
            reservationText:[...root.querySelectorAll('p')].find(item=>item.textContent.includes('Reported reservation count'))?.textContent,
            longRunId:root.textContent.includes('run-'+('R'.repeat(220))),
            longReason:root.textContent.includes('reason-'+('R'.repeat(220)))
          };
        })()`);
        assert.equal(before.width,size.width);
        assert.ok(before.documentWidth<=before.viewport+1&&before.bodyWidth<=before.viewport+1,
          'document overflow at '+size.width+': '+JSON.stringify(before));
        assert.ok(before.panelScrollWidth<=before.panelWidth+1,
          'cockpit panel overflow at '+size.width+': '+JSON.stringify(before));
        assert.equal(before.demoOpen,false);
        assert.ok(before.refreshHeight>=44,'manual refresh target below 44px: '+JSON.stringify(before));
        assert.ok(before.summaryHeight>=44,'demo summary target below 44px: '+JSON.stringify(before));
        assert.ok(before.accessibleName.includes(before.summaryText),
          'accessible name must contain its visible label: '+JSON.stringify(before));
        assert.equal(before.cashLabel,'92000 cents');
        assert.equal(before.cashTone,'tone-muted','positive cash is a balance, not a profit gain');
        assert.equal(before.pnlLabel,'+250 cents');
        assert.equal(before.pnlTone,'tone-safe','known positive signed PnL retains its semantic color');
        assert.match(before.reservationText,/3/);
        assert.equal(before.longRunId,true);
        assert.equal(before.longReason,true);

        const focus=await evaluate(`(()=>{
          document.getElementById('app-main').focus();
          return document.activeElement===document.getElementById('app-main');
        })()`);
        assert.equal(focus,true);
        await key('Tab','Tab',9);
        const refreshTab=await evaluate(`document.activeElement===document.querySelector('#paper-cockpit-root button')`);
        assert.equal(refreshTab,true,'native Tab focuses the manual report read affordance');
        await key('Tab','Tab',9);
        const tabState=await evaluate(`(()=>{
          const summary=document.querySelector('#paper-cockpit-root > details > summary');
          const style=getComputedStyle(summary);
          return {focused:document.activeElement===summary,outline:style.outlineStyle,
            outlineWidth:style.outlineWidth};
        })()`);
        assert.equal(tabState.focused,true,'native Tab must focus the demo disclosure summary at '+size.width);
        assert.equal(tabState.outline,'solid','keyboard focus must remain visible');
        assert.ok(parseFloat(tabState.outlineWidth)>=2);
        await key('Enter','Enter',13);
        assert.deepEqual(await evaluate(`(()=>{
          const details=document.querySelector('#paper-cockpit-root > details');
          return {open:details.open,focused:document.activeElement===details.querySelector('summary')};
        })()`),{open:true,focused:true},'Enter opens the demo and preserves summary focus');
        await key(' ','Space',32);
        assert.deepEqual(await evaluate(`(()=>{
          const details=document.querySelector('#paper-cockpit-root > details');
          return {open:details.open,focused:document.activeElement===details.querySelector('summary')};
        })()`),{open:false,focused:true},'Space closes the demo and preserves summary focus');
        await key(' ','Space',32);
        const reopened=await evaluate(`(()=>{
          const details=document.querySelector('#paper-cockpit-root > details');
          const root=document.querySelector('#paper-cockpit-root');
          return {
            open:details.open,focused:document.activeElement===details.querySelector('summary'),
            width:innerWidth,viewport:document.documentElement.clientWidth,
            documentWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,
            panelWidth:root.clientWidth,panelScrollWidth:root.scrollWidth,
            detailsWidth:details.clientWidth,detailsScrollWidth:details.scrollWidth,
            longRunId:details.textContent.includes('demo-'+('D'.repeat(220))),
            longReason:details.textContent.includes('demo-reason-'+('R'.repeat(220))),
            overflowingDescendants:[...details.querySelectorAll('*')]
              .filter(element=>element.scrollWidth>element.clientWidth+1)
              .map(element=>({tag:element.tagName,className:element.className,
                clientWidth:element.clientWidth,scrollWidth:element.scrollWidth}))
          };
        })()`);
        assert.equal(reopened.open,true,'native Space must reopen the demo');
        assert.equal(reopened.focused,true,'native Space must preserve summary focus');
        assert.equal(reopened.width,size.width);
        assert.ok(reopened.documentWidth<=reopened.viewport+1&&reopened.bodyWidth<=reopened.viewport+1,
          'expanded demo document/body overflow at '+size.width+': '+JSON.stringify(reopened));
        assert.ok(reopened.panelScrollWidth<=reopened.panelWidth+1,
          'expanded cockpit panel overflow at '+size.width+': '+JSON.stringify(reopened));
        assert.ok(reopened.detailsScrollWidth<=reopened.detailsWidth+1,
          'expanded demo details overflow at '+size.width+': '+JSON.stringify(reopened));
        assert.equal(reopened.longRunId,true,'long run ID must render inside the expanded demo');
        assert.equal(reopened.longReason,true,'long rejection reason must render inside the expanded demo');
        assert.deepEqual(reopened.overflowingDescendants,[],
          'expanded demo descendants must fit at '+size.width+': '+JSON.stringify(reopened));
        if(evidence){
          mkdirSync(evidence,{recursive:true});
          await evaluate(`(()=>{
            const summary=document.querySelector('#paper-cockpit-root > details > summary');
            summary.blur();summary.scrollIntoView({block:'start'});
          })()`);
          const image=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
          writeFileSync(join(evidence,`paper-cockpit-${size.width}.png`),Buffer.from(image.data,'base64'));
        }
        return {
          width:size.width,viewport:before.viewport,documentWidth:before.documentWidth,
          panelWidth:before.panelWidth,panelScrollWidth:before.panelScrollWidth,
          summaryHeight:before.summaryHeight,nativeTab:tabState.focused,
          refreshHeight:before.refreshHeight,
          enterOpen:true,spaceClose:true,spaceReopen:true,cash:before.cashLabel,
          cashTone:before.cashTone,pnl:before.pnlLabel,pnlTone:before.pnlTone,
          expandedDocumentWidth:reopened.documentWidth,expandedBodyWidth:reopened.bodyWidth,
          expandedPanelWidth:reopened.panelWidth,expandedDetailsWidth:reopened.detailsWidth,
          expandedDetailsScrollWidth:reopened.detailsScrollWidth,
          expandedLongRunId:reopened.longRunId,expandedLongReason:reopened.longReason
        };
      },size.height);
      console.log('V11_PAPER_COCKPIT_SIZE',JSON.stringify(metrics));
    }
  }finally{
    await hosted.close();
  }
});
