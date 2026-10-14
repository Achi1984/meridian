// Opt-in read-only evidence. No environment, driver import, startup or publication.
import {types} from 'node:util';
import {openPublicationPools} from './publication-actions-pools.mjs';
const ROLE_KEYS=['reservation','senderRecord','sendRecordRead'];
const COLUMN_NAMES={reservations:['operation_key','intent_sha256','body_sha256','run_id','run_attempt','status','comment_id','created_at'],
 send_records:['operation_key','comment_id','created_at']};
const COLUMN_PRIVILEGES=['SELECT','INSERT','UPDATE','REFERENCES'];
const TABLE_PRIVILEGES=['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'];
// Only PostgreSQL catalog/builtin reads, fixed target relations, no user SQL or
// user function execution. Parameter values name the two immutable target tables.
export const DATABASE_READINESS_SQL=`SELECT pg_catalog.jsonb_build_object(
 'currentUser',current_user,'sessionUser',session_user,'database',pg_catalog.current_database(),
 'databasePrivileges',pg_catalog.jsonb_build_object(
  'connect',pg_catalog.has_database_privilege(current_user,pg_catalog.current_database(),'CONNECT'),
  'connectGrant',pg_catalog.has_database_privilege(current_user,pg_catalog.current_database(),'CONNECT WITH GRANT OPTION'),
  'create',pg_catalog.has_database_privilege(current_user,pg_catalog.current_database(),'CREATE'),
  'createGrant',pg_catalog.has_database_privilege(current_user,pg_catalog.current_database(),'CREATE WITH GRANT OPTION')),
 'serverVersion',pg_catalog.current_setting('server_version_num')::integer,
 'roleFlags',(SELECT pg_catalog.jsonb_build_object('superuser',r.rolsuper,'createDb',r.rolcreatedb,
  'createRole',r.rolcreaterole,'replication',r.rolreplication,'bypassRls',r.rolbypassrls)
  FROM pg_catalog.pg_roles r WHERE r.rolname=current_user),
 'membership',EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname<>current_user
  AND pg_catalog.pg_has_role(current_user,r.oid,'MEMBER')),
 'databaseOwner',EXISTS(SELECT 1 FROM pg_catalog.pg_database d WHERE d.datname=pg_catalog.current_database()
  AND d.datdba=pg_catalog.to_regrole(current_user)),
 'securityDefiner',EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE p.prosecdef AND pg_catalog.substr(n.nspname,1,3)<>'pg_' AND n.nspname<>'information_schema'
  AND pg_catalog.has_function_privilege(current_user,p.oid,'EXECUTE')),
 'schema',(SELECT pg_catalog.jsonb_build_object('owner',n.nspowner=pg_catalog.to_regrole(current_user),
  'usage',pg_catalog.has_schema_privilege(current_user,n.oid,'USAGE'),
  'create',pg_catalog.has_schema_privilege(current_user,n.oid,'CREATE'),
  'usageGrant',pg_catalog.has_schema_privilege(current_user,n.oid,'USAGE WITH GRANT OPTION'),
  'createGrant',pg_catalog.has_schema_privilege(current_user,n.oid,'CREATE WITH GRANT OPTION'))
  FROM pg_catalog.pg_namespace n WHERE n.nspname='meridian_publisher'),
 'tls',(SELECT pg_catalog.jsonb_build_object('ssl',s.ssl,'version',s.version,'bits',s.bits)
  FROM pg_catalog.pg_stat_ssl s WHERE s.pid=pg_catalog.pg_backend_pid()),
 'timeouts',(SELECT pg_catalog.jsonb_object_agg(s.name,pg_catalog.jsonb_build_object('value',s.setting::integer,'unit',s.unit))
  FROM pg_catalog.pg_settings s WHERE s.name IN ('statement_timeout','lock_timeout')),
 'tables',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',wanted.name,'kind',c.relkind,
  'owner',c.relowner=pg_catalog.to_regrole(current_user),'rowSecurity',c.relrowsecurity,'forceRowSecurity',c.relforcerowsecurity,
  'privileges',(SELECT pg_catalog.jsonb_object_agg(priv.name,pg_catalog.jsonb_build_object(
    'allowed',pg_catalog.has_table_privilege(current_user,c.oid,priv.name),
    'grant',pg_catalog.has_table_privilege(current_user,c.oid,priv.name||' WITH GRANT OPTION')))
   FROM pg_catalog.unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS priv(name)),
  'columns',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',a.attname,
    'privileges',(SELECT pg_catalog.jsonb_object_agg(priv.name,pg_catalog.jsonb_build_object(
     'allowed',pg_catalog.has_column_privilege(current_user,c.oid,a.attnum,priv.name),
     'grant',pg_catalog.has_column_privilege(current_user,c.oid,a.attnum,priv.name||' WITH GRANT OPTION')))
     FROM pg_catalog.unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) AS priv(name))) ORDER BY a.attnum)
   FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)) ORDER BY wanted.name)
  FROM pg_catalog.unnest($1::text[]) AS wanted(name)
  LEFT JOIN pg_catalog.pg_namespace n ON n.nspname='meridian_publisher'
  LEFT JOIN pg_catalog.pg_class c ON c.relnamespace=n.oid AND c.relname=wanted.name)
) AS evidence`;
const result=outcome=>({kind:'INACTIVE_DATABASE_READINESS_RESULT',outcome,
 scope:'PUBLISHER_TEST_CATALOG_PRIVILEGES_AND_CURRENT_SESSIONS',
 liveAuthorized:false,publicationAllowed:false,universalSecurityVerified:false});
