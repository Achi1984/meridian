import fs from 'node:fs';
import {execFileSync} from 'node:child_process';

const files=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const patterns=[
  ['GitHub OAuth token',/\bgho_[A-Za-z0-9]{20,}\b/g],
  ['GitHub PAT',/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g],
  ['OpenAI/API style secret',/\bsk-[A-Za-z0-9_-]{20,}\b/g],
  ['AWS access key',/\bAKIA[0-9A-Z]{16}\b/g],
  ['Private key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g]
];
const findings=[];
for(const file of files){
  let st;try{st=fs.statSync(file)}catch{continue}
  if(!st.isFile()||st.size>2_000_000)continue;
  let text;try{text=fs.readFileSync(file,'utf8')}catch{continue}
  if(text.includes('\u0000'))continue;
  for(const [name,re] of patterns){
    re.lastIndex=0;
    if(re.test(text))findings.push(`${name}: ${file}`);
  }
}
if(findings.length)throw new Error('potential committed secret(s):\n'+findings.join('\n'));
console.log('MERIDIAN secret scan OK');
