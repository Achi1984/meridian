import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));

test('r60 refreshes the active legacy view before v10 command decoration on data sync',()=>{
  assert.match(v9,/refreshCurrentView:\(\)=>\{/);
  assert.match(v9,/const v=current,host=\$\('#view-'\+v\),fn=render\[v\]/);
  assert.match(v9,/host\.innerHTML=fn\(\)/);
  assert.match(v10,/window\.addEventListener\('meridian:data',\(\)=>\{/);
  assert.match(v10,/if\(activeViewKey\(\)==='command'\)bridge\(\)\?\.refreshCurrentView\?\.\(\)/);
  assert.match(v10,/schedule\(true\)/);
});

test('r60 forces v10 decoration after every navigation tab click',()=>{
  assert.match(v10,/\$\('#nav'\)\?\.addEventListener\('click',e=>\{/);
  assert.match(v10,/e\.target\?\.closest\?\.\('button\[data-v\]'\)/);
  assert.match(v10,/schedule\(true\)/);
});

test('r60 wallet diagnostics expose total bot and trader account totals without converting missing to zero',()=>{
  assert.match(v10,/walletAmount=v=>v===null\|\|v===undefined\|\|v===''\?null/);
  assert.match(v10,/w\.wallet\?\.totalInUsdt/);
  assert.match(v10,/w\.wallet\?\.botAccountTotalInUsdt/);
  assert.match(v10,/w\.wallet\?\.traderAccountTotalInUsdt/);
  assert.match(v10,/WALLET TOTAL/);
  assert.match(v10,/BOT ACCOUNT/);
  assert.match(v10,/TRADER ACCOUNT/);
  assert.match(v10,/totalInUsdt · portfolio candidate/);
});

test('r60 remains display and lifecycle only in successor releases',()=>{
  assert.match(release.terminalBuild,/^10\.0-r\d+$/);
  assert.ok(Number(release.terminalBuild.split('-r')[1])>=60);
  assert.equal(release.terminalExecutionImpact,false);
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});
