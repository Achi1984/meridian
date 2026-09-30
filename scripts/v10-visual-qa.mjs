import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT=process.cwd();
const OUT=path.join(ROOT,'artifacts','visual-qa');
fs.rmSync(OUT,{recursive:true,force:true});
fs.mkdirSync(OUT,{recursive:true});

const candidates=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser'].filter(Boolean);
const chrome=candidates.find(x=>fs.existsSync(x));
if(!chrome)throw new Error('No Chrome/Chromium binary found for visual QA');

const base=String(process.env.MERIDIAN_VISUAL_QA_BASE||'http://127.0.0.1:4173/v10/').replace(/\?$/,'');
const viewport={width:390,height:844,deviceScaleFactor:3,isMobile:true,hasTouch:true};
const cases=[
  ['command-top','command',0],['command-deep','command',900],
  ['depot-top','depot',0],['depot-deep','depot',900],
  ['bots-top','bots',0],['bots-deep','bots',900],
  ['forecast-top','market',0],['forecast-fib','market',1050],
  ['scanner-top','research',0],['scanner-deep','research',850]
];

const browser=await puppeteer.launch({
  executablePath:chrome,
  headless:true,
  args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu']
});

const summaries=[];
try{
  for(const [name,view,scroll] of cases){
    const page=await browser.newPage();
    const pageErrors=[];
    page.on('pageerror',e=>pageErrors.push(String(e?.stack||e)));
    page.on('console',msg=>{if(msg.type()==='error')pageErrors.push('console: '+msg.text())});
    await page.setViewport(viewport);

    const url=new URL(base);
    url.searchParams.set('visualQa','1');
    url.searchParams.set('qaView',view);
    url.searchParams.set('qaScroll',String(scroll));
    url.searchParams.set('build','r83');

    await page.goto(url.toString(),{waitUntil:'networkidle0',timeout:15000});
    await page.waitForSelector('#visual-qa-report',{timeout:5000});
    await page.evaluate(y=>window.scrollTo(0,y),scroll);
    await new Promise(r=>setTimeout(r,80));

    const reportText=await page.$eval('#visual-qa-report',el=>el.textContent||'{}');
    let report;
    try{report=JSON.parse(reportText)}catch{report={ok:false,error:'Invalid visual QA report JSON: '+reportText.slice(0,500)}}

    const measured=await page.evaluate(()=>({
      width:window.innerWidth,
      height:window.innerHeight,
      dpr:window.devicePixelRatio,
      scrollY:window.scrollY
    }));
    if(measured.width!==390||measured.height!==844){
      report={...report,ok:false,error:(report.error?report.error+' · ':'')+'Viewport mismatch '+measured.width+'x'+measured.height+' expected 390x844'};
    }
    if(pageErrors.length){
      report={...report,ok:false,error:(report.error?report.error+' · ':'')+pageErrors.join(' | ').slice(0,1800)};
    }

    const png=path.join(OUT,name+'.png');
    await page.screenshot({path:png,fullPage:false});
    summaries.push({name,url:url.toString(),screenshot:path.relative(ROOT,png),measured,...report});
    console.log('[visual-qa]',name,JSON.stringify({measured,...report}));
    await page.close();
  }
}finally{
  await browser.close();
}

const failed=summaries.filter(x=>!x.ok);
fs.writeFileSync(path.join(OUT,'summary.json'),JSON.stringify({generatedAt:new Date().toISOString(),viewport,cases:summaries,ok:failed.length===0},null,2));
if(failed.length){
  console.error('[visual-qa] failures',JSON.stringify(failed,null,2));
  process.exit(1);
}
console.log('[visual-qa] PASS',summaries.length,'captures');
