import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const workflow=readFileSync(new URL('../.github/workflows/native-assignment-pilot-once-20261012.yml',import.meta.url),'utf8');
const programs=[...workflow.matchAll(/          python3(?: -B)? - <<'PY'\n([\s\S]*?)          PY/g)].map(m=>m[1].replace(/^          /gm,''));
test('one-shot gates, fixed execution source and pre-secret validation remain bounded',()=>{
  assert.equal(programs.length,3);
  for(const pin of ["github.actor == 'Achi1984'","github.triggering_actor == 'Achi1984'","github.ref == 'refs/heads/main'",'github.run_number == 1','github.run_attempt == 1','timeout-minutes: 3','permissions: {}','contents: read'])assert.ok(workflow.includes(pin));
  assert.match(programs[0],/source_sha = 'fc706326c1af1ac63303d273467d2100ec83b3a3'/);
  assert.match(programs[0],/re.fullmatch\('\[0-9a-f\]\{40\}', config_sha\)/);
  assert.ok(workflow.indexOf('Validate config against executing main')<workflow.indexOf('NATIVE_USER_TOKEN:'));
  assert.match(programs[1],/task.expected_main_sha == os.environ\['GITHUB_SHA'\]/);
});
test('credential account check gates capability and sanitizes failures without live HTTP',()=>{
  const source=String.raw`
import contextlib, importlib.util, io, json, os, tempfile, types
from unittest.mock import patch
program=PROGRAM
task=types.SimpleNamespace(expected_main_sha='a'*40,release_run_id=1,release_run_attempt=1,workflow_id=2,repository='Achi1984/meridian')
calls=[]
dispatcher=types.SimpleNamespace(ApprovedTask=types.SimpleNamespace(from_mapping=lambda c:task),_unique_object=dict,_reject_nonfinite=lambda x:None)
def run_once(*a,**kw):
 calls.append(kw)
 return {'status':'ASSIGNED'}
runtime=types.SimpleNamespace(_dispatcher=dispatcher,run_once=run_once)
spec=types.SimpleNamespace(loader=types.SimpleNamespace(exec_module=lambda m:None))
class Response:
 status=200
 raw=b'{"login":"Achi1984","type":"User"}'
 def read(self,n):
  assert n==8193
  return self.raw
class HTTPS:
 def __init__(self,host,timeout): assert host=='api.github.com' and timeout==10
 def request(self,method,path,headers): assert method=='GET' and path=='/user'
 def getresponse(self): return Response()
 def close(self): pass
with tempfile.TemporaryDirectory() as directory:
 os.chdir(directory)
 open('approved-task.json','w').write('{}')
 with patch.dict(os.environ,{'NATIVE_USER_TOKEN':'never-print-secret','GITHUB_SHA':'a'*40}),patch('http.client.HTTPSConnection',HTTPS),patch('importlib.util.spec_from_file_location',return_value=spec),patch('importlib.util.module_from_spec',return_value=runtime):
  for status,raw,expected in [(200,b'{"login":"Achi1984","type":"User"}',1),(200,b'{"login":"other","type":"User"}',0),(401,b'never-print-secret',0),(302,b'',0),(200,b'x'*8193,0),(200,b'bad-json',0)]:
   calls.clear();Response.status=status;Response.raw=raw;out=io.StringIO()
   with contextlib.redirect_stdout(out):
    try:exec(program)
    except SystemExit as e:assert e.code==(0 if expected else 1)
   assert len(calls)==expected
   assert 'never-print-secret' not in out.getvalue()
   if expected:assert calls[0]['verified_user_token_auth'] is True and calls[0]['fence_mode']=='github_ref'
print('credential scenarios passed')
`.replace('PROGRAM',JSON.stringify(programs[2]));
  const r=spawnSync('python3',['-B','-c',source],{encoding:'utf8',timeout:5000});
  assert.equal(r.status,0,r.stderr);
});
