import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublicationDatabaseReadiness,DATABASE_READINESS_SQL} from '../scripts/publication-database-readiness.mjs';
const roles=['reservation','senderRecord','sendRecordRead'];
const cols={reservations:['operation_key','intent_sha256','body_sha256','run_id','run_attempt','status','comment_id','created_at'],send_records:['operation_key','comment_id','created_at']};
const privileges=['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'];
const colPrivileges=['SELECT','INSERT','UPDATE','REFERENCES'];
function fixture(){
 const config={host:'ep-purple-dew-b9mbuikp.c-7.eu-central-1.aws.neon.tech',database:'synthetic_test',
  reservation:{user:'reservation_role',password:'reservation-test'},senderRecord:{user:'sender_role',password:'sender-test'},
  sendRecordRead:{user:'reader_role',password:'reader-test'}};
 const allowed={reservation:{reservations:['SELECT','INSERT'],send_records:[]},
  senderRecord:{reservations:['SELECT'],send_records:['SELECT','INSERT']},sendRecordRead:{reservations:['SELECT'],send_records:['SELECT']}};
 const updates={reservation:['status','comment_id'],senderRecord:['created_at'],sendRecordRead:[]};
 const evidence=Object.fromEntries(roles.map(role=>[role,{currentUser:config[role].user,sessionUser:config[role].user,
  database:config.database,serverVersion:160004,roleFlags:{superuser:false,createDb:false,createRole:false,replication:false,bypassRls:false},
  membership:false,databaseOwner:false,securityDefiner:false,databasePrivileges:{connect:true,connectGrant:false,create:false,createGrant:false},
  schema:{owner:false,usage:true,create:false,usageGrant:false,createGrant:false},
  tls:{ssl:true,version:'TLSv1.3',bits:256},
  timeouts:{statement_timeout:{value:2000,unit:'ms'},lock_timeout:{value:1000,unit:'ms'}},
  tables:Object.keys(cols).map(name=>({name,kind:'r',owner:false,rowSecurity:false,forceRowSecurity:false,
   privileges:Object.fromEntries(privileges.map(p=>[p,{allowed:allowed[role][name].includes(p),grant:false}])),
   columns:cols[name].map(column=>({name:column,privileges:Object.fromEntries(colPrivileges.map(p=>[p,{
    allowed:allowed[role][name].includes(p)||(name==='reservations'&&p==='UPDATE'&&updates[role].includes(column)),grant:false}]))}))}))}]));
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
test('actual pool adapter performs exactly three fixed SELECT snapshots and scoped result only',async()=>{
 const s=fixture(),check=createPublicationDatabaseReadiness(s.config,{Pool:s.Pool}),r=await check();
 assert.equal(r.outcome,'SCOPED_READ_ONLY_CHECKS_PASSED');assert.deepEqual(s.queries,roles);assert.deepEqual(s.closed,roles);
 assert.equal(s.opened.length,3);for(const o of s.opened){assert.equal(o.ssl.rejectUnauthorized,true);assert.equal(o.max,1);
  assert.equal(o.connectionTimeoutMillis,1500);assert.equal(o.statement_timeout,2000);assert.equal(o.query_timeout,2500);assert.equal(o.lock_timeout,1000);}
 sanitized(r,s);assert.equal((await check()).outcome,'ALREADY_CONSUMED');assert.equal(s.queries.length,3);
});
test('SQL is fixed catalog-only SELECT with own-backend session and parameterized target names',()=>{
 assert.ok(DATABASE_READINESS_SQL.startsWith('SELECT '));assert.ok(!DATABASE_READINESS_SQL.includes(';'));
 assert.ok(DATABASE_READINESS_SQL.includes('pg_catalog.pg_stat_ssl s WHERE s.pid=pg_catalog.pg_backend_pid()'));
 for(const term of ['pg_catalog.has_table_privilege','pg_catalog.has_column_privilege',' WITH GRANT OPTION','pg_catalog.pg_has_role',"'MEMBER'",'pg_catalog.unnest($1::text[])'])assert.ok(DATABASE_READINESS_SQL.includes(term),term);
 assert.doesNotMatch(DATABASE_READINESS_SQL,/\b(?:INSERT\s+INTO|UPDATE\s+meridian|DELETE\s+FROM|CREATE\s+(?:ROLE|TABLE)|SET\s+ROLE|FOR\s+UPDATE)\b/i);
});
test('wrong current user session user database and unsupported server version fail scoped checks',async()=>{
 for(const edit of [e=>e.currentUser='PRIVATE_OTHER',e=>e.sessionUser='PRIVATE_OTHER',e=>e.database='PRIVATE_FINANCIAL',
  e=>e.serverVersion=170000,e=>e.serverVersion='160004']){
  const s=fixture();edit(s.evidence.reservation);const r=await createPublicationDatabaseReadiness(s.config,{Pool:s.Pool})();
  assert.equal(r.outcome,'SCOPED_CHECKS_FAILED');assert.deepEqual(s.queries,['reservation']);assert.deepEqual(s.closed,roles);sanitized(r,s);
 }
});
test('dangerous role attributes memberships ownership routines and row security fail closed',async()=>{
 const edits=[...['superuser','createDb','createRole','replication','bypassRls'].map(k=>e=>e.roleFlags[k]=true),
  e=>e.databasePrivileges.connect=false,e=>e.databasePrivileges.connectGrant=true,e=>e.databasePrivileges.create=true,e=>e.databasePrivileges.createGrant=true,
  e=>e.membership=true,e=>e.databaseOwner=true,e=>e.securityDefiner=true,e=>e.schema.owner=true,
  e=>e.schema.create=true,e=>e.schema.usage=false,e=>e.schema.usageGrant=true,e=>e.schema.createGrant=true,
  e=>e.tables[0].owner=true,e=>e.tables[0].rowSecurity=true,e=>e.tables[0].forceRowSecurity=true,e=>e.tables[0].kind='v'];
 for(const edit of edits){const s=fixture();edit(s.evidence.reservation);
  assert.equal((await createPublicationDatabaseReadiness(s.config,{Pool:s.Pool})()).outcome,'SCOPED_CHECKS_FAILED');}
});
test('exact effective table and column privilege matrix rejects missing excess and grant options for every role',async()=>{
 for(const role of roles){
  for(const edit of [e=>e.tables[0].privileges.SELECT.allowed=false,e=>e.tables[0].privileges.UPDATE.allowed=true,
   e=>e.tables[0].privileges.SELECT.grant=true,e=>e.tables[0].privileges.DELETE.allowed=true,
   e=>e.tables[0].columns[0].privileges.SELECT.allowed=false,
   e=>e.tables[0].columns[0].privileges.UPDATE.allowed=true,e=>e.tables[0].columns[0].privileges.REFERENCES.allowed=true,
   e=>e.tables[0].columns[0].privileges.SELECT.grant=true]){
   const s=fixture();edit(s.evidence[role]);assert.equal((await createPublicationDatabaseReadiness(s.config,{Pool:s.Pool})()).outcome,'SCOPED_CHECKS_FAILED');
  }
 }
 for(const [role,column] of [['reservation','status'],['reservation','comment_id'],['senderRecord','created_at']]){
  const s=fixture();s.evidence[role].tables[0].columns.find(c=>c.name===column).privileges.UPDATE.allowed=false;
  assert.equal((await createPublicationDatabaseReadiness(s.config,{Pool:s.Pool})()).outcome,'SCOPED_CHECKS_FAILED');
 }
 const s=fixture();s.evidence.reservation.tables[1].columns[0].privileges.SELECT.allowed=true;
 assert.equal((await createPublicationDatabaseReadiness(s.config,{Pool:s.Pool})()).outcome,'SCOPED_CHECKS_FAILED');
});
test('TLS and exact server statement and lock timeouts must be valid',async()=>{
 for(const edit of [e=>e.tls.ssl=false,e=>e.tls.version='TLSv1.1',e=>e.tls.bits=64,e=>e.tls.bits='256',
  e=>e.timeouts.statement_timeout.value=0,e=>e.timeouts.lock_timeout.value=2000,e=>e.timeouts.statement_timeout.unit='s']){
  const s=fixture();edit(s.evidence.reservation);assert.equal((await createPublicationDatabaseReadiness(s.config,{Pool:s.Pool})()).outcome,'SCOPED_CHECKS_FAILED');
 }
});
test('malformed missing null duplicate and extra catalog fields never pass',async()=>{
 for(const edit of [e=>delete e.tls,e=>e.schema=null,e=>e.membership=null,e=>e.extra=true,e=>e.roleFlags.superuser=null,
  e=>e.tables.pop(),e=>e.tables.push(e.tables[0]),e=>e.tables[1]=e.tables[0],e=>e.tables[0].columns.pop(),
  e=>e.tables[0].columns[0].privileges.UPDATE.allowed=null,e=>e.tables[0].columns.push({name:'extra',privileges:{}}),
  e=>delete e.tables[0].privileges.TRIGGER,e=>e.tables[0].privileges.MAINTAIN={allowed:false,grant:false}]){
  const s=fixture();edit(s.evidence.reservation);assert.equal((await createPublicationDatabaseReadiness(s.config,{Pool:s.Pool})()).outcome,'SCOPED_CHECKS_FAILED');
 }
 for(const response of [null,{rowCount:0,rows:[]},{rowCount:1,rows:[{evidence:null}]},{rowCount:2,rows:[{},{}]}]){
  const s=fixture();s.query(async()=>response);assert.equal((await createPublicationDatabaseReadiness(s.config,{Pool:s.Pool})()).outcome,'SCOPED_CHECKS_FAILED');
 }
});
test('query failures cleanup failures and partial constructor errors are sanitized without retry',async()=>{
 for(const phase of ['query','close','constructor']){
  const s=fixture();let Pool=s.Pool;if(phase==='query')s.query(async()=>{throw Error('PRIVATE_PASSWORD');});
  if(phase==='close')s.end(async()=>{throw Error('PRIVATE_PASSWORD');});
  if(phase==='constructor'){const Base=Pool;let count=0;Pool=class extends Base{constructor(o){if(++count===2)throw Error('PRIVATE_PASSWORD');super(o);}};}
  const r=await createPublicationDatabaseReadiness(s.config,{Pool})();assert.equal(r.outcome,'INDETERMINATE');sanitized(r,s);
  if(phase==='query')assert.deepEqual(s.queries,['reservation']);if(phase==='constructor'){assert.equal(s.queries.length,0);assert.deepEqual(s.closed,['reservation']);}
 }
});
test('configuration is explicit snapshotted and invalid fields never construct pools',async()=>{
 for(const edit of [c=>c.host='financial.invalid',c=>c.database='postgres://secret',c=>c.DATABASE_URL='PRIVATE',
  c=>c.reservation.user='postgres',c=>c.senderRecord.password=c.reservation.password]){
  const s=fixture();edit(s.config);assert.throws(()=>createPublicationDatabaseReadiness(s.config,{Pool:s.Pool}),/^Error: DATABASE_READINESS_CONFIGURATION_REJECTED$/);assert.equal(s.opened.length,0);
 }
 const s=fixture(),check=createPublicationDatabaseReadiness(s.config,{Pool:s.Pool});
 // Use original evidence while external config changes after capture.
 s.config.database='changed';s.config.reservation.password='changed';
 assert.equal((await check()).outcome,'SCOPED_READ_ONLY_CHECKS_PASSED');assert.equal(s.opened[0].database,'synthetic_test');
 const a=fixture();let getters=0;Object.defineProperty(a.config,'host',{enumerable:true,get(){getters++;return 'PRIVATE';}});
 assert.throws(()=>createPublicationDatabaseReadiness(a.config,{Pool:a.Pool}));assert.equal(getters,0);
});
test('pre-abort consumes invocation without creating pools',async()=>{
 const s=fixture(),c=new AbortController();c.abort();const check=createPublicationDatabaseReadiness(s.config,{Pool:s.Pool});
 assert.equal((await check(c.signal)).outcome,'INDETERMINATE');assert.equal((await check()).outcome,'ALREADY_CONSUMED');assert.equal(s.opened.length,0);
});
test('abort during query ignores late success and never starts next role',async()=>{
 const s=fixture(),c=new AbortController();let entered,finish;
 const ready=new Promise(resolve=>{entered=resolve;});s.query(()=>{entered();return new Promise(resolve=>{finish=resolve;});});
 const check=createPublicationDatabaseReadiness(s.config,{Pool:s.Pool}),work=check(c.signal);await ready;c.abort();
 assert.equal((await work).outcome,'INDETERMINATE');finish({rowCount:1,rows:[{evidence:s.evidence.reservation}]});
 await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(s.queries,['reservation']);assert.deepEqual(s.closed,roles);
});
test('deadline bounds unresponsive query and cleanup without accepting late success',async t=>{
 const s=fixture();let entered,finish;const ready=new Promise(resolve=>{entered=resolve;});
 s.query(()=>{entered();return new Promise(resolve=>{finish=resolve;});});s.end(()=>new Promise(()=>{}));
 t.mock.timers.enable({apis:['setTimeout']});
 const work=createPublicationDatabaseReadiness(s.config,{Pool:s.Pool,timeoutMs:100})(undefined);
 await ready;t.mock.timers.tick(100);await new Promise(resolve=>setImmediate(resolve));
 t.mock.timers.tick(2000);assert.equal((await work).outcome,'INDETERMINATE');
 finish({rowCount:1,rows:[{evidence:s.evidence.reservation}]});await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(s.queries,['reservation']);
});
test('caller cancellation during cleanup cannot return a passing result',async()=>{
 const s=fixture(),c=new AbortController();let entered,finish;
 const ready=new Promise(resolve=>{entered=resolve;});const cleanup=new Promise(resolve=>{finish=resolve;});
 s.end(async()=>{entered();await cleanup;});
 const work=createPublicationDatabaseReadiness(s.config,{Pool:s.Pool})(c.signal);
 await ready;c.abort();finish();assert.equal((await work).outcome,'INDETERMINATE');assert.deepEqual(s.queries,roles);
});
test('deadline during otherwise successful cleanup cannot report passed',async t=>{
 const s=fixture();let entered,finish;const ready=new Promise(resolve=>{entered=resolve;});
 const cleanup=new Promise(resolve=>{finish=resolve;});s.end(async()=>{entered();await cleanup;});
 t.mock.timers.enable({apis:['setTimeout']});
 const work=createPublicationDatabaseReadiness(s.config,{Pool:s.Pool,timeoutMs:100})();
 await ready;t.mock.timers.tick(100);finish();assert.equal((await work).outcome,'INDETERMINATE');
});
