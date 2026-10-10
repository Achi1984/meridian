import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const helper=fileURLToPath(new URL('../scripts/copilot-review-evidence.py',import.meta.url));
function python(body){
 const result=spawnSync('python3',['-c',`import importlib.util\nspec=importlib.util.spec_from_file_location('collector',${JSON.stringify(helper)})\np=importlib.util.module_from_spec(spec)\nspec.loader.exec_module(p)\n${fixture}\n${body}`],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr||result.stdout);
}
const fixture=String.raw`
import copy,base64,hashlib
head='a'*40;base='b'*40
policy={'model_id':'claude-explicit-test','allowed_model_ids':['claude-explicit-test'],'required_checks':{'release-safety':100}}
repo={'id':1342084551,'full_name':p.REPO,'fork':False,'owner':{'id':319562141,'login':'Achi1984','type':'User'}}
def content(path,text):
 raw=text.encode();blob=hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()
 return {'type':'file','path':path,'encoding':'base64','sha':blob,'size':len(raw),'content':base64.b64encode(raw).decode()}
def fresh(count=1,before='old\n',after='new\n'):
 files=[];data={}
 for i in range(count):
  path='v11/file'+str(i)+'.html';old=content(path,before);new=content(path,after)
  files.append({'filename':path,'status':'modified','sha':new['sha'],'patch':'deliberately truncated API patch'})
  data['contents/'+path+'?ref='+base]=old;data['contents/'+path+'?ref='+head]=new
 for page in range(1,4):data['pulls/663/files?per_page=30&page='+str(page)]=files[(page-1)*30:page*30]
 pr={'number':663,'state':'open','merged':False,'changed_files':count,
     'head':{'sha':head,'repo':repo},'base':{'sha':base,'ref':'main','repo':repo}}
 data.update({'pulls/663':pr,'git/ref/heads/main':{'object':{'sha':base}},
  'compare/'+base+'...'+head:{'base_commit':{'sha':base},'merge_base_commit':{'sha':base},'status':'ahead','files':copy.deepcopy(files)},
  'actions/workflows/100/runs?event=pull_request&head_sha='+head+'&per_page=100&page=1':{'total_count':1,'workflow_runs':[{'id':200}]},
  'actions/runs/200':{'id':200,'workflow_id':100,'head_sha':head,'event':'pull_request','status':'completed',
    'conclusion':'success','run_attempt':1,'repository':repo,'head_repository':repo,'pull_requests':[{'number':663}]},
  'actions/runs/200/attempts/1/jobs?per_page=100&page=1':{'total_count':1,'jobs':[{'id':300,'run_id':200,'head_sha':head,'status':'completed','conclusion':'success'}]}})
 return data
def run(data,wrap=None,**overrides):
 calls=[]
 def fetch(path):
  assert path.startswith(p.PREFIX);relative=path[len(p.PREFIX):];calls.append(relative)
  value=copy.deepcopy(data[relative])
  return wrap(relative,value,calls) if wrap else value
 args={'pr':663,'head_sha':head,'base_sha':base,'request_id':'request-001','policy':policy,'implementer_family':'gpt'}
 args.update(overrides)
 return p.collect(fetch,**args),calls
def rejects(fn):
 try:fn()
 except (ValueError,TypeError,UnicodeError):pass
 else:raise AssertionError('invalid collector input accepted')
`;

test('immutable source and complete reconstructed diff collected but missing base/audit attestation blocks reviewer evidence',()=>{
 python(String.raw`
result,calls=run(fresh())
assert p.ACTIVE is False and result['active'] is False and result['status']=='BLOCKED'
assert result['evidence_ready'] is False and result['merge_authorized'] is False
assert result['candidate_evidence']['checks']==[]
assert result['candidate_evidence']['head_sha']==head and result['candidate_evidence']['base_sha']==base
assert '-old\n+new\n' in result['candidate_evidence']['diff'] and 'truncated API patch' not in result['candidate_evidence']['diff']
assert [s['side'] for s in result['source_inventory']]==['base','head']
for source in result['source_inventory']:
 assert source['sha256']==hashlib.sha256(source['text'].encode()).hexdigest()
observation=result['ci_observations'][0]
assert observation['base_execution_attested'] is False and observation['mandatory_audit_execution_attested'] is False
assert 'base_sha' not in observation and 'evidence_sha256' not in observation
assert calls.count('pulls/663')==2 and calls.count('actions/runs/200')==2
# No-newline bytes remain explicit, not '-old+new' concatenation.
result,_=run(fresh(before='old',after='new'));assert result['candidate_evidence']['diff'].count('No newline at end of file')==2
`);
});

