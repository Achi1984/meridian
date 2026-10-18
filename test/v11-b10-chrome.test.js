import assert from 'node:assert/strict';
import {test} from 'node:test';
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {withMobileChrome} from './helpers/v11-cdp.mjs';

const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium'].find(path=>path&&existsSync(path));
const page=process.env.V11_TEST_URL||'file://'+fileURLToPath(new URL('../v11/index.html',import.meta.url));
const sizes=[{width:320,height:568,mobile:true},{width:375,height:667,mobile:true},
  {width:390,height:844,mobile:true},{width:1440,height:900,mobile:false}];
const views=['command','depot','bots','market','research'];
const evidence=process.env.V11_B10_EVIDENCE_DIR;

test('V11 B10 Chrome: compact hierarchy, keyboard disclosure and reachable views at exact sizes',{timeout:120000},async()=>{
  if(typeof WebSocket!=='function'){
    const env={...process.env};delete env.NODE_TEST_CONTEXT;
    const child=spawnSync(process.execPath,['--experimental-websocket',fileURLToPath(import.meta.url)],
      {env,encoding:'utf8',timeout:115000});
    assert.equal(child.status,0,String(child.stdout).slice(-2500)+String(child.stderr).slice(-1000));
    const rows=child.stdout.split('\n').filter(line=>line.includes('V11_B10_SIZE'));
    assert.equal(rows.length,sizes.length);rows.forEach(row=>console.log(row));return;
  }
  assert.ok(chrome,'Chrome required; this test must not silently skip');
  if(evidence)mkdirSync(evidence,{recursive:true});
  for(const size of sizes){
    const metrics=await withMobileChrome(chrome,size.width,page,async call=>{
      const evaluate=async expression=>{
        const result=await call('Runtime.evaluate',{expression,returnByValue:true});
        assert.ok(!result.exceptionDetails,'browser expression exception: '+JSON.stringify(result.exceptionDetails));
        return result.result?.value;
      };
      await call('Emulation.setDeviceMetricsOverride',{width:size.width,height:size.height,deviceScaleFactor:1,
        mobile:size.mobile,screenWidth:size.width,screenHeight:size.height});
      const initial=await evaluate(`({
        width:innerWidth,height:innerHeight,viewport:document.documentElement.clientWidth,
        body:document.body.scrollWidth,root:document.documentElement.scrollWidth,
        header:Math.round(document.querySelector('.topbar').getBoundingClientRect().height),
        statusOpen:document.getElementById('autonomy-status').open,
        statusText:document.querySelector('#autonomy-status summary').innerText,
        commandHeading:document.querySelector('#command-heading').innerText,
        primaryImmediatelyAfterHeading:document.querySelector('.section-intro').nextElementSibling.id,
        portfolioBeforeRisk:document.querySelector('#command-portfolio').compareDocumentPosition(document.querySelector('[data-decision-owner]'))&Node.DOCUMENT_POSITION_FOLLOWING,
        disclosureHeight:document.querySelector('#autonomy-status summary').getBoundingClientRect().height,
        targets:[...document.querySelectorAll('#nav button,#version-toggle,.terminal-entry-link,#autonomy-status summary,.command-context-details>summary')].every(node=>node.getBoundingClientRect().height>=44)
      })`);
      assert.equal(initial.width,size.width);assert.equal(initial.height,size.height);
      assert.ok(initial.viewport<=size.width&&initial.viewport>=size.width-20,'unexpected usable viewport '+size.width);
      assert.ok(initial.body<=initial.viewport+1&&initial.root<=initial.viewport+1,'initial page overflow '+size.width);
      assert.equal(initial.statusOpen,false);assert.match(initial.statusText,/Unbekannt/);
      assert.equal(initial.commandHeading,'Command');assert.equal(initial.primaryImmediatelyAfterHeading,'command-portfolio');
      assert.ok(initial.portfolioBeforeRisk,'portfolio must precede explanatory risk content');
      assert.ok(initial.header<190,'compact header: '+initial.header+'px');
      assert.ok(initial.disclosureHeight>=44);assert.equal(initial.targets,true,'all primary touch controls meet 44px');

      const summary=await evaluate('document.querySelector("#autonomy-status summary").focus()');
      await call('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',text:' ',unmodifiedText:' ',windowsVirtualKeyCode:32});
      await call('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});
      assert.equal(await evaluate('document.getElementById("autonomy-status").open'),true,'Space opens status disclosure');
      assert.equal(await evaluate('document.activeElement.matches("#autonomy-status summary")'),true);
      assert.match(await evaluate('document.querySelector("#autonomy-status .details-body").innerText'),/Kein aktuelles Betriebssignal/);
      assert.match(await evaluate('document.querySelector("#autonomy-status .details-body").innerText'),/Der Versionsstand ist kein Lebenszeichen/);
      if(evidence&&size.width===1440){
        const image=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
        writeFileSync(join(evidence,'v11-b10-1440x900-status-expanded.png'),Buffer.from(image.data,'base64'));
      }
      await call('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',text:' ',unmodifiedText:' ',windowsVirtualKeyCode:32});
      await call('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});
      assert.equal(await evaluate('document.getElementById("autonomy-status").open'),false,'Space closes status disclosure');

      const results=[];
      for(const view of views){
        await evaluate(`document.querySelector('#nav button[data-v="${view}"]').click();window.scrollTo(0,0)`);
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
          await evaluate('window.scrollTo(0,0)');
          const image=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
          writeFileSync(join(evidence,`v11-b10-1440x900-${view}.png`),Buffer.from(image.data,'base64'));
        }
      }
      if(evidence&&size.width===320){
        await evaluate('document.querySelector("#nav button[data-v=command]").click();window.scrollTo(0,0)');
        const image=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
        writeFileSync(join(evidence,'v11-b10-320x568-command.png'),Buffer.from(image.data,'base64'));
      }
      return {...initial,views:results};
    });
    console.log('V11_B10_SIZE',`${size.width}x${size.height}`,JSON.stringify(metrics));
  }
});
