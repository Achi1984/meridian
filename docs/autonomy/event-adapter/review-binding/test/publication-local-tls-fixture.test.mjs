import test from 'node:test';
import assert from 'node:assert/strict';
import tls from 'node:tls';
import {X509Certificate} from 'node:crypto';
import {mkdtempSync,readFileSync,readdirSync,statSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createLocalPoolAdapter,createFixtureCertificates,localDockerCreateArguments,withPublicationTlsPostgres,PINNED_POSTGRES_IMAGE} from '../scripts/publication-local-tls-fixture.mjs';
const HOST='ep-purple-dew-b9mbuikp.c-7.eu-central-1.aws.neon.tech';
const config={host:HOST,database:'publisher_test',reservation:{user:'reservation',password:'synthetic'},senderRecord:{user:'sender',password:'synthetic2'},sendRecordRead:{user:'reader',password:'synthetic3'}};
const options=()=>({host:HOST,port:5432,database:'publisher_test',...config.reservation,ssl:{rejectUnauthorized:true,servername:HOST,minVersion:'TLSv1.2',checkServerIdentity:tls.checkServerIdentity},max:1,connectionTimeoutMillis:1500,statement_timeout:2000,query_timeout:2500,lock_timeout:1000,idleTimeoutMillis:1000,allowExitOnIdle:true,options:'-c statement_timeout=2000 -c lock_timeout=1000 -c search_path=pg_catalog',application_name:'meridian-publication-test'});
class FakePool{constructor(value){this.options=value;}query(){return 'forwarded';}}
const adapter=()=>createLocalPoolAdapter({Pool:FakePool,config,port:54321,ca:'-----BEGIN CERTIFICATE-----synthetic'});

test('explicit local opt-in required before any fixture work',async()=>{
 await assert.rejects(withPublicationTlsPostgres({optIn:'',Pool:FakePool},()=>assert.fail()),/^Error: LOCAL_TLS_POSTGRES_FIXTURE_FAILED$/);
});
test('only TCP address and test CA change; subclass query remains effective',()=>{
 const Local=adapter();class FaultPool extends Local{query(){return 'injected';}}
 const pool=new FaultPool(options());assert.equal(pool.query(),'injected');
 assert.equal(pool.options.host,'127.0.0.1');assert.equal(pool.options.port,54321);
 assert.equal(pool.options.ssl.servername,HOST);assert.equal(pool.options.ssl.rejectUnauthorized,true);
 assert.equal(pool.options.ssl.checkServerIdentity,tls.checkServerIdentity);
 assert.equal(new Local(options()).query(),'forwarded');
});
test('adapter rejects production-option drift before constructing driver',()=>{
 for(const mutate of [o=>o.host='elsewhere.invalid',o=>o.ssl=false,o=>o.ssl.rejectUnauthorized=false,o=>o.ssl.servername='elsewhere.invalid',o=>o.password='other',o=>o.connectionString='postgres://remote.invalid/db',o=>o.port=1234]){
  const value=options();mutate(value);assert.throws(()=>new (adapter())(value));
 }
 assert.throws(()=>createLocalPoolAdapter({Pool:FakePool,config,port:0,ca:'BEGIN CERTIFICATE'}));
});
test('Docker plan pins local ephemeral port and cached digest; refuses names outside ownership',()=>{
 const token='a'.repeat(24),name='meridian-local-tls-'+token,pw='b'.repeat(48);
 const args=localDockerCreateArguments(name,token,pw);
 assert.equal(args[args.indexOf('--publish')+1],'127.0.0.1::5432');
 assert.equal(args[args.indexOf('--pull')+1],'never');assert.ok(args.includes(PINNED_POSTGRES_IMAGE));
 assert.equal(args[args.indexOf('--label')+1],'meridian.local-tls='+token);
 assert.match(args.at(-1),/ssl=on/);assert.match(args.at(-1),/hba_file=/);
 assert.throws(()=>localDockerCreateArguments('other',token,pw));
 assert.throws(()=>localDockerCreateArguments(name,token,'external-secret'));
});
test('real OpenSSL certificates verify SAN and separate CA; signing keys removed',()=>{
 const directory=mkdtempSync(join(tmpdir(),'meridian-cert-test-'));
 try{
  createFixtureCertificates(directory);
  const cert=new X509Certificate(readFileSync(join(directory,'server.crt')));
  const ca=new X509Certificate(readFileSync(join(directory,'ca.crt')));
  const wrong=new X509Certificate(readFileSync(join(directory,'wrong-ca.crt')));
  assert.equal(cert.verify(ca.publicKey),true);assert.equal(cert.verify(wrong.publicKey),false);
  assert.equal(cert.checkHost(HOST),HOST);assert.equal(cert.checkHost('localhost'),'localhost');
  assert.equal(cert.checkIP('127.0.0.1'),'127.0.0.1');assert.equal(cert.checkHost('wrong.invalid'),undefined);
  assert.equal(statSync(join(directory,'server.key')).mode&0o777,0o600);
  assert.equal(readdirSync(directory).some(name=>['ca.key','wrong-ca.key','server.csr','server.ext'].includes(name)),false);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
