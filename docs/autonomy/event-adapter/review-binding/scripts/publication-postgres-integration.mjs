// Disposable local Docker test only. Never accepts a connection string or host.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {reserve,settle} from './publication-ledger.mjs';

assert.equal(process.env.MERIDIAN_ISOLATED_DB_TEST,'YES');
assert.equal(process.env.GITHUB_ACTIONS,'true');
assert.equal(process.env.GITHUB_EVENT_NAME,'workflow_dispatch');
const digest=process.env.MERIDIAN_POSTGRES_DIGEST;
assert.match(digest??'',/^sha256:[a-f0-9]{64}$/);
const {default:pg}=await import('pg');
const name='meridian-publisher-test-'+process.pid;
const docker=(...args)=>execFileSync('docker',args,{timeout:90000,stdio:['ignore','pipe','pipe']});
const config={host:'127.0.0.1',port:15432,database:'publisher_test',
 user:'postgres',password:'isolated-test-only',ssl:false,
 connectionTimeoutMillis:2000,statement_timeout:3000,query_timeout:4000,max:4};
let admin,app,created=false,checks=0;
const pool=(extra={})=>{const p=new pg.Pool({...config,...extra});p.on('error',()=>{});return p;};
const binding=n=>({operationKey:n.toString(16).padStart(64,'0'),
 intentSha256:'b'.repeat(64),bodySha256:'c'.repeat(64),runId:123,runAttempt:1});
async function ready(){
 for(let i=0;i<30;i++){
  try{await admin.query('SELECT 1');return;}catch{await delay(500);}
 }throw new Error('ISOLATED_POSTGRES_NOT_READY');
}
async function denied(p,sql,code){await assert.rejects(p.query(sql),e=>e.code===code);checks++;}
try{
 docker('run','--detach','--name',name,'--memory','256m','--cpus','1',
  '--publish','127.0.0.1:15432:5432','--env','POSTGRES_DB=publisher_test',
  '--env','POSTGRES_PASSWORD=isolated-test-only','postgres@'+digest);
 created=true;admin=pool();await ready();
 const version=await admin.query('SHOW server_version_num');
 assert.equal(Math.floor(Number(version.rows[0].server_version_num)/10000),16);
 for(const setting of ['fsync','full_page_writes','synchronous_commit']){
  const r=await admin.query('SHOW '+setting);assert.equal(r.rows[0][setting],'on');
 }
 await admin.query(readFileSync(new URL('../fixtures/publication-ledger.sql',import.meta.url),'utf8'));
 await admin.query(`CREATE ROLE publisher_test_role LOGIN PASSWORD 'isolated-role-only';
  GRANT CONNECT ON DATABASE publisher_test TO publisher_test_role;
  GRANT USAGE ON SCHEMA meridian_publisher TO publisher_test_role;
  GRANT SELECT,INSERT ON meridian_publisher.reservations TO publisher_test_role;
  GRANT UPDATE(status,comment_id) ON meridian_publisher.reservations TO publisher_test_role;
  CREATE TABLE public.unrelated_private(value text);
  REVOKE ALL ON public.unrelated_private FROM PUBLIC;`);
 app=pool({user:'publisher_test_role',password:'isolated-role-only'});
 const outcomes=await Promise.all([reserve(app,binding(1)),reserve(app,binding(1))]);
 assert.deepEqual(outcomes.map(x=>x.outcome).sort(),['ACKNOWLEDGED','NOT_ACQUIRED']);checks++;
 assert.equal((await settle(app,binding(1),'CONFIRMED',456)).outcome,'ACKNOWLEDGED');
 assert.equal((await settle(app,binding(1),'AMBIGUOUS')).outcome,'NOT_ACQUIRED');checks++;
 const lost=await reserve({query:async(...args)=>{await app.query(...args);throw new Error('SIMULATED_LOST_ACK');}},binding(2));
 assert.equal(lost.outcome,'UNCERTAIN');assert.equal(lost.sendAllowed,false);
 assert.equal((await reserve(app,binding(2))).outcome,'NOT_ACQUIRED');checks++;
 await denied(app,'DELETE FROM meridian_publisher.reservations','42501');
 await denied(app,'TRUNCATE meridian_publisher.reservations','42501');
 await denied(app,"UPDATE meridian_publisher.reservations SET run_id=999",'42501');
 await denied(app,'SELECT * FROM public.unrelated_private','42501');
 await denied(admin,'DELETE FROM meridian_publisher.reservations','P0001');
 await denied(admin,'TRUNCATE meridian_publisher.reservations','P0001');
 await assert.rejects(admin.query("UPDATE meridian_publisher.reservations SET run_id=999,status='AMBIGUOUS' WHERE operation_key=$1",[binding(2).operationKey]),e=>e.code==='P0001');
 const unchanged=await admin.query('SELECT run_id,status FROM meridian_publisher.reservations WHERE operation_key=$1',[binding(2).operationKey]);
 assert.deepEqual(unchanged.rows,[{run_id:'123',status:'RESERVED'}]);checks++;
 await denied(admin,"UPDATE meridian_publisher.reservations SET status='AMBIGUOUS',comment_id=NULL WHERE status='CONFIRMED'",'P0001');
 assert.equal((await reserve(app,binding(3))).outcome,'ACKNOWLEDGED');
 assert.equal((await settle(app,binding(3),'AMBIGUOUS')).outcome,'ACKNOWLEDGED');checks++;
 // Rollback removes only an uncommitted test insert; no sender is involved.
 const client=await app.connect();
 try{
  await client.query('BEGIN');
  const {RESERVE_SQL}=await import('./publication-ledger.mjs');
  const b=binding(4);await client.query(RESERVE_SQL,Object.values(b));
  await client.query('ROLLBACK');
 }finally{client.release();}
 assert.equal((await reserve(app,binding(4))).outcome,'ACKNOWLEDGED');checks++;
 await app.end();app=null;await admin.end();admin=null;
 docker('kill','--signal','KILL',name);docker('start',name);
 admin=pool();await ready();app=pool({user:'publisher_test_role',password:'isolated-role-only'});
 const rows=await app.query('SELECT status FROM meridian_publisher.reservations ORDER BY operation_key');
 assert.deepEqual(rows.rows.map(r=>r.status),['CONFIRMED','RESERVED','AMBIGUOUS','RESERVED']);
 for(let n=1;n<=4;n++)assert.equal((await reserve(app,binding(n))).outcome,'NOT_ACQUIRED');
 checks++;console.log(JSON.stringify({result:'PASS',checks,postgresMajor:16,
  crashRecovery:'local-container-only',productionDurability:false,sendAllowed:false}));
}finally{
 await Promise.allSettled([app?.end(),admin?.end()]);
 if(created)docker('rm','--force','--volumes',name);
}
