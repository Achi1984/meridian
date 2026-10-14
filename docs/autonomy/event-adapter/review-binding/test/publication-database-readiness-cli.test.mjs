import test from 'node:test';
import assert from 'node:assert/strict';
import {DATABASE_READINESS_SQL} from '../scripts/publication-database-readiness.mjs';
const roles=['reservation','senderRecord','sendRecordRead'];
const cols={reservations:['operation_key','intent_sha256','body_sha256','run_id','run_attempt','status','comment_id','created_at'],send_records:['operation_key','comment_id','created_at']};
const privileges=['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'];
const colPrivileges=['SELECT','INSERT','UPDATE','REFERENCES'];
function fixture(){
 const config={host:'ep-purple-dew-b9mbuikp.c-7.eu-central-1.aws.neon.tech',database:'synthetic_test',
  reservation:{user:'reservation_role',password:'reservation-test'},senderRecord:{user:'sender_role',password:'sender-test'},
  sendRecordRead:{user:'reader_role',password:'reader-test'}};
 const allowed={reservation:{reservations:['SELECT'],send_records:[]},
  senderRecord:{reservations:['SELECT'],send_records:['SELECT','INSERT']},sendRecordRead:{reservations:['SELECT'],send_records:['SELECT']}};
 const updates={reservation:['status','comment_id'],senderRecord:['created_at'],sendRecordRead:[]};
 const evidence=Object.fromEntries(roles.map(role=>[role,{currentUser:config[role].user,sessionUser:config[role].user,
  database:config.database,searchPath:'pg_catalog',serverVersion:160004,roleFlags:{superuser:false,createDb:false,createRole:false,replication:false,bypassRls:false},
  membership:false,databaseOwner:false,securityDefiner:false,databasePrivileges:{connect:true,connectGrant:false,create:false,createGrant:false},
  schema:{owner:false,usage:true,create:false,usageGrant:false,createGrant:false},
  tls:{ssl:true,version:'TLSv1.3',bits:256},
  timeouts:{statement_timeout:{value:2000,unit:'ms'},lock_timeout:{value:1000,unit:'ms'}},
  tables:Object.keys(cols).map(name=>({name,kind:'r',owner:false,rowSecurity:false,forceRowSecurity:false,
   privileges:Object.fromEntries(privileges.map(p=>[p,{allowed:allowed[role][name].includes(p),grant:false}])),
   columns:cols[name].map(column=>({name:column,privileges:Object.fromEntries(colPrivileges.map(p=>[p,{
    allowed:allowed[role][name].includes(p)||(name==='reservations'&&role==='reservation'&&p==='INSERT'&&['operation_key','intent_sha256','body_sha256','run_id','run_attempt','status'].includes(column))||(name==='reservations'&&p==='UPDATE'&&updates[role].includes(column)),grant:false}]))}))}))}]));
 const opened=[],queries=[],closed=[];
 let handler=async(role)=>({rowCount:1,rows:[{evidence:evidence[role]}]}),endHandler=async()=>{};
 class Pool{
  constructor(options){opened.push(options);this.role=roles.find(r=>config[r].user===options.user);assert.ok(this.role);}
  on(name,callback){assert.equal(name,'error');assert.equal(typeof callback,'function');return this;}
  async query(sql,args){queries.push(this.role);assert.equal(sql,DATABASE_READINESS_SQL);
   assert.deepEqual(args,[['reservations','send_records']]);return handler(this.role);}
  async end(){closed.push(this.role);await endHandler(this.role);}
 }
 return {config,evidence,Pool,opened,queries,closed,query:fn=>{handler=fn;},end:fn=>{endHandler=fn;}};
}
function sanitized(r,s){const text=JSON.stringify(r);for(const key of roles){assert.ok(!text.includes(s.config[key].user));assert.ok(!text.includes(s.config[key].password));}
 assert.ok(!text.includes('PRIVATE'));assert.equal(r.liveAuthorized,false);assert.equal(r.publicationAllowed,false);assert.equal(r.universalSecurityVerified,false);}

import {runPublicationDatabaseReadinessCli} from '../scripts/publication-database-readiness-cli.mjs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const cli=fileURLToPath(new URL('../scripts/publication-database-readiness-cli.mjs',import.meta.url));
const names=['DATABASE','RESERVATION_USER','RESERVATION_PASSWORD','SENDER_USER','SENDER_PASSWORD','READER_USER','READER_PASSWORD']
 .map(x=>'MERIDIAN_PUBLISHER_TEST_'+x);