test('stale PR head/current base and unknown implementer stop collection',()=>{
 python(String.raw`
for field,sha in [('head',base),('base',head)]:
 data=fresh();data['pulls/663'][field]['sha']=sha;rejects(lambda:run(data))
data=fresh();data['git/ref/heads/main']['object']['sha']=head;rejects(lambda:run(data))
rejects(lambda:run(fresh(),pr=True));rejects(lambda:run(fresh(),implementer_family='claude'))
def change_late(path,value,calls):
 if path=='pulls/663' and calls.count(path)==2:value['head']['sha']='c'*40
 return value
rejects(lambda:run(fresh(),wrap=change_late))
data=fresh();data['compare/'+base+'...'+head]['merge_base_commit']['sha']='c'*40;rejects(lambda:run(data))
`);
});

test('pagination is complete and bounded and never quietly accepts missing files',()=>{
 python(String.raw`
result,calls=run(fresh(31));assert len(result['candidate_evidence']['changed_paths'])==31
assert 'pulls/663/files?per_page=30&page=2' in calls
data=fresh(31);data['pulls/663/files?per_page=30&page=2']=[];rejects(lambda:run(data))
data=fresh();data['pulls/663']['changed_files']=65;rejects(lambda:run(data))
data=fresh();data['compare/'+base+'...'+head]['files']=[];rejects(lambda:run(data))
data=fresh(2);data['pulls/663/files?per_page=30&page=1'][1]['filename']='v11/file0.html';rejects(lambda:run(data))
`);
});

test('malicious paths, oversized binary content and blob mismatch fail closed',()=>{
 python(String.raw`
for path in ('../escape','/absolute','v11/../server.js','v11\\evil','v11/file\nname'):
 data=fresh();data['pulls/663/files?per_page=30&page=1'][0]['filename']=path;rejects(lambda:run(data))
for field,value in [('size',65537),('sha','d'*40),('type','symlink'),('encoding','none')]:
 data=fresh();data['contents/v11/file0.html?ref='+head][field]=value;rejects(lambda:run(data))
rejects(lambda:run(fresh(after='bad\0value')))
larger,_=run(fresh(before='x'*20000,after='y'*20000))
assert 32768<len(larger['candidate_evidence']['diff'].encode())<=65536
rejects(lambda:run(fresh(before='x'*34000,after='y'*34000)))
rejects(lambda:run(fresh(6,before='x'*23000,after='y'*23000)))
`);
});

test('CI run/job identities, success and bounded latest-run inventory remain mandatory',()=>{
 python(String.raw`
for field,value in [('head_sha',base),('workflow_id',101),('conclusion','failure'),('status','in_progress'),('event','push')]:
 data=fresh();data['actions/runs/200'][field]=value;rejects(lambda:run(data))
for field,value in [('run_id',201),('head_sha',base),('status','in_progress'),('conclusion','skipped')]:
 data=fresh();data['actions/runs/200/attempts/1/jobs?per_page=100&page=1']['jobs'][0][field]=value;rejects(lambda:run(data))
data=fresh();data['actions/workflows/100/runs?event=pull_request&head_sha='+head+'&per_page=100&page=1']['total_count']=101
rejects(lambda:run(data))
def retry_during_read(path,value,calls):
 if path=='actions/runs/200' and calls.count(path)==2:value['run_attempt']=2
 return value
rejects(lambda:run(fresh(),wrap=retry_during_read))
`);
});

test('renames retrieve exact old path at base and new path at head without trusting patch strings',()=>{
 python(String.raw`
data=fresh();entry=data['pulls/663/files?per_page=30&page=1'][0]
entry.update(status='renamed',previous_filename='old/file.html')
data['compare/'+base+'...'+head]['files']=[copy.deepcopy(entry)]
data['contents/old/file.html?ref='+base]=content('old/file.html','old\n')
result,calls=run(data)
assert 'contents/old/file.html?ref='+base in calls
assert result['candidate_evidence']['changed_paths']==['v11/file0.html']
assert '--- a/old/file.html' in result['candidate_evidence']['diff']
`);
});
