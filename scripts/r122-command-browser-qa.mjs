import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser'].filter(Boolean).find(fs.existsSync);
if(!chrome)throw new Error('No Chrome/Chromium binary found');
const base=process.env.MERIDIAN_R122_QA_BASE||'http://127.0.0.1:4173/v10/visual-qa-frame.html';
const sizes=[[390,844],[375,667],[320,568]];
const decode=s=>String(s||'').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
for(const [w,h] of sizes){
  const u=new URL(base);
  for(const [k,v] of Object.entries({visualQa:'1',qaView:'command',qaScroll:'0',qaWidth:String(w),qaHeight:String(h),qaR122:'1',build:'r122'}))u.searchParams.set(k,v);
  const profile=path.join('/tmp',`meridian-r122-qa-${process.pid}-${w}`);
  const p=spawnSync(chrome,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--run-all-compositor-stages-before-draw','--force-device-scale-factor=1',`--window-size=${w},${h}`,'--virtual-time-budget=8000',`--user-data-dir=${profile}`,'--dump-dom',u.toString()],{encoding:'utf8',timeout:45000,maxBuffer:20*1024*1024});
  fs.rmSync(profile,{recursive:true,force:true});
  if(p.error)throw p.error;
  if(p.status!==0)throw new Error(`Chrome ${w}x${h} exited ${p.status}: ${String(p.stderr||'').slice(-1200)}`);
  const m=String(p.stdout||'').match(/<pre id="r122-qa-report"[^>]*>([\s\S]*?)<\/pre>/);
  if(!m)throw new Error(`R122 QA report missing at ${w}x${h}`);
  const report=JSON.parse(decode(m[1])),checks=report?.checks||{};
  if(report?.ok!==true||!Object.values(checks).every(Boolean))throw new Error(`R122 QA failed at ${w}x${h}: ${JSON.stringify(report)}`);
  console.log('[r122-browser-qa]',w+'x'+h,JSON.stringify(report));
}
console.log('[r122-browser-qa] PASS',sizes.length,'viewports');
