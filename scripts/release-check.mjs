import fs from 'node:fs';

const read=p=>fs.readFileSync(p,'utf8');
const json=p=>JSON.parse(read(p));
const must=(ok,msg)=>{if(!ok)throw new Error(msg)};
const release=json('version.json');
const v=String(release.version||'');
const build=String(release.buildId||'');
const tag=v+'-R1';

must(release.ui===v,'version.json ui mismatch');
must(release.engine==='6.2.0','Engine must remain 6.2.0');
must(release.ruleset==='6.2-SIGNAL-V1','Ruleset must remain 6.2-SIGNAL-V1');
must(release.research==='7.34-RESEARCH-V2','Research engine version mismatch');

const index=read('index.html');
must(index.includes(`<meta name="meridian-build" content="${build}">`),'index build meta mismatch');
must(index.includes(`window.MERIDIAN_RELEASE_VERSION='${v}';`),'index release version mismatch');
must(index.includes(`window.MERIDIAN_RELEASE_BUILD='${build}';`),'index release build mismatch');
must(index.includes(`manifest.webmanifest?v=${tag}`),'manifest cache tag mismatch');
must(index.includes(`styles-v6.06.css?v=${tag}`),'CSS cache tag mismatch');
must(index.includes(`app-v6.06.js?v=${tag}`),'core app cache tag mismatch');

const loader=read('app-v6.06.js');
must(loader.includes(`app-v7.32-legacy.js?v=${tag}`),'legacy loader cache tag mismatch');
must(loader.includes(`app-v7.33-hardening.js?v=${tag}`),'hardening loader cache tag mismatch');

const hardening=read('app-v7.33-hardening.js');
must(hardening.includes(`const VERSION='${v}';`),'hardening VERSION mismatch');
must(hardening.includes(`const BUILD='${build}';`),'hardening BUILD mismatch');
must(hardening.includes(`manifest.webmanifest?v=${tag}`),'hardening manifest tag mismatch');

const manifest=json('manifest.webmanifest');
must(manifest.name===`ACHI MERIDIAN v${v}`,'manifest name mismatch');
must(manifest.short_name===`MERIDIAN ${v}`,'manifest short_name mismatch');
must(manifest.start_url===`./?build=${build}`,'manifest start_url mismatch');

const pkg=json('package.json');
must(pkg.version===v+'.0','package version mismatch');
must(pkg.scripts?.start==='node server-gateway.js','package start must use gateway');
must(pkg.scripts?.test==='node --test test/*.test.js','test script mismatch');

must(fs.existsSync('package-lock.json'),'package-lock.json missing');
const lock=json('package-lock.json');
must(lock.lockfileVersion>=2,'package lock format too old');
must(lock.packages?.['']?.version===v+'.0','package-lock root version mismatch');

const docker=read('Dockerfile');
must(docker.includes('RUN npm ci --omit=dev'),'Docker must use npm ci --omit=dev');
must(docker.includes('CMD ["node", "server-gateway.js"]'),'Docker must start security gateway');

const sw=read('sw.js');
must(sw.includes('MERIDIAN_SW_RETIRE'),'service worker retirement sentinel missing');
must(!/caches\.open\s*\(/.test(sw),'service worker must not create an application cache');

const server=read('server.js');
must(server.includes('if(!config.paperTrading||config.liveTrading) throw new Error("Unsafe configuration: PAPER only required.");'),'paper-only invariant missing');

console.log('MERIDIAN release check OK',v,build);
