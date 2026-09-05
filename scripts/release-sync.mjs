import fs from 'node:fs';

const write=process.argv.includes('--write');
const release=JSON.parse(fs.readFileSync('version.json','utf8'));
const version=String(release.version||release.ui||'').trim();
const build=String(release.buildId||'').trim();
if(!/^\d+\.\d+$/.test(version)) throw new Error(`invalid release version: ${version}`);
if(!build.startsWith(version+'-')) throw new Error(`buildId ${build} does not match version ${version}`);
const revision=build.split('-').slice(-1)[0]||'R1';
const cacheTag=`${version}-${revision}`;
const pending=[];

function apply(path,transform){
  const before=fs.readFileSync(path,'utf8');
  const after=transform(before);
  if(before===after)return;
  if(write){fs.writeFileSync(path,after);console.log('synced',path)}
  else pending.push(path);
}
function required(text,re,replacement,label){
  if(!re.test(text))throw new Error(`release sync target missing: ${label}`);
  return text.replace(re,replacement);
}

// Runtime release authority is version.json. index.html remains a compatibility bootstrap;
// R9's compatibility loader self-checks version.json and app-release-authority.js can hot-refresh stale module graphs.
apply('app-v6.06.js',src=>required(src,/const LOCAL_TAG='[^']+';/,`const LOCAL_TAG='${cacheTag}';`,'compat loader cache tag'));

apply('manifest.webmanifest',()=>JSON.stringify({
  name:`ACHI MERIDIAN v${version}`,
  short_name:`MERIDIAN ${version}`,
  start_url:`./?build=${build}`,
  display:'standalone',
  background_color:'#03070c',
  theme_color:'#05080d'
},null,2)+'\n');

apply('package.json',src=>{
  const p=JSON.parse(src);
  p.version=version+'.0';
  p.scripts={...(p.scripts||{}),start:'node scripts/start-gateway.mjs','start:core':'node server.js',test:'node --test test/*.test.js','release:check':'node scripts/release-sync.mjs --check && node scripts/release-check.mjs','runtime:smoke':'node scripts/runtime-smoke.mjs'};
  return JSON.stringify(p)+'\n';
});

apply('package-lock.json',src=>{
  const p=JSON.parse(src);
  p.version=version+'.0';
  if(p.packages?.[''])p.packages[''].version=version+'.0';
  return JSON.stringify(p,null,2)+'\n';
});

if(!fs.existsSync('app-release-authority.js'))throw new Error('app-release-authority.js missing');
const authority=fs.readFileSync('app-release-authority.js','utf8');
for(const marker of ["fetch('version.json?authority='+Date.now(),{cache:'no-store'})",'MERIDIAN_RELEASE_AUTHORITY','MutationObserver','bootstrapMismatch']){
  if(!authority.includes(marker))throw new Error(`release authority marker missing: ${marker}`);
}
const loader=fs.readFileSync('app-v6.06.js','utf8');
for(const marker of ["app-release-authority.js",'version.json?bootstrap=','injectLatestLoader','MERIDIAN_LOADER_TAG']){
  if(!loader.includes(marker))throw new Error(`compat loader marker missing: ${marker}`);
}

if(!write&&pending.length){
  throw new Error('release-generated files out of sync: '+pending.join(', '));
}
console.log(write?'release sync complete':'release sync clean',version,build,cacheTag);