import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {checkPublicationRuntimePostgres,createSyntheticRuntimeScenario} from '../scripts/publication-runtime-postgres-integration.mjs';
import {createPublicationTestRunner} from '../scripts/publication-actions-test-runner.mjs';

test('runtime integration import is inert without pg Docker or network',()=>{
 const url=new URL('../scripts/publication-runtime-postgres-integration.mjs',import.meta.url).href;
 const child=spawnSync(process.execPath,['--input-type=module','-e',
  `globalThis.fetch=()=>{throw Error('network forbidden')};await import(${JSON.stringify(url)});process.stdout.write('inert');`],
  {encoding:'utf8',timeout:5000});
 assert.equal(child.status,0);assert.equal(child.stdout,'inert');assert.equal(child.stderr,'');
});

test('integration rejects unmarked fixture before any database or transport effect',async()=>{
 let effects=0;
 for(const kind of [undefined,'production','DISPOSABLE_LOOPBACK_PG16']){
  await assert.rejects(checkPublicationRuntimePostgres({kind,Pool:class{constructor(){effects++;}},
   admin:{query(){effects++;}},verifyTransportRejections(){effects++;}}),error=>{
    assert.equal(error.message,'LOCAL_RUNTIME_INTEGRATION_FAILED');assert.equal(error.stage,'FIXTURE_CONTRACT');
    assert.deepEqual(error.passed,[]);return true;
   });
 }
 assert.equal(effects,0);
});

test('failed local TLS transport assertions prevent catalog and runner activity',async()=>{
 let effects=0;
 await assert.rejects(checkPublicationRuntimePostgres({kind:'DISPOSABLE_LOOPBACK_PG16_TLS',
  Pool:class{constructor(){effects++;}},admin:{query(){effects++;}},
  verifyTransportRejections:async()=>{throw Error('PRIVATE_PASSWORD synthetic rejected transport proof');}}),error=>{
   assert.equal(error.message,'LOCAL_RUNTIME_INTEGRATION_FAILED');assert.equal(error.stage,'TRANSPORT');
   assert.deepEqual(error.passed,[]);assert.equal(String(error.stack).includes('PRIVATE_PASSWORD'),false);
   assert.equal(JSON.stringify(error).includes('PRIVATE_PASSWORD'),false);return true;
  });
 assert.equal(effects,0);
});

test('actual readiness rejects malformed catalog evidence and closes all pools before runtime scenarios',async()=>{
 let queries=0,closed=0,adminCalls=0;
 class Pool{
  on(){return this;}
  async query(){queries++;return {rowCount:1,rows:[{evidence:null}]};}
  async end(){closed++;}
 }
 const config={host:'ep-purple-dew-b9mbuikp.c-7.eu-central-1.aws.neon.tech',database:'publisher_test',
  reservation:{user:'reserve',password:'reserve-synthetic'},senderRecord:{user:'sender',password:'sender-synthetic'},
  sendRecordRead:{user:'reader',password:'reader-synthetic'}};
 await assert.rejects(checkPublicationRuntimePostgres({kind:'DISPOSABLE_LOOPBACK_PG16_TLS',Pool,config,
  admin:{query(){adminCalls++;}},verifyTransportRejections:async()=>{}}),error=>{
   assert.equal(error.message,'LOCAL_RUNTIME_INTEGRATION_FAILED');assert.equal(error.stage,'CATALOG_READINESS');
   assert.deepEqual(error.passed,['transport-rejections']);assert.equal(Object.isFrozen(error.passed),true);return true;
  });
 assert.equal(queries,1);assert.equal(closed,3);assert.equal(adminCalls,0);
});

test('real Python envelope signed environment identity and preflight reach pool boundary offline',async()=>{
 let opens=0;
 const fixture={config:{database:'publisher_test',reservation:{user:'reserve',password:'reserve-synthetic'},
  senderRecord:{user:'sender',password:'sender-synthetic'},sendRecordRead:{user:'reader',password:'reader-synthetic'}},
  Pool:class{constructor(){opens++;throw Error('intentional offline boundary');}}};
 const s=createSyntheticRuntimeScenario('offline',9201);
 const approved=await s.options(fixture).readApprovedManifest();
 const approvalTime=Date.parse(approved.trustedConfig.approvalUpdatedAt);
 assert.equal(approvalTime,approved.trustedConfig.issuedAt*1000);
 assert.ok(Math.abs(Date.now()-approvalTime-30000)<5000);
 const result=await createPublicationTestRunner(s.options(fixture))();
 assert.equal(result.stage,'POOLS');assert.equal(result.outcome,'OWNER_RECONCILIATION_REQUIRED');assert.equal(opens,1);
 assert.deepEqual(s.counts(),{posts:0,credentials:0});
 s.claims.environment='foreign';
 const rejected=await createPublicationTestRunner(s.options(fixture))();
 assert.equal(rejected.stage,'PREFLIGHT');assert.equal(rejected.outcome,'REJECTED');assert.equal(opens,1);
});

test('CLI requires the sole explicit local opt-in before loading pg or fixture',()=>{
 const file=new URL('../scripts/publication-runtime-postgres-integration.mjs',import.meta.url);
 for(const args of [[],['--local-pg16-tls','extra'],['--help']]){
  const child=spawnSync(process.execPath,[file.pathname,...args],{encoding:'utf8',timeout:5000});
  assert.equal(child.status,1);assert.equal(child.stderr,'');
  assert.deepEqual(JSON.parse(child.stdout),{outcome:'LOCAL_RUNTIME_INTEGRATION_NOT_REQUESTED',liveAuthorized:false});
 }
});
