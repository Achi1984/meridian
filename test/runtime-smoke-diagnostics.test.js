import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {assetWatchStrictGateDiagnostics} from '../scripts/runtime-smoke-diagnostics.mjs';
import {assetWatchMirrorPublicReceipt} from '../asset-watch-mirror-crypto.js';

test('strict diagnostics allow only typed flags, source enum, timestamps, ages and deployment SHA',()=>{
  const receipt={readOnly:true,executionImpact:false,detailsComplete:true,sourceStatusOk:true,
    fresh:true,usableForOverwrite:false,source:'PIONEX_BOT_API',
    sourceSnapshotAt:'2026-10-30T12:00:00.000Z',sourceAgeMs:1000,freshnessLimitMs:900000,
    token:'PRIVATE_MARKER',bots:[{id:'PRIVATE_MARKER'}],coverage:{secret:'PRIVATE_MARKER'}};
  const envelope={receipt,generatedAt:'2026-10-30T12:00:01.000Z',
    ciphertext:'PRIVATE_MARKER',iv:'PRIVATE_MARKER',tag:'PRIVATE_MARKER'};
  const raw=assetWatchStrictGateDiagnostics(envelope,{deploymentSha:'a'.repeat(40),token:'PRIVATE_MARKER'});
  assert.deepEqual(JSON.parse(raw),{
    readOnly:true,executionImpact:false,detailsComplete:true,sourceStatusOk:true,fresh:true,
    usableForOverwrite:false,source:'PIONEX_BOT_API',sourceSnapshotAt:receipt.sourceSnapshotAt,
    generatedAt:envelope.generatedAt,sourceAgeMs:1000,freshnessLimitMs:900000,deploymentSha:'a'.repeat(40),
    overwriteScope:null,excludedScope:null,overwriteRejectionReasons:[],scopeDiagnostics:null
  });
  assert.doesNotMatch(raw,/PRIVATE_MARKER|ciphertext|iv"|tag"|token|bots|coverage/);
  const hostile=Object.fromEntries(Object.keys(receipt).map(key=>[key,'PRIVATE_MARKER'.repeat(10000)]));
  const bounded=assetWatchStrictGateDiagnostics({receipt:hostile,generatedAt:hostile.source},
    {deploymentSha:hostile.source});
  assert.ok(bounded.length<512);
  assert.ok(Object.entries(JSON.parse(bounded)).every(([key,value])=>
    key==='overwriteRejectionReasons'?Array.isArray(value)&&value.length===0:value===null));
  assert.doesNotThrow(()=>assetWatchStrictGateDiagnostics(null,null));
});

