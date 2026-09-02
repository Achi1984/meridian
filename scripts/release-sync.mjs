import fs from 'node:fs';

const write=process.argv.includes('--write');
const release=JSON.parse(fs.readFileSync('version.json','utf8'));
const version=String(release.version||release.ui||'').trim();
const build=String(release.buildId||'').trim();
if(!/^\d+\.\d+$/.test(version)) throw new Error(`invalid release version: ${version}`);
if(!build.startsWith(version+'-')) throw new Error(`buildId ${build} does not match version ${version}`);
const cacheTag=version+'-R1';
const pending=[];
function apply(path,transform){const before=fs.readFileSync(path,'utf8');const after=transform(before);if(before===after)return;if(write){fs.writeFileSync(path,after);console.log('synced',path)}else pending.push(path)}
function required(text,re,replacement,label){if(!re.test(text))throw new Error(`release sync target missing: ${label}`);return text.replace(re,replacement)}
function present(text,re,label){if(!re.test(text))throw new Error(`release sync target missing: ${label}`);return text}

apply('index.html',src=>{
  let s=src;
  s=required(s,/<meta name="meridian-build" content="[^"]+">/,`<meta name="meridian-build" content="${build}">`,'index build meta');
  s=required(s,/window\.MERIDIAN_RELEASE_VERSION='[^']+';/,`window.MERIDIAN_RELEASE_VERSION='${version}';`,'index release version');
  s=required(s,/window\.MERIDIAN_RELEASE_BUILD='[^']+';/,`window.MERIDIAN_RELEASE_BUILD='${build}';`,'index release build');
  s=s.replace(/manifest\.webmanifest\?v=[^"'<>\s]+/g,`manifest.webmanifest?v=${cacheTag}`);
  s=s.replace(/styles-v6\.06\.css\?v=[^"'<>\s]+/g,`styles-v6.06.css?v=${cacheTag}`);
  s=s.replace(/app-v6\.06\.js(?:\?v=[^"'<>\s]+)?/g,`app-v6.06.js?v=${cacheTag}`);
  s=s.replace(/window\.MERIDIAN_RELEASE_BUILD\|\|'[^']+'/g,`window.MERIDIAN_RELEASE_BUILD||'${build}'`);
  return s;
});

apply('app-v6.06.js',src=>{
  let s=src;
  for(const [re,label] of [
    [/app-v7\.33-hardening\.js\?v=[^"'<>\s]+/,'hardening loader tag'],
    [/app-runtime-monitor\.js\?v=[^"'<>\s]+/,'runtime monitor loader tag'],
    [/app-v7\.37-ui-polish\.js\?v=[^"'<>\s]+/,'ui polish loader tag'],
    [/app-v7\.38-regime-ui\.js\?v=[^"'<>\s]+/,'regime ui loader tag'],
    [/app-v7\.39-paper-overview\.js\?v=[^"'<>\s]+/,'paper overview loader tag'],
    [/app-v7\.60-dashboard-consistency\.js\?v=[^"'<>\s]+/,'dashboard consistency loader tag'],
    [/app-v7\.60-private-hydration-hotfix\.js\?v=[^"'<>\s]+/,'private hydration loader tag'],
    [/app-v7\.60-final-ui-authority\.js\?v=[^"'<>\s]+/,'final ui authority loader tag']
  ])s=present(s,re,label);
  if(/app-v7\.32-legacy\.js|emergency-input-hotfix|nav-hotfix|unlock-hotfix/.test(s))throw new Error('retired frontend layer present in canonical loader');
  return s;
});

apply('app-v7.33-hardening.js',src=>{
  let s=src;s=required(s,/const VERSION='[^']+';/,`const VERSION='${version}';`,'hardening version');s=required(s,/const BUILD='[^']+';/,`const BUILD='${build}';`,'hardening build');s=s.replace(/manifest\.webmanifest\?v=[^'"\s]+/g,`manifest.webmanifest?v=${cacheTag}`);return s;
});
apply('manifest.webmanifest',()=>JSON.stringify({name:`ACHI MERIDIAN v${version}`,short_name:`MERIDIAN ${version}`,start_url:`./?build=${build}`,display:'standalone',background_color:'#03070c',theme_color:'#05080d'},null,2)+'\n');
apply('package.json',src=>{const p=JSON.parse(src);p.version=version+'.0';p.scripts={...(p.scripts||{}),start:'node scripts/start-gateway.mjs','start:core':'node server.js',test:'node --test test/*.test.js','release:check':'node scripts/release-sync.mjs --check && node scripts/release-check.mjs','runtime:smoke':'node scripts/runtime-smoke.mjs'};return JSON.stringify(p)+'\n'});
if(!write&&pending.length)throw new Error('release-generated files out of sync: '+pending.join(', '));
console.log(write?'release sync complete':'release sync clean',version,build);