function cliFixture(){
 const s=fixture(),reads=[],output=[],codes=[],hardExits=[],signals=new Map();let loads=0;
 const values=[s.config.database,s.config.reservation.user,s.config.reservation.password,
  s.config.senderRecord.user,s.config.senderRecord.password,s.config.sendRecordRead.user,s.config.sendRecordRead.password];
 const env=Object.fromEntries(names.map((n,i)=>[n,values[i]]));
 const processApi={writeStdout:text=>{output.push(text);},setExitCode:code=>{codes.push(code);},
  hardExit:code=>{hardExits.push(code);},onSignal:(name,fn)=>{signals.set(name,fn);},
  offSignal:(name,fn)=>{if(signals.get(name)===fn)signals.delete(name);}};
 const deps={readEnv:name=>{reads.push(name);return env[name];},loadPg:async()=>{loads++;return {Pool:s.Pool};},processApi};
 return {...s,env,reads,output,codes,hardExits,signals,deps,loads:()=>loads};
}
function result(s){assert.equal(s.output.length,1);const r=JSON.parse(s.output[0]);sanitized(r,s);return r;}
test('missing extra or wrong flag reads zero environment imports zero driver and constructs zero pools',async()=>{
 for(const argv of [[],['--check'],['--check-test-db','--host=evil'],['--check-test-db','--check-test-db'],null]){
  const s=cliFixture();assert.equal(await runPublicationDatabaseReadinessCli(argv,s.deps),2);
  assert.equal(result(s).outcome,'NOT_REQUESTED');assert.deepEqual(s.reads,[]);assert.equal(s.loads(),0);assert.equal(s.opened.length,0);assert.equal(s.signals.size,0);
 }
});
test('direct execution without flag is disabled and ordinary import has no output',()=>{
 const disabled=spawnSync(process.execPath,[cli],{encoding:'utf8',timeout:5000});
 assert.equal(disabled.status,2);assert.equal(disabled.stderr,'');
 assert.equal(JSON.parse(disabled.stdout).outcome,'NOT_REQUESTED');
 const imported=spawnSync(process.execPath,['--input-type=module','-e','await import('+JSON.stringify(new URL('../scripts/publication-database-readiness-cli.mjs',import.meta.url).href)+');'],{encoding:'utf8',timeout:5000});
 assert.equal(imported.status,0);assert.equal(imported.stdout,'');assert.equal(imported.stderr,'');
});
test('real checker and pool adapter use seven explicit values three SELECTs and cleanup before pass',async()=>{
 const s=cliFixture();s.deps.processApi.writeStdout=async text=>{assert.deepEqual(s.closed,roles);s.output.push(text);};
 assert.equal(await runPublicationDatabaseReadinessCli(['--check-test-db'],s.deps),0);
 assert.deepEqual(s.reads,names);assert.equal(s.loads(),1);assert.deepEqual(s.queries,roles);assert.deepEqual(s.closed,roles);
 assert.equal(result(s).outcome,'SCOPED_READ_ONLY_CHECKS_PASSED');assert.equal(s.codes.at(-1),0);assert.equal(s.signals.size,0);
 assert.ok(s.opened.every(o=>o.host==='ep-purple-dew-b9mbuikp.c-7.eu-central-1.aws.neon.tech'&&o.ssl.rejectUnauthorized));
});
test('missing malformed reused or admin credentials fail actual validator before pg import',async()=>{
 for(const edit of [e=>delete e[names[0]],e=>e[names[1]]='postgres',e=>e[names[2]]='',e=>e[names[3]]=e[names[1]],
  e=>e[names[4]]=e[names[2]],e=>e[names[0]]='postgres://PRIVATE',e=>e[names[6]]='line\nbreak']){
  const s=cliFixture();edit(s.env);assert.equal(await runPublicationDatabaseReadinessCli(['--check-test-db'],s.deps),2);
  assert.equal(result(s).outcome,'CONFIGURATION_REJECTED');assert.equal(s.loads(),0);assert.equal(s.opened.length,0);
 }
});
test('generic DATABASE_URL and PG variables never supply missing configuration',async()=>{
 const s=cliFixture();delete s.env[names[0]];s.env.DATABASE_URL='PRIVATE_DATABASE_URL';s.env.PGDATABASE='financial';
 assert.equal(await runPublicationDatabaseReadinessCli(['--check-test-db'],s.deps),2);
 assert.deepEqual(s.reads,names);assert.equal(s.loads(),0);assert.equal(result(s).outcome,'CONFIGURATION_REJECTED');
});
test('driver import failures and malformed module are sanitized with no pool creation',async()=>{
 for(const loadPg of [async()=>{throw Error('PRIVATE_DRIVER');},async()=>({}),async()=>({Pool:'PRIVATE'})]){
  const s=cliFixture();s.deps.loadPg=loadPg;
  assert.equal(await runPublicationDatabaseReadinessCli(['--check-test-db'],s.deps),1);
  assert.equal(result(s).outcome,'INDETERMINATE');assert.equal(s.opened.length,0);assert.equal(s.signals.size,0);
 }
});
test('SQL evidence failure and driver errors produce only sanitized nonzero status',async()=>{
 for(const mode of ['evidence','query']){
  const s=cliFixture();if(mode==='evidence')s.evidence.reservation.tls.ssl=false;
  else s.query(async()=>{throw Error('PRIVATE_PASSWORD SQL_ERROR');});
  assert.equal(await runPublicationDatabaseReadinessCli(['--check-test-db'],s.deps),1);
  assert.equal(result(s).outcome,mode==='evidence'?'SCOPED_CHECKS_FAILED':'INDETERMINATE');assert.deepEqual(s.closed,roles);
 }
});
test('SIGINT and SIGTERM during driver load prevent late pool construction',async()=>{
 for(const [signal,code] of [['SIGINT',130],['SIGTERM',143]]){
  const s=cliFixture();let entered,finish;const ready=new Promise(resolve=>{entered=resolve;});
  s.deps.loadPg=()=>{entered();return new Promise(resolve=>{finish=resolve;});};
  const work=runPublicationDatabaseReadinessCli(['--check-test-db'],s.deps);await ready;s.signals.get(signal)();
  assert.equal(await work,code);assert.equal(result(s).outcome,'INTERRUPTED');finish({Pool:s.Pool});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(s.opened.length,0);assert.equal(s.signals.size,0);
 }
});
test('overall deadline covers hung driver import and ignores late loaded driver',async t=>{
 const s=cliFixture();s.deps.timeoutMs=100;let entered,finish;const ready=new Promise(resolve=>{entered=resolve;});
 s.deps.loadPg=()=>{entered();return new Promise(resolve=>{finish=resolve;});};t.mock.timers.enable({apis:['setTimeout']});
 const work=runPublicationDatabaseReadinessCli(['--check-test-db'],s.deps);await ready;t.mock.timers.tick(100);
 assert.equal(await work,124);assert.equal(result(s).outcome,'DEADLINE_EXCEEDED');finish({Pool:s.Pool});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(s.opened.length,0);assert.equal(s.hardExits.length,0);
});
test('independent hard exit fallback is exercised through injected process API only',async t=>{
 const s=cliFixture();s.deps.timeoutMs=100;let entered;const ready=new Promise(resolve=>{entered=resolve;});
 s.deps.loadPg=()=>{entered();return new Promise(()=>{});};t.mock.timers.enable({apis:['setTimeout']});
 const work=runPublicationDatabaseReadinessCli(['--check-test-db'],s.deps);await ready;
 // Advancing both timers before promise continuations models delayed handling.
 t.mock.timers.tick(3100);assert.deepEqual(s.hardExits,[124]);assert.equal(await work,124);
});
test('output failure or stalled flush cannot return success and leaks no raw exception',async t=>{
 for(const mode of ['reject','stall']){
  const s=cliFixture();let entered;const ready=new Promise(resolve=>{entered=resolve;});
  s.deps.processApi.writeStdout=()=>{entered();if(mode==='reject')throw Error('PRIVATE_OUTPUT');return new Promise(()=>{});};
  if(mode==='stall')t.mock.timers.enable({apis:['setTimeout']});
  const work=runPublicationDatabaseReadinessCli(['--check-test-db'],s.deps);await ready;
  if(mode==='stall')t.mock.timers.tick(1000);
  assert.equal(await work,1);assert.equal(s.codes.at(-1),1);assert.equal(s.output.length,0);
  if(mode==='stall')t.mock.timers.reset();
 }
});
test('signal during catalog query aborts one attempt and never queries the remaining roles',async()=>{
 const s=cliFixture();let entered,finish;const ready=new Promise(resolve=>{entered=resolve;});
 s.query(()=>{entered();return new Promise(resolve=>{finish=resolve;});});
 const work=runPublicationDatabaseReadinessCli(['--check-test-db'],s.deps);await ready;s.signals.get('SIGTERM')();
 assert.equal(await work,143);assert.equal(result(s).outcome,'INTERRUPTED');
 finish({rowCount:1,rows:[{evidence:s.evidence.reservation}]});await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(s.queries,['reservation']);assert.deepEqual(s.closed,roles);
});
test('signal while pass output is flushing prevents a successful exit status',async()=>{
 const s=cliFixture();let entered,finish;const ready=new Promise(resolve=>{entered=resolve;});
 s.deps.processApi.writeStdout=text=>{s.output.push(text);entered();return new Promise(resolve=>{finish=resolve;});};
 const work=runPublicationDatabaseReadinessCli(['--check-test-db'],s.deps);await ready;
 assert.deepEqual(s.closed,roles);s.signals.get('SIGINT')();finish();
 assert.equal(await work,130);assert.equal(s.codes.at(-1),130);
 assert.equal(result(s).outcome,'SCOPED_READ_ONLY_CHECKS_PASSED');
});

