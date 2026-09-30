import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const ROOT=process.cwd();
const OUT=path.join(ROOT,'artifacts','visual-qa');
fs.rmSync(OUT,{recursive:true,force:true});
fs.mkdirSync(OUT,{recursive:true});

const candidates=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser'].filter(Boolean);
const chrome=candidates.find(x=>fs.existsSync(x));
if(!chrome)throw new Error('No Chrome/Chromium binary found for visual QA');

const base=String(process.env.MERIDIAN_VISUAL_QA_BASE||'http://127.0.0.1:4173/v10/visual-qa-frame.html').replace(/\?$/,'');
const viewport={width:390,height:844};
const cases=[
  ['command-top','command',0],['command-deep','command',900],
  ['depot-top','depot',0],['depot-deep','depot',900],
  ['bots-top','bots',0],['bots-deep','bots',900],
  ['forecast-top','market',0],['forecast-fib','market',1050],
  ['scanner-top','research',0],['scanner-deep','research',850]
];

function decodeText(s){
  return String(s||'').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
}
function runChrome(name,kind,url,extra=[]){
  const profile=path.join('/tmp','meridian-visual-qa-'+process.pid+'-'+name+'-'+kind);
  const args=[
    '--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--hide-scrollbars',
    '--run-all-compositor-stages-before-draw','--force-device-scale-factor=1',
    '--window-size='+viewport.width+','+viewport.height,'--virtual-time-budget=2600',
    '--user-data-dir='+profile,...extra,url.toString()
  ];
  const p=spawnSync(chrome,args,{cwd:ROOT,encoding:'utf8',timeout:45000,maxBuffer:30*1024*1024});
  fs.rmSync(profile,{recursive:true,force:true});
  if(p.error)throw p.error;
  if(p.status!==0){
    fs.writeFileSync(path.join(OUT,name+'-'+kind+'.stderr.txt'),String(p.stderr||''));
    throw new Error(name+' '+kind+' chrome exit '+p.status+'\n'+String(p.stderr||'').slice(-4000));
  }
  return p;
}

const summaries=[];
for(let i=0;i<cases.length;i++){
  const [name,view,scroll]=cases[i],png=path.join(OUT,name+'.png'),url=new URL(base);
  url.searchParams.set('visualQa','1');url.searchParams.set('qaView',view);url.searchParams.set('qaScroll',String(scroll));url.searchParams.set('build','r83');

  // Chrome does not reliably emit --dump-dom when screenshot capture is requested in the same process.
  // Keep layout evaluation and evidence capture as separate deterministic invocations.
  const domRun=runChrome(name,'dom',url,['--dump-dom']);
  const dom=String(domRun.stdout||'');
  const m=dom.match(/<pre id="visual-qa-report"[^>]*>([\s\S]*?)<\/pre>/);
  if(!m){
    fs.writeFileSync(path.join(OUT,name+'.html'),dom);
    fs.writeFileSync(path.join(OUT,name+'-dom.stderr.txt'),String(domRun.stderr||''));
    throw new Error(name+' visual QA report missing');
  }
  const report=JSON.parse(decodeText(m[1]));

  const shotRun=runChrome(name,'shot',url,['--screenshot='+png]);
  if(!fs.existsSync(png)||fs.statSync(png).size<1000){
    fs.writeFileSync(path.join(OUT,name+'-shot.stderr.txt'),String(shotRun.stderr||''));
    throw new Error(name+' screenshot missing or empty');
  }

  summaries.push({name,url:url.toString(),screenshot:path.relative(ROOT,png),...report});
  console.log('[visual-qa]',name,JSON.stringify(report));
}
const failed=summaries.filter(x=>!x.ok);
fs.writeFileSync(path.join(OUT,'summary.json'),JSON.stringify({generatedAt:new Date().toISOString(),viewport,cases:summaries,ok:failed.length===0},null,2));
if(failed.length){
  console.error('[visual-qa] failures',JSON.stringify(failed,null,2));
  process.exit(1);
}
console.log('[visual-qa] PASS',summaries.length,'captures');