test('each strict receipt flag still fails the real smoke and emits only safe bounded diagnostics offline',()=>{
  const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
  for(const flag of ['readOnly','executionImpact','detailsComplete','sourceStatusOk','fresh','usableForOverwrite']){
    const code=`
      const release=${JSON.stringify(release)};
      const terminal=release.terminalBuild;
      const at=new Date().toISOString();
      const receipt={schemaVersion:'MERIDIAN-ASSET-WATCH-MIRROR-RECEIPT-V1',
        bridgeSchemaVersion:'MERIDIAN-ASSET-WATCH-BRIDGE-V1',readOnly:true,executionImpact:false,
        detailsComplete:true,sourceStatusOk:true,fresh:true,usableForOverwrite:true,
        source:'PIONEX_BOT_API',sourceSnapshotAt:at,sourceAgeMs:0,freshnessLimitMs:900000,
        scopeDiagnostics:{scopePresent:true,schemaOk:true,botTypeOk:true,exclusionsVerified:false,
          excludedRowsEqualsUnsupported:false,categoriesVerified:false,countsVerified:true,
          candidateCount:2,unsupportedCount:1,unrecognizedNonemptyCategoryCount:1,
          typeCounts:{futures_grid:1,futures_lite:0,OTHER:1,PRIVATE_MARKER:123456789},
          payload:'PRIVATE_MARKER'},
        token:'PRIVATE_MARKER',bots:[{id:'PRIVATE_MARKER'}]};
      receipt[${JSON.stringify(flag)}]=${flag==='executionImpact'};
      globalThis.fetch=async raw=>{
        const path=new URL(raw).pathname;
        let body;
        if(path.endsWith('/version.json'))body=release;
        else if(path.endsWith('/index.html')||path.endsWith('/v10.js'))
          return new Response('content="'+terminal+'" ./v10.js?v='+terminal+
            " const BUILD='"+terminal+"' const LOCAL_BUILD='"+terminal+"' ../version.json?boot=");
        else if(path.endsWith('/manifest.webmanifest'))body={start_url:'?build='+terminal.split('-').at(-1)};
        else if(path==='/gateway-health')body={...release,ok:true,privateData:true,
          privateReadConfigured:true,privateReadAuthSource:'ENV',deploymentSha:'a'.repeat(40),
          marketFeedCore:{ready:true,freshnessLimitMs:90000,intervals:Object.fromEntries(
            ['15m','1h','4h','1d'].map(key=>[key,{ok:true,sufficientRows:true,rowCount:2,minimumRows:1,ageMs:0}]))}};
        else if(path==='/api/asset-watch/live-mirror')body={schemaVersion:'MERIDIAN-ASSET-WATCH-MIRROR-V1',
          alg:'A256GCM',generatedAt:at,receipt,iv:'PRIVATE_MARKER',tag:'PRIVATE_MARKER',ciphertext:'PRIVATE_MARKER'};
        else throw new Error('UNEXPECTED_REQUEST');
        return Response.json(body);
      };
      await import(${JSON.stringify(new URL('../scripts/runtime-smoke.mjs',import.meta.url).href)});
    `;
    const result=spawnSync(process.execPath,['--input-type=module','--eval',code],{
      cwd:new URL('..',import.meta.url),encoding:'utf8',timeout:10000,
      env:{...process.env,MERIDIAN_SMOKE_RETRIES:'1',MERIDIAN_SMOKE_DELAY_MS:'0'}
    });
    assert.equal(result.status,1,flag);
    assert.match(result.stderr,/Asset Watch live receipt strict gate failed: \{/);
    assert.match(result.stderr,new RegExp('"'+flag+'":'+(flag==='executionImpact')));
    assert.match(result.stderr,/"deploymentSha":"a{40}"/);
    assert.match(result.stderr,/"scopePresent":true,"schemaOk":true,"botTypeOk":true,"exclusionsVerified":false/);
    assert.match(result.stderr,/"unrecognizedNonemptyCategoryCount":1/);
    assert.match(result.stderr,/"typeCounts":\{"futures_grid":1,"futures_lite":0,"OTHER":1\}/);
    assert.doesNotMatch(result.stdout+result.stderr,/PRIVATE_MARKER|UNEXPECTED_REQUEST/);
    assert.ok(result.stderr.length<4096);
  }
});

test('both authoritative encrypted mirrors opt in while both private display routes remain display-first',()=>{
  const source=fs.readFileSync(new URL('../server-gateway.js',import.meta.url),'utf8');
  const live=source.slice(source.indexOf('if(req.method==="GET"&&u.pathname==="/api/asset-watch/live-mirror")'),
    source.indexOf('if(req.method==="GET"&&u.pathname==="/api/private/asset-watch/github-oidc-mirror")'));
  const oidc=source.slice(source.indexOf('if(req.method==="GET"&&u.pathname==="/api/private/asset-watch/github-oidc-mirror")'),
    source.indexOf('if(isProtected(u.pathname)&&!authorizedRead(req))'));
  for(const route of [live,oidc]){
    assert.match(route,/buildAssetWatchApiSnapshot\(data,\{preferOverwrite:true\}\)/);
    assert.match(route,/encryptAssetWatchMirror\(snapshot,shareState\.tokenHash\)/);
  }
  assert.match(oidc,/const verified=await verifyGithubActionsOidc\(bearer\(req\)\);/);
  assert.match(oidc,/if\(!verified\.ok\)return writeJson\(res,401,/);
  for(const condition of [
    'if(req.method==="GET"&&u.pathname==="/api/private/asset-watch"&&await authorizedAssetWatchShare(u))',
    'if(req.method==="GET"&&u.pathname==="/api/private/asset-watch")'
  ]){
    const start=source.indexOf(condition);
    assert.notEqual(start,-1);
    const route=source.slice(start,source.indexOf('\n    }',start));
    assert.match(route,/writeJson\(res,200,buildAssetWatchApiSnapshot\(data\),origin\|\|""\)/);
    assert.doesNotMatch(route,/preferOverwrite/);
  }
  assert.equal((source.match(/preferOverwrite:true/g)||[]).length,2);
});

test('scope diagnostics are closed, bounded and re-sanitized at both public boundaries',()=>{
  const canary='PRIVATE_CANARY'.repeat(10000);
  for(const count of [-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER,1_000_001,'1',true,{},null,0,1_000_000]){
    const expected=typeof count==='number'&&Number.isInteger(count)&&count>=0&&count<=1_000_000?count:null;
    const scopeDiagnostics={
      scopePresent:true,schemaOk:canary,botTypeOk:false,exclusionsVerified:'true',
      excludedRowsEqualsUnsupported:null,categoriesVerified:false,countsVerified:true,
      candidateCount:count,unsupportedCount:count,unrecognizedNonemptyCategoryCount:count,
      typeCounts:{futures_grid:count,futures_lite:count,OTHER:count,[canary]:123456789},
      category:canary,id:canary,symbol:canary,amount:123456789,url:canary,credential:canary,
      payload:{secret:canary},writerSha:canary
    };
    const expectedDiagnostic={
      scopePresent:true,schemaOk:null,botTypeOk:false,exclusionsVerified:null,
      excludedRowsEqualsUnsupported:null,categoriesVerified:false,countsVerified:true,
      candidateCount:expected,unsupportedCount:expected,unrecognizedNonemptyCategoryCount:expected,
      typeCounts:{futures_grid:expected,futures_lite:expected,OTHER:expected}
    };
    const receipt=assetWatchMirrorPublicReceipt({scopeDiagnostics});
    assert.deepEqual(receipt.scopeDiagnostics,expectedDiagnostic);
    for(const input of [receipt,{scopeDiagnostics}]){
      const raw=assetWatchStrictGateDiagnostics({receipt:input},null);
      assert.deepEqual(JSON.parse(raw).scopeDiagnostics,expectedDiagnostic);
      assert.doesNotMatch(raw,/PRIVATE_CANARY|123456789|writerSha|payload|credential/);
      assert.ok(raw.length<1536);
    }
  }
  for(const value of [undefined,null,false,'PRIVATE_CANARY',[]]){
    assert.equal(assetWatchMirrorPublicReceipt({scopeDiagnostics:value}).scopeDiagnostics,null);
    assert.equal(JSON.parse(assetWatchStrictGateDiagnostics({receipt:{scopeDiagnostics:value}},null))
      .scopeDiagnostics,null);
  }
});
