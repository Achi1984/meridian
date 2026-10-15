// Explicit disposable local Docker fixture. Importing this module does nothing.
import assert from 'node:assert/strict';
import tls from 'node:tls';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

export const LOCAL_TLS_OPT_IN='LOCAL_PG16_TLS_ONLY';
export const PINNED_POSTGRES_IMAGE='postgres@sha256:75adc2a65806c96bc0e59030230bfe3f1c1b0d6d8f8181a8913e2b8b53bdc166';
const HOST='ep-purple-dew-b9mbuikp.c-7.eu-central-1.aws.neon.tech';
const ROLE_KEYS=['reservation','senderRecord','sendRecordRead'];
const FAIL='LOCAL_TLS_POSTGRES_FIXTURE_FAILED';

export function createLocalPoolAdapter({Pool,config,port,ca,track=()=>{}}){
 assert.equal(typeof Pool,'function');assert.equal(config.host,HOST);
 assert.equal(config.database,'publisher_test');
 assert.ok(Number.isInteger(port)&&port>0&&port<=65535);
 assert.equal(typeof ca,'string');assert.ok(ca.includes('BEGIN CERTIFICATE'));
 return class LocalTransportPool extends Pool{
  constructor(options){
   const role=ROLE_KEYS.map(k=>config[k]).find(r=>r.user===options.user);
   assert.ok(role);
   assert.deepEqual(options,{host:HOST,port:5432,database:'publisher_test',
    user:role.user,password:role.password,
    ssl:{rejectUnauthorized:true,servername:HOST,minVersion:'TLSv1.2',checkServerIdentity:tls.checkServerIdentity},
    max:1,connectionTimeoutMillis:1500,statement_timeout:2000,query_timeout:2500,
    lock_timeout:1000,idleTimeoutMillis:1000,allowExitOnIdle:true,
    options:'-c statement_timeout=2000 -c lock_timeout=1000 -c search_path=pg_catalog',
    application_name:'meridian-publication-test'});
   super({...options,host:'127.0.0.1',port,ssl:{...options.ssl,ca}});
   track(this);
  }
 };
}

// Cache failures as well as success: cleanup must not retry a failed close.
export function cachePoolEnd(pool){
 const end=pool.end.bind(pool);let ending;
 pool.end=()=>{if(!ending)ending=Promise.resolve().then(end);return ending;};
}

export async function waitForLocalPostgres(admin,{now=()=>performance.now(),sleep=delay}={}){
 const deadline=now()+30000;
 while(now()<deadline){
  let timer,ready=false;
  try{
   await Promise.race([admin.query('SELECT 1'),new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(new Error(FAIL)),Math.max(1,deadline-now()));
   })]);
   ready=now()<deadline;
  }catch{}finally{clearTimeout(timer);}
  if(ready)return;
  const remaining=deadline-now();
  if(remaining>0)await sleep(Math.min(250,remaining));
 }
 throw new Error(FAIL+'_STARTUP');
}

async function boundedEnd(pool){
 let timer;
 try{await Promise.race([pool.end(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(FAIL)),3000);})]);}
 finally{clearTimeout(timer);}
}

export function createFixtureCertificates(directory,run=(args)=>execFileSync('openssl',args,{timeout:15000,stdio:['ignore','pipe','pipe']})){
 const path=file=>join(directory,file);
 run(['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=Meridian disposable CA',
  '-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign',
  '-keyout',path('ca.key'),'-out',path('ca.crt')]);
 run(['req','-new','-newkey','rsa:2048','-nodes','-subj','/CN=localhost',
  '-keyout',path('server.key'),'-out',path('server.csr')]);
 writeFileSync(path('server.ext'),`subjectAltName=DNS:localhost,DNS:${HOST},IP:127.0.0.1\nbasicConstraints=critical,CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n`);
 run(['x509','-req','-in',path('server.csr'),'-CA',path('ca.crt'),'-CAkey',path('ca.key'),
  '-CAcreateserial','-days','1','-extfile',path('server.ext'),'-out',path('server.crt')]);
 run(['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=Meridian unrelated CA',
  '-addext','basicConstraints=critical,CA:TRUE','-keyout',path('wrong-ca.key'),'-out',path('wrong-ca.crt')]);
 for(const file of ['ca.key','wrong-ca.key','server.csr','server.ext'])rmSync(path(file));
 chmodSync(path('server.key'),0o600);
}

