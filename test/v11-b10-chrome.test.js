import assert from 'node:assert/strict';
import {test} from 'node:test';
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {withMobileChrome} from './helpers/v11-cdp.mjs';
import {unlockAppThroughGate} from './helpers/v11-app-access-browser.mjs';
import {startV11StaticServer} from './helpers/v11-static-server.mjs';

const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium'].find(path=>path&&existsSync(path));
const sizes=[{width:320,height:568,mobile:true},{width:375,height:667,mobile:true},
  {width:390,height:844,mobile:true},{width:1440,height:900,mobile:false}];
const views=['command','depot','bots','market','strategies'];
const evidence=process.env.V11_B10_EVIDENCE_DIR;

test('V11 B16 Chrome: readable mobile hierarchy, keyboard disclosure and reachable views at exact sizes',{timeout:120000},async()=>{
  if(typeof WebSocket!=='function'){
    const env={...process.env};delete env.NODE_TEST_CONTEXT;
    const child=spawnSync(process.execPath,['--experimental-websocket',fileURLToPath(import.meta.url)],
      {env,encoding:'utf8',timeout:115000});
    assert.equal(child.status,0,String(child.stdout).slice(-2500)+String(child.stderr).slice(-1000));
    const rows=child.stdout.split('\n').filter(line=>line.includes('V11_B10_SIZE'));
    assert.equal(rows.length,sizes.length);rows.forEach(row=>console.log(row));return;
  }
  assert.ok(chrome,'Chrome required; this test must not silently skip');
  const hosted=process.env.V11_TEST_URL?{url:process.env.V11_TEST_URL,close:async()=>{}}:await startV11StaticServer();
  try{
   if(evidence)mkdirSync(evidence,{recursive:true});
   for(const size of sizes){
    const metrics=await withMobileChrome(chrome,size.width,hosted.url,async call=>{
      const evaluate=async expression=>{
        const result=await call('Runtime.evaluate',{expression,returnByValue:true});
        assert.ok(!result.exceptionDetails,'browser expression exception: '+JSON.stringify(result.exceptionDetails));
        return result.result?.value;
      };
      const key=async(name,code,keyCode)=>{
        const text=name==='Enter'?'\r':name===' '?' ':null;
        await call('Input.dispatchKeyEvent',{type:'keyDown',key:name,code,windowsVirtualKeyCode:keyCode,
          ...(text===null?{}:{text,unmodifiedText:text})});
        await call('Input.dispatchKeyEvent',{type:'keyUp',key:name,code,windowsVirtualKeyCode:keyCode});
      };
      await call('Emulation.setDeviceMetricsOverride',{width:size.width,height:size.height,deviceScaleFactor:1,
        mobile:size.mobile,screenWidth:size.width,screenHeight:size.height});
      await unlockAppThroughGate(call);
      const initial=await evaluate(`({
        width:innerWidth,height:innerHeight,scrollY,viewport:document.documentElement.clientWidth,
        body:document.body.scrollWidth,root:document.documentElement.scrollWidth,
        header:Math.round(document.querySelector('.topbar').getBoundingClientRect().height),
        headerPadding:parseFloat(getComputedStyle(document.querySelector('.topbar')).paddingTop),
        headerControlsFit:[...document.querySelectorAll('.identity,.header-actions,.terminal-entry,#autonomy-status summary')].every(node=>{
          const r=node.getBoundingClientRect();return r.top>=0&&r.left>=0&&r.right<=innerWidth&&node.scrollWidth<=node.clientWidth+1;
        }),
        statusOpen:document.getElementById('autonomy-status').open,
        statusText:document.querySelector('#autonomy-status summary').innerText,
        commandHeading:document.querySelector('#command-heading').innerText,
        primaryImmediatelyAfterHeading:document.querySelector('.section-intro').nextElementSibling.id,
        portfolioBeforeRisk:document.querySelector('#command-portfolio').compareDocumentPosition(document.querySelector('[data-decision-owner]'))&Node.DOCUMENT_POSITION_FOLLOWING,
        portfolioRects:(()=>{
          const value=document.querySelector('#command-portfolio .portfolio-value').getBoundingClientRect();
          const status=document.querySelector('#command-portfolio .portfolio-description').getBoundingClientRect();
          const nav=document.getElementById('nav').getBoundingClientRect();
          return {value:{top:value.top,bottom:value.bottom},status:{top:status.top,bottom:status.bottom},navTop:nav.top};
        })(),
        disclosureHeight:document.querySelector('#autonomy-status summary').getBoundingClientRect().height,
        targets:[...document.querySelectorAll('#nav button,#version-toggle,.strategy-entry-link,#autonomy-status summary,.command-context-details>summary')].every(node=>node.getBoundingClientRect().height>=44)
      })`);
      assert.equal(initial.width,size.width);assert.equal(initial.height,size.height);
      assert.equal(initial.scrollY,0,'initial portfolio visibility is measured without scrolling');
      assert.ok(initial.viewport<=size.width&&initial.viewport>=size.width-20,'unexpected usable viewport '+size.width);
      assert.ok(initial.body<=initial.viewport+1&&initial.root<=initial.viewport+1,'initial page overflow '+size.width);
      assert.equal(initial.statusOpen,false);assert.match(initial.statusText,/Unbekannt/);
      assert.equal(initial.commandHeading,'Command');assert.equal(initial.primaryImmediatelyAfterHeading,'command-portfolio');
      assert.ok(initial.portfolioBeforeRisk,'portfolio must precede explanatory risk content');
      assert.ok(initial.header<Math.min(360,size.height*0.65),'bounded readable header: '+initial.header+'px');
      assert.ok(initial.headerPadding>=20,'header includes breathing room before safe-area padding');
      assert.equal(initial.headerControlsFit,true,'header labels and controls fit their available rows');
      assert.ok(initial.disclosureHeight>=44);assert.equal(initial.targets,true,'all primary touch controls meet 44px');
      for(const selector of ['.portfolio-value','.portfolio-description']){
        const reachable=await evaluate(`(()=>{
          const node=document.querySelector('#command-portfolio ${selector}');
          node.scrollIntoView({block:'center'});
          const r=node.getBoundingClientRect(),nav=document.getElementById('nav').getBoundingClientRect();
          return {top:r.top,bottom:r.bottom,height:r.height,navTop:nav.top};
        })()`);
        assert.ok(reachable.height>0&&reachable.top>=0&&reachable.bottom<=reachable.navTop,
          'portfolio content must remain fully scroll-reachable above navigation: '+selector+' '+JSON.stringify(reachable));
      }
      await evaluate('window.scrollTo(0,0)');

      await evaluate('document.querySelector("#autonomy-status summary").focus()');
      await key('Enter','Enter',13);
      assert.equal(await evaluate('document.getElementById("autonomy-status").open'),true,'Enter opens status disclosure');
      assert.equal(await evaluate('document.activeElement.matches("#autonomy-status summary")'),true);
      assert.match(await evaluate('document.querySelector("#autonomy-status .details-body").innerText'),/Kein aktuelles Betriebssignal/);
      assert.match(await evaluate('document.querySelector("#autonomy-status .details-body").innerText'),/Der Versionsstand ist kein Lebenszeichen/);
      assert.match(await evaluate('document.querySelector("#autonomy-status .details-body").innerText'),/Vorige Vorschau · B9/);
      if(evidence&&size.width===1440){
        await evaluate('document.activeElement.blur()');
        await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1400,deviceScaleFactor:1,mobile:false,
          screenWidth:1440,screenHeight:1400});
        const image=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
        writeFileSync(join(evidence,'v11-b10-1440x1400-status-expanded.png'),Buffer.from(image.data,'base64'));
        await call('Emulation.setDeviceMetricsOverride',{width:size.width,height:size.height,deviceScaleFactor:1,mobile:size.mobile,
          screenWidth:size.width,screenHeight:size.height});
      }
      await evaluate('document.querySelector("#autonomy-status summary").focus()');
      await key('Enter','Enter',13);
      assert.equal(await evaluate('document.getElementById("autonomy-status").open'),false,'Enter closes status disclosure');
      await evaluate('document.querySelector("#autonomy-status summary").focus()');
      await key(' ','Space',32);
      assert.equal(await evaluate('document.getElementById("autonomy-status").open'),true,'Space opens status disclosure');
      const expandedStatus=await evaluate(`(()=>{
        const detail=document.querySelector('#autonomy-status .details-body p:last-child');
        detail.scrollIntoView({block:'end'});
        const nav=document.getElementById('nav').getBoundingClientRect();
        window.scrollBy(0,innerHeight-nav.top+1);
        const content=detail.getBoundingClientRect();
        return {text:detail.textContent,top:content.top,bottom:content.bottom,navTop:nav.top,scrollY};
      })()`);
      assert.match(expandedStatus.text,/kein Lebenszeichen/);
      assert.ok(expandedStatus.top>=0&&expandedStatus.bottom<=expandedStatus.navTop,
        'expanded status final content must clear fixed navigation: '+JSON.stringify(expandedStatus));
      await evaluate('window.scrollTo(0,0);document.querySelector("#autonomy-status summary").focus()');
      await key(' ','Space',32);
      assert.equal(await evaluate('document.getElementById("autonomy-status").open'),false,'Space closes status disclosure');

      const contextDisclosure='document.querySelector(".command-context-details > summary")';
      await evaluate(`${contextDisclosure}.focus()`);
      await key('Enter','Enter',13);
      assert.equal(await evaluate('document.querySelector(".command-context-details").open'),true,'Enter opens Command context disclosure');
      await key('Enter','Enter',13);
      assert.equal(await evaluate('document.querySelector(".command-context-details").open'),false,'Enter closes Command context disclosure');
      await evaluate(`${contextDisclosure}.focus()`);
      await key(' ','Space',32);
      assert.equal(await evaluate('document.querySelector(".command-context-details").open'),true,'Space opens Command context disclosure');
      await key(' ','Space',32);
      assert.equal(await evaluate('document.querySelector(".command-context-details").open'),false,'Space closes Command context disclosure');

      const results=[];
      for(const view of views){
        await evaluate(`document.querySelector('#nav button[data-v="${view}"]').click();document.activeElement.blur();window.scrollTo(0,0)`);
        const status=await evaluate(`(()=>{
          const root=document.documentElement,body=document.body,nav=document.getElementById('nav');
          const active=document.querySelector('.view.active'),last=active.lastElementChild;
          const textNodes=[...active.querySelectorAll('h1,h2,p,.card-head,.section-title,.limited')];
          const fits=node=>node.scrollWidth<=node.clientWidth+1;
          window.scrollTo(0,root.scrollHeight);
          return {active:active.id,width:innerWidth,viewport:root.clientWidth,body:body.scrollWidth,root:root.scrollWidth,
            targetHeights:[...document.querySelectorAll('#nav button')].map(button=>button.getBoundingClientRect().height),
            clipped:textNodes.filter(node=>!fits(node)).length,
            lastBottom:last.getBoundingClientRect().bottom,navTop:nav.getBoundingClientRect().top,
            atBottom:scrollY+innerHeight>=root.scrollHeight-1};
        })()`);
        assert.equal(status.active,'view-'+view);assert.equal(status.width,size.width);
        assert.ok(status.body<=status.viewport+1&&status.root<=status.viewport+1,view+' overflow '+size.width);
        assert.equal(status.clipped,0,view+' text clipping '+size.width);
        assert.ok(status.targetHeights.every(height=>height>=44),view+' nav targets '+size.width);
        assert.ok(status.lastBottom<=status.navTop+1,view+' final content hidden behind nav '+size.width);
        assert.equal(status.atBottom,true,view+' final content not scroll-reachable '+size.width);
        results.push({view,contentReachable:true,overflow:false});
        if(evidence&&size.width===1440){
          const image=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
          writeFileSync(join(evidence,`v11-b10-1440x900-${view}.png`),Buffer.from(image.data,'base64'));
        }
      }
      if(evidence&&size.width===320){
        await evaluate('document.querySelector("#nav button[data-v=command]").click();document.activeElement.blur();window.scrollTo(0,0)');
        const image=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
        writeFileSync(join(evidence,'v11-b10-320x568-command.png'),Buffer.from(image.data,'base64'));
      }
      return {...initial,views:results};
    },size.height);
    console.log('V11_B10_SIZE',`${size.width}x${size.height}`,JSON.stringify(metrics));
   }
  }finally{await hosted.close();}
});
