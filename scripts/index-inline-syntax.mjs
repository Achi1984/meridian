import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync('index.html','utf8');
const re=/<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let m;let i=0;const failures=[];const ok=[];
while((m=re.exec(html))){
  i++;
  const attrs=m[1]||'';
  const body=m[2]||'';
  if(/\bsrc\s*=/.test(attrs)){ok.push({i,external:true});continue;}
  if(!body.trim()){ok.push({i,empty:true});continue;}
  try{new vm.Script(body,{filename:`index.html:inline-${i}.js`});ok.push({i,bytes:body.length});}
  catch(e){
    failures.push({i,message:String(e?.message||e),stack:String(e?.stack||'').split('\n').slice(0,4).join('\n'),preview:body.slice(0,180).replace(/\s+/g,' ')});
  }
}
console.log(JSON.stringify({ok:failures.length===0,scripts:i,checked:ok.length,failures},null,2));
if(failures.length)process.exit(1);