export function localDockerCreateArguments(name,token,password){
 assert.match(token,/^[a-f0-9]{24}$/);assert.equal(name,'meridian-local-tls-'+token);assert.match(password,/^[a-f0-9]{48}$/);
 return ['create','--pull','never','--name',name,'--label','meridian.local-tls='+token,
  '--memory','256m','--cpus','1','--publish','127.0.0.1::5432',
  '--env','POSTGRES_DB=publisher_test','--env','POSTGRES_PASSWORD='+password,
  '--entrypoint','/bin/sh',PINNED_POSTGRES_IMAGE,'-ceu',
  'chown -R postgres:postgres /meridian-tls; chmod 600 /meridian-tls/server.key; exec /usr/local/bin/docker-entrypoint.sh postgres -c ssl=on -c ssl_min_protocol_version=TLSv1.2 -c ssl_cert_file=/meridian-tls/server.crt -c ssl_key_file=/meridian-tls/server.key -c hba_file=/meridian-tls/pg_hba.conf'];
}

export async function withPublicationTlsPostgres({optIn,Pool},run){
 if(optIn!==LOCAL_TLS_OPT_IN||typeof Pool!=='function'||typeof run!=='function')throw new Error(FAIL);
 const token=randomBytes(12).toString('hex'),name='meridian-local-tls-'+token;
 const directory=mkdtempSync(join(tmpdir(),'meridian-local-tls-'));
 chmodSync(directory,0o700);
 const pools=new Set();let attempted=false,clean=true,stage='IMAGE';
 const invoke=(program,args,timeout=15000)=>execFileSync(program,args,{timeout,maxBuffer:1024*1024,stdio:['ignore','pipe','pipe']});
 // Explicit Unix socket prevents DOCKER_HOST/context from selecting a remote daemon.
 const docker=(...args)=>invoke('docker',['--host','unix:///var/run/docker.sock',...args]);
 const track=pool=>{
  cachePoolEnd(pool);
  pools.add(pool);pool.on('error',()=>{});
 };
 try{
  docker('image','inspect',PINNED_POSTGRES_IMAGE); // No implicit image pull/install.
  stage='CERTIFICATES';
  createFixtureCertificates(directory,args=>invoke('openssl',args));
  writeFileSync(join(directory,'pg_hba.conf'),'local all all trust\nhostnossl all all 0.0.0.0/0 reject\nhostssl all all 0.0.0.0/0 scram-sha-256\n');
  const adminPassword=randomBytes(24).toString('hex');
  stage='CREATE';attempted=true;
  docker(...localDockerCreateArguments(name,token,adminPassword));
  // Copy only the server material, not the CA signing key.
  // Signing keys were removed before copying the directory into the container.
  stage='START';
  docker('cp',directory,name+':/meridian-tls');docker('start',name);
  stage='PORT';
  const match=/^127\.0\.0\.1:(\d+)\s*$/.exec(docker('port',name,'5432/tcp').toString());
  assert.ok(match);const port=Number(match[1]),ca=readFileSync(join(directory,'ca.crt'),'utf8');
  const base={host:'127.0.0.1',port,database:'publisher_test',user:'postgres',password:adminPassword,
   ssl:{rejectUnauthorized:true,servername:'localhost',ca,minVersion:'TLSv1.2',checkServerIdentity:tls.checkServerIdentity},
   connectionTimeoutMillis:1500,statement_timeout:2000,query_timeout:2500,
   options:'-c statement_timeout=2000 -c lock_timeout=1000 -c search_path=pg_catalog',max:1,allowExitOnIdle:true};
  const pool=options=>{const p=new Pool(options);track(p);return p;};
  stage='STARTUP';
  const admin=pool(base);await waitForLocalPostgres(admin);
  stage='VERSION';
  assert.equal(Math.floor(Number((await admin.query('SHOW server_version_num')).rows[0].server_version_num)/10000),16);
  stage='SCHEMA';
  for(const file of ['publication-ledger.sql','publication-send-record.sql'])
   await admin.query(readFileSync(new URL('../fixtures/'+file,import.meta.url),'utf8'));
  const config={host:HOST,database:'publisher_test'};
  const names=['publisher_reservation_test','publisher_sender_test','publisher_reader_test'];
  stage='ROLES';
  for(let i=0;i<3;i++){
   const password=randomBytes(24).toString('hex');config[ROLE_KEYS[i]]={user:names[i],password};
   await admin.query(`CREATE ROLE ${names[i]} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD '${password}'`);
  }
  stage='GRANTS';
  await admin.query(`GRANT CONNECT ON DATABASE publisher_test TO ${names.join(',')};
   GRANT USAGE ON SCHEMA meridian_publisher TO ${names.join(',')};
   GRANT SELECT ON meridian_publisher.reservations TO ${names[0]},${names[1]},${names[2]};
   GRANT INSERT(operation_key,intent_sha256,body_sha256,run_id,run_attempt,status) ON meridian_publisher.reservations TO ${names[0]};
   GRANT UPDATE(status,comment_id) ON meridian_publisher.reservations TO ${names[0]};
   GRANT UPDATE(created_at) ON meridian_publisher.reservations TO ${names[1]};
   GRANT SELECT,INSERT ON meridian_publisher.send_records TO ${names[1]};
   GRANT SELECT ON meridian_publisher.send_records TO ${names[2]};`);
  const LocalPool=createLocalPoolAdapter({Pool,config,port,ca,track});
  const localPool=key=>{assert.ok(ROLE_KEYS.includes(key));return pool({...base,...config[key]});};
  async function verifyTransportRejections(){
   const probes=[
    [{...base.ssl,ca:readFileSync(join(directory,'wrong-ca.crt'),'utf8')},e=>['SELF_SIGNED_CERT_IN_CHAIN','UNABLE_TO_VERIFY_LEAF_SIGNATURE','UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].includes(e.code)],
    [{...base.ssl,servername:'wrong.invalid'},e=>e.code==='ERR_TLS_CERT_ALTNAME_INVALID'],
    [false,e=>e.code==='28000'&&/pg_hba.conf rejects connection/.test(e.message)&&/no encryption/.test(e.message)]
   ];
   for(const [i,[ssl,expected]] of probes.entries()){
    stage=['TLS_CA','TLS_HOSTNAME','TLS_REQUIRED'][i];
    const probe=pool({...base,ssl});await assert.rejects(probe.query('SELECT 1'),expected);await boundedEnd(probe);pools.delete(probe);
   }
   stage='RUNTIME';
   return {cases:3,productionEvidence:false};
  }
  stage='RUNTIME';
  return await run({kind:'DISPOSABLE_LOOPBACK_PG16_TLS',admin,config,Pool:LocalPool,localPool,verifyTransportRejections});
 }catch{throw new Error(FAIL+'_'+stage);}
 finally{
  const results=await Promise.allSettled([...pools].map(boundedEnd));
  clean=results.every(r=>r.status==='fulfilled');
  if(attempted){try{
   const owned=docker('inspect','--format','{{ index .Config.Labels "meridian.local-tls" }}',name).toString().trim();
   if(owned===token)docker('rm','--force','--volumes',name);else clean=false;
  }catch{clean=false;}}
  try{rmSync(directory,{recursive:true,force:true});}catch{clean=false;}
  if(!clean)throw new Error('LOCAL_TLS_POSTGRES_CLEANUP_UNCONFIRMED');
 }
}