function need(ok){if(!ok)throw Error('READINESS_REJECTED');}
function shape(value,names){need(value&&typeof value==='object'&&!types.isProxy(value)&&!Array.isArray(value)
 &&[Object.prototype,null].includes(Object.getPrototypeOf(value))
 &&Reflect.ownKeys(value).every(k=>typeof k==='string')&&Object.keys(value).sort().join()===names);
 for(const d of Object.values(Object.getOwnPropertyDescriptors(value)))need(Object.hasOwn(d,'value')&&d.enumerable);}
function configSnapshot(config){
 shape(config,'database,host,reservation,sendRecordRead,senderRecord');
 need(config.host==='ep-purple-dew-b9mbuikp.c-7.eu-central-1.aws.neon.tech'
  &&typeof config.database==='string'&&/^[a-zA-Z][a-zA-Z0-9_]{0,62}$/.test(config.database));
 const out={host:config.host,database:config.database};
 for(const key of ROLE_KEYS){const r=config[key];shape(r,'password,user');
  need(typeof r.user==='string'&&/^[a-z][a-z0-9_]{2,62}$/.test(r.user)
   &&!/admin|owner|superuser|postgres|root/.test(r.user)&&!r.user.startsWith('pg_')
   &&typeof r.password==='string'&&r.password.length>0&&r.password.length<=4096&&!/[\x00\r\n]/.test(r.password));
  out[key]=Object.freeze({user:r.user,password:r.password});}
 need(new Set(ROLE_KEYS.map(k=>out[k].user)).size===3&&new Set(ROLE_KEYS.map(k=>out[k].password)).size===3);
 return Object.freeze(out);
}
function tableAllowed(role,table,privilege){
 if(privilege==='SELECT')return table==='reservations'||role!=='reservation';
 return privilege==='INSERT'&&(role==='reservation'&&table==='reservations'||role==='senderRecord'&&table==='send_records');
}
function columnAllowed(role,table,column,privilege){
 if(tableAllowed(role,table,privilege))return true;
 return privilege==='UPDATE'&&table==='reservations'&&(role==='reservation'&&['status','comment_id'].includes(column)
  ||role==='senderRecord'&&column==='created_at');
}
function privilege(actual,allowed){shape(actual,'allowed,grant');need(actual.allowed===allowed&&actual.grant===false);}
function validateEvidence(row,role,config){
 shape(row,'evidence');const e=row.evidence;
 shape(e,'currentUser,database,databaseOwner,databasePrivileges,membership,roleFlags,schema,securityDefiner,serverVersion,sessionUser,tables,timeouts,tls');
 need(e.currentUser===config[role].user&&e.sessionUser===config[role].user&&e.database===config.database);
 need(Number.isSafeInteger(e.serverVersion)&&Math.floor(e.serverVersion/10000)===16);
 shape(e.roleFlags,'bypassRls,createDb,createRole,replication,superuser');need(Object.values(e.roleFlags).every(v=>v===false));
 need(e.membership===false&&e.databaseOwner===false&&e.securityDefiner===false);
 shape(e.databasePrivileges,'connect,connectGrant,create,createGrant');
 need(e.databasePrivileges.connect===true&&e.databasePrivileges.connectGrant===false
  &&e.databasePrivileges.create===false&&e.databasePrivileges.createGrant===false);
 shape(e.schema,'create,createGrant,owner,usage,usageGrant');
 need(e.schema.owner===false&&e.schema.usage===true&&e.schema.create===false&&e.schema.usageGrant===false&&e.schema.createGrant===false);
 shape(e.tls,'bits,ssl,version');need(e.tls.ssl===true&&['TLSv1.2','TLSv1.3'].includes(e.tls.version)
  &&Number.isSafeInteger(e.tls.bits)&&e.tls.bits>=128);
 shape(e.timeouts,'lock_timeout,statement_timeout');
 for(const [name,value] of [['statement_timeout',2000],['lock_timeout',1000]]){
  shape(e.timeouts[name],'unit,value');need(e.timeouts[name].unit==='ms'&&e.timeouts[name].value===value);}
 need(Array.isArray(e.tables)&&e.tables.length===2);
 const names=e.tables.map(t=>t?.name);need(new Set(names).size===2&&names.every(n=>Object.hasOwn(COLUMN_NAMES,n)));
 const tablePrivileges=TABLE_PRIVILEGES;
 for(const table of e.tables){
  shape(table,'columns,forceRowSecurity,kind,name,owner,privileges,rowSecurity');
  need(table.kind==='r'&&table.owner===false&&table.rowSecurity===false&&table.forceRowSecurity===false);
  shape(table.privileges,[...tablePrivileges].sort().join());
  for(const p of tablePrivileges)privilege(table.privileges[p],tableAllowed(role,table.name,p));
  need(Array.isArray(table.columns)&&table.columns.length===COLUMN_NAMES[table.name].length);
  const columns=table.columns.map(c=>c?.name);need(new Set(columns).size===columns.length
   &&columns.every(c=>COLUMN_NAMES[table.name].includes(c)));
  for(const column of table.columns){shape(column,'name,privileges');shape(column.privileges,[...COLUMN_PRIVILEGES].sort().join());
   for(const p of COLUMN_PRIVILEGES)privilege(column.privileges[p],columnAllowed(role,table.name,column.name,p));}
 }
}
export function createPublicationDatabaseReadiness(trustedConfig,{Pool,timeoutMs=10000}={}){
 let config;try{config=configSnapshot(trustedConfig);need(typeof Pool==='function'&&Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=15000);}
 catch{throw Error('DATABASE_READINESS_CONFIGURATION_REJECTED');}
 let consumed=false;
 return async function check(parentSignal){
  if(consumed)return result('ALREADY_CONSUMED');consumed=true;
  let pools,timer,listener,stop,ended=false,interrupted=false,outcome='INDETERMINATE';
  const controller=new AbortController();const endsAt=performance.now()+timeoutMs;
  const stopped=new Promise((_,reject)=>{stop=()=>{interrupted=true;controller.abort();reject(Error('STOPPED'));};});stopped.catch(()=>{});
  const guard=()=>need(!controller.signal.aborted&&!parentSignal?.aborted&&performance.now()<endsAt);
  const bounded=async work=>{guard();const value=await Promise.race([
   Promise.resolve().then(()=>{guard();return work();}),stopped]);guard();return value;};
  const close=async value=>{if(!value||ended)return;ended=true;await value.close();};
  try{
   need(parentSignal===undefined||parentSignal instanceof AbortSignal);guard();listener=stop;
   parentSignal?.addEventListener('abort',listener,{once:true});timer=setTimeout(stop,timeoutMs);
   const opening=openPublicationPools(config,{Pool}).then(async value=>{
    pools=value;if(controller.signal.aborted){await close(value);throw Error('STOPPED');}return value;});opening.catch(()=>{});
   pools=await bounded(()=>opening);
   for(const [role,pool] of [['reservation',pools.reservationPool],['senderRecord',pools.senderRecordPool],['sendRecordRead',pools.sendRecordReadPool]]){
    const q=await bounded(()=>pool.query(DATABASE_READINESS_SQL,[['reservations','send_records']]));
    try{need(q?.rowCount===1&&Array.isArray(q.rows)&&q.rows.length===1);validateEvidence(q.rows[0],role,config);}
    catch{outcome='SCOPED_CHECKS_FAILED';throw Error('INVALID_EVIDENCE');}
   }
   guard();outcome='SCOPED_READ_ONLY_CHECKS_PASSED';
  }catch{}
  finally{controller.abort();
   try{await close(pools);}catch{outcome='INDETERMINATE';}
   finally{clearTimeout(timer);if(parentSignal instanceof AbortSignal)parentSignal.removeEventListener('abort',listener);
    if(interrupted||parentSignal?.aborted||performance.now()>=endsAt)outcome='INDETERMINATE';}}

  return result(outcome);
 };
}
