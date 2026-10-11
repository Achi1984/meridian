import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {STRUCTURED_REVIEW_CLAIM_SCHEMA} from '../scripts/codex-bridge-v3-review-coordinator.mjs';
const helper=fileURLToPath(new URL('../scripts/structured-review-transport.py',import.meta.url));
const expected=()=>({repository:'Achi1984/meridian',prNumber:123,requestId:'REQ-001',opId:'OP-001',headSha:'a'.repeat(40),baseSha:'b'.repeat(40),ci:{runId:1,runAttempt:1,workflowId:2,headSha:'a'.repeat(40)}});
const claim=()=>({schemaVersion:1,...expected(),verdict:'GREEN_LIGHT',ci:{...expected().ci,status:'completed',conclusion:'success'}});
function invoke(c=JSON.stringify(claim()),e=JSON.stringify(expected()),raw=null){return spawnSync('python3',[helper],{input:raw??JSON.stringify({claim:c,expected:e}),encoding:'utf8'});}
function denied(result){assert.equal(result.status,1);assert.equal(result.stdout,'');assert.match(result.stderr,/^[A-Z_]+\n$/);}
test('every supported verdict survives transport but never acquires authority',()=>{
  for(const verdict of STRUCTURED_REVIEW_CLAIM_SCHEMA.properties.verdict.enum){const result=invoke(JSON.stringify({...claim(),verdict}));assert.equal(result.status,0,result.stderr);const data=JSON.parse(result.stdout);assert.equal(data.verdict,verdict);for(const key of ['mayRequest','mayMerge','mayActivate','authenticated','provenanceVerified','authorized'])assert.equal(data[key],false);}
});
test('duplicate decoded root, CI and outer-frame keys are rejected',()=>{
  const c=JSON.stringify(claim());
  for(const raw of [c.replace('{','{"schemaVersion":1,'),c.replace('{','{"schema\\u0056ersion":1,'),c.replace('"ci":{','"ci":{"runId":1,'),c.replace('"ci":{','"ci":{"run\\u0049d":1,')]){const result=invoke(raw);denied(result);assert.equal(result.stderr,'DUPLICATE_KEY\n');}
  for(const name of ['claim','cl\\u0061im']){const result=invoke(null,null,'{"'+name+'":"{}","claim":"{}","expected":"{}"}');denied(result);assert.equal(result.stderr,'DUPLICATE_KEY\n');}
  denied(invoke(c,'{"repository":"x","repository":"y"}'));
});
test('byte limits, nesting, arrays, nonfinite values and malformed transports fail closed',()=>{
  for(const raw of [' '.repeat(16385),'"raw"','[]','{"a":{"b":{}}}','{"a":[]}','```json\n{}\n```','{}{}','{"a":NaN}','{"a":Infinity}','{"a":1e999}','{"a":"\\q"}','{"a":','{"a":01}',null,42])denied(invoke(raw));
  denied(invoke(null,null,' '.repeat(131073)));
  const base=JSON.stringify(claim());assert.equal(invoke(base+' '.repeat(16384-Buffer.byteLength(base))).status,0);
  denied(invoke(base+' '.repeat(16385-Buffer.byteLength(base))));
  const multi='{"x":"'+'é'.repeat(8190)+'"}';denied(invoke(multi));
});
test('expected pins stay independent and action success cannot replace verdict',()=>{
  const pin=expected();pin.prNumber=124;denied(invoke(JSON.stringify(claim()),JSON.stringify(pin)));
  const c=claim();delete c.verdict;denied(invoke(JSON.stringify(c)));
  denied(invoke(JSON.stringify(claim()),'{}'));
});
test('quoted punctuation is parsed normally and raw errors/instructions never leak',()=>{
  const marker='DO_NOT_PRINT_THIS_SECRET';const c=claim();c.requestId=marker+'"},[\\';
  const result=invoke(JSON.stringify(c));denied(result);assert.ok(!result.stderr.includes(marker));
  denied(invoke(JSON.stringify({...claim(),command:'$(touch /tmp/never-execute)'})));
});
test('import is inert and Node invocation uses fixed code, stdin and sanitized environment',()=>{
  const body=`import importlib.util,os,unittest.mock as m,json\ns=importlib.util.spec_from_file_location('t',${JSON.stringify(helper)})\nt=importlib.util.module_from_spec(s)\nwith m.patch('subprocess.run') as child,m.patch('shutil.which') as find:\n s.loader.exec_module(t)\n child.assert_not_called();find.assert_not_called()\nwith m.patch.dict(os.environ,{'NODE_OPTIONS':'--invalid','SECRET_FIXTURE':'hidden'}),m.patch('subprocess.run') as child:\n child.return_value.returncode=1\n try:t.validate_received(${JSON.stringify(JSON.stringify(claim()))},${JSON.stringify(JSON.stringify(expected()))})\n except t.TransportError:pass\n args=child.call_args\n assert args.args[0][1:]==['--input-type=module','-e',t.NODE_SCRIPT]\n assert args.kwargs['shell'] is False\n assert args.kwargs['env']=={'PATH':'/usr/bin:/bin','LANG':'C','LC_ALL':'C'}\n assert json.loads(args.kwargs['input'])['expected']['prNumber']==123\n`;
  const result=spawnSync('python3',['-c',body],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
});
