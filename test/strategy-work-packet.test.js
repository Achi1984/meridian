import test from 'node:test';
import assert from 'node:assert/strict';
import {validateStrategyWorkPacket as validate} from '../docs/strategy-lab/strategy-work-packet.mjs';
const FLAGS = {recommendationOnly:true,dispatchAuthorized:false,executionAuthorized:false,
 empiricalRunAuthorized:false,mergeAuthorized:false,runtimeAuthorized:false,evidenceAuthenticated:false};
const doc = n => `docs/strategy-lab/packet-${n}.md`;
const check = n => `test/strategy-packet-${n}.test.js`;
function packet() {
 return {schemaVersion:'STRATEGY_WORK_PACKET_METADATA_V1',repository:'Achi1984/meridian',lane:'STRATEGY',
  workClass:'SOURCE_DESIGN',packetId:'source-packet',revision:1,conceptIds:['C04'],economicFamilyRefs:['UNKNOWN'],
  objective:'Inspect pinned source',expectedHeadSha:'a'.repeat(40),predecessor:null,
  sources:[{path:doc(1),commitSha:'b'.repeat(40),blobSha:'c'.repeat(40)}],allowedPaths:[doc(2)],proposedWrites:[doc(2)],
  acceptance:[{id:'synthetic-1',testPath:check(1)}],engineeringBudget:{maxAttempts:1,maxChangedFiles:1},trialBudgetStatus:'UNKNOWN'};
}
function observation() {return {headSha:'a'.repeat(40),observedAtMs:1000,decisionMs:1100,maxAgeMs:100,m11State:'UNKNOWN'};}
function reject(p,o,error) {
 const beforeP=structuredClone(p),beforeO=structuredClone(o);
 assert.deepEqual(validate(p,o),{valid:false,error,...FLAGS});
 assert.deepEqual(p,beforeP);assert.deepEqual(o,beforeO);
}
function mutate(change,error) {const p=packet(),o=observation();change(p,o);reject(p,o,error);}
test('exact success shape, independent canonical digest, flags and copied metadata',()=>{
 const p=packet(),o=observation(),before=structuredClone(p),r=validate(p,o);
 assert.deepEqual(Object.keys(r).sort(),['valid','operationKey','canonicalPacket','resourceAdvice',...Object.keys(FLAGS)].sort());
 for(const [key,value] of Object.entries(FLAGS))assert.equal(r[key],value);
 assert.equal(r.valid,true);assert.equal(r.resourceAdvice,'DEFER');assert.deepEqual(r.canonicalPacket,p);
 // Independently generated from the fixture with Python json.dumps(sort_keys=True,separators=(',',':')) + hashlib.
 assert.equal(r.operationKey,'3b29ee4843d8598e2157b445a168535e1e0a0d703635e589048441b6f35388b3');
 const repeat=validate(p,o);r.canonicalPacket.sources[0].path=doc(9);r.canonicalPacket.conceptIds.push('C22');
 r.canonicalPacket.engineeringBudget.maxAttempts=3;
 assert.deepEqual(p,before);assert.deepEqual(validate(p,o),repeat);
});
test('canonical ordering ignores set/object insertion order and observation, not packet content',()=>{
 const p=packet();p.conceptIds=['C04','C01'];p.economicFamilyRefs=['UNKNOWN','family-A'];
 p.sources.push({path:doc(3),commitSha:'d'.repeat(40),blobSha:'e'.repeat(40)});
 p.allowedPaths.push(doc(4));p.proposedWrites.push(doc(4));p.engineeringBudget.maxChangedFiles=2;
 p.acceptance.push({id:'synthetic-2',testPath:check(2)});
 const expected=validate(p,observation());
 const reverse=x=>Array.isArray(x)?x.map(reverse).reverse():x&&typeof x==='object'?
  Object.fromEntries(Object.entries(x).reverse().map(([k,v])=>[k,reverse(v)])):x;
 assert.deepEqual(validate(reverse(p),observation()),expected);
 const o=observation();o.observedAtMs=2000;o.decisionMs=2000;o.maxAgeMs=300000;o.m11State='FREE';
 const r=validate(p,o);assert.equal(r.operationKey,expected.operationKey);assert.equal(r.resourceAdvice,'REVIEW_RESOURCE_AVAILABLE');
 for(const change of [q=>{q.objective+=' again'},q=>{q.sources[0].blobSha='f'.repeat(40)},
  q=>{q.workClass='SOURCE_CHANGE'},q=>{q.engineeringBudget.maxAttempts=2},q=>{q.trialBudgetStatus='RECONCILED'}]) {
  const q=structuredClone(p);change(q);assert.notEqual(validate(q,o).operationKey,r.operationKey);
 }
});
test('all supported classes remain recommendations, all unsupported classes reject regardless of trial assertion',()=>{
 for(const workClass of ['SOURCE_DESIGN','SOURCE_CHANGE','SYNTHETIC_CHECK'])for(const status of ['UNKNOWN','RECONCILED']) {
  const p=packet();p.workClass=workClass;p.trialBudgetStatus=status;assert.equal(validate(p,observation()).valid,true);
 }
 for(const workClass of ['EMPIRICAL_REQUEST','MERGE_REQUEST','RUNTIME_REQUEST','DISPATCH'])
  mutate(p=>{p.workClass=workClass;p.trialBudgetStatus='RECONCILED'},'UNSUPPORTED_WORK_CLASS');
});
test('exact schemas, scalar types and negative zero reject with deterministic codes',()=>{
 const cases=[
  [p=>{p.extra=1},'PACKET_SCHEMA'],[p=>{delete p.workClass},'PACKET_SCHEMA'],[p=>{p.operationKey='f'.repeat(64)},'PACKET_SCHEMA'],
  [p=>{p.schemaVersion='x'},'PACKET_SCHEMA'],[p=>{p.repository='other/repo'},'REPOSITORY'],[p=>{p.lane='M11'},'LANE'],
  [p=>{p.packetId='bad\n'},'PACKET_ID'],[p=>{p.packetId='x'.repeat(65)},'PACKET_ID'],[p=>{p.revision=-0},'REVISION'],
  [p=>{p.revision='1'},'REVISION'],[p=>{p.conceptIds=['C00']},'CONCEPT_IDS'],[p=>{p.conceptIds=['C23']},'CONCEPT_IDS'],
  [p=>{p.economicFamilyRefs=['']},'ECONOMIC_FAMILY_REFS'],[p=>{p.objective=' '},'OBJECTIVE'],
  [p=>{p.objective='x'.repeat(501)},'OBJECTIVE'],[p=>{p.objective='ü'},'OBJECTIVE'],[p=>{p.expectedHeadSha='a'.repeat(39)},'HEAD_SHA'],
  [p=>{p.sources[0].blobSha='A'.repeat(40)},'SOURCES'],[p=>{p.sources[0].extra=1},'SOURCES'],
  [p=>{p.acceptance[0].command='node'},'ACCEPTANCE'],[p=>{p.acceptance[0].id=''},'ACCEPTANCE'],
  [p=>{p.engineeringBudget.maxAttempts=-0},'ENGINEERING_BUDGET'],[p=>{p.engineeringBudget.maxChangedFiles=NaN},'ENGINEERING_BUDGET'],
  [p=>{p.engineeringBudget.currency='USD'},'ENGINEERING_BUDGET'],[p=>{p.trialBudgetStatus=true},'TRIAL_BUDGET_STATUS'],
  [(p,o)=>{o.extra=true},'OBSERVATION_SCHEMA'],[(p,o)=>{o.headSha='branch'},'OBSERVATION_HEAD_SHA'],
  [(p,o)=>{o.observedAtMs=-0},'OBSERVATION_TIME'],[(p,o)=>{o.decisionMs=-0},'OBSERVATION_TIME'],
  [(p,o)=>{o.decisionMs=Infinity},'OBSERVATION_TIME'],[(p,o)=>{o.decisionMs=Number.MAX_SAFE_INTEGER+1},'OBSERVATION_TIME'],
  [(p,o)=>{o.maxAgeMs=-0},'OBSERVATION_MAX_AGE'],[(p,o)=>{o.m11State='IDLE'},'M11_STATE']
 ];
 for(const [change,error] of cases)mutate(change,error);
});
test('duplicate, sparse and custom-key arrays rejected at each bounded list',()=>{
 for(const [key,error] of [['conceptIds','CONCEPT_IDS'],['economicFamilyRefs','ECONOMIC_FAMILY_REFS'],['sources','SOURCES'],
  ['allowedPaths','ALLOWED_PATHS'],['proposedWrites','PROPOSED_WRITES'],['acceptance','ACCEPTANCE']]) {
  mutate(p=>{p[key].push(structuredClone(p[key][0]))},error);
  mutate(p=>{delete p[key][0]},error);
  mutate(p=>{p[key].extra=1},error);
 }
 mutate(p=>{p.sources.push({...p.sources[0],blobSha:'f'.repeat(40)})},'SOURCES');
 mutate(p=>{p.acceptance.push({id:'different-id',testPath:p.acceptance[0].testPath})},'ACCEPTANCE');
 mutate(p=>{p.acceptance.push({id:p.acceptance[0].id,testPath:check(2)})},'ACCEPTANCE');
});
test('nonenumerable and symbol properties are not canonicalized away',()=>{
 for(const change of [p=>Object.defineProperty(p,'hidden',{value:1}),p=>{p[Symbol('extra')]=1},
  p=>Object.defineProperty(p,'objective',{value:p.objective,enumerable:false})]) {
  const p=packet();change(p);assert.deepEqual(validate(p,observation()),{valid:false,error:'PACKET_SCHEMA',...FLAGS});
 }
 const p=packet();p.sources[Symbol('extra')]=1;
 assert.deepEqual(validate(p,observation()),{valid:false,error:'SOURCES',...FLAGS});
});
test('path boundaries and frozen read/write distinction',()=>{
 const bad=['/tmp/file.md','docs/strategy-lab/../x.md','docs/strategy-lab/*','docs/strategy-lab/x%2f.md',
  'docs\\strategy-lab\\x.md','docs/strategy-lab/M11_PLAN.md','test/strategy-m11-flow.test.js','test/runtime.test.js'];
 for(const path of bad) {
  mutate(p=>{p.sources[0].path=path},'SOURCE_PATH');
  mutate(p=>{p.allowedPaths=[path]},'ALLOWED_PATHS');
 }
 const frozen='docs/strategy-lab/fixtures/elliott-frozen-v1.mjs';
 const p=packet();p.sources[0].path=frozen;assert.equal(validate(p,observation()).valid,true);
 mutate(p=>{p.allowedPaths=[frozen]},'ALLOWED_PATHS');
 mutate(p=>{p.allowedPaths=['test/elliott-frozen-characterization.test.js']},'ALLOWED_PATHS');
 mutate(p=>{p.proposedWrites=[doc(7)]},'PROPOSED_WRITES');
 mutate(p=>{p.acceptance[0].testPath=doc(7)},'ACCEPTANCE');
});
test('predecessor is syntactically immediate and same packet; first revision has none',()=>{
 mutate(p=>{p.predecessor={packetId:p.packetId,revision:1,operationKey:'d'.repeat(64)}},'PREDECESSOR');
 const p=packet();p.revision=2;p.predecessor={packetId:p.packetId,revision:1,operationKey:'d'.repeat(64)};
 assert.equal(validate(p,observation()).valid,true);
 for(const change of [q=>{q.predecessor=null},q=>{q.predecessor.packetId='other'},q=>{q.predecessor.revision=2},
  q=>{q.predecessor.operationKey='short'},q=>{q.predecessor.extra=1}]){
  const q=structuredClone(p);change(q);reject(q,observation(),'PREDECESSOR');
 }
});
test('head and freshness boundaries, resource advice and precedence',()=>{
 for(const m11State of ['FREE','BUSY','UNKNOWN']) {
  const o=observation();o.m11State=m11State;
  assert.equal(validate(packet(),o).resourceAdvice,m11State==='FREE'?'REVIEW_RESOURCE_AVAILABLE':'DEFER');
 }
 mutate((p,o)=>{o.headSha='b'.repeat(40)},'HEAD_MISMATCH');
 mutate((p,o)=>{o.observedAtMs=o.decisionMs+1},'FUTURE_OBSERVATION');
 mutate((p,o)=>{o.decisionMs++},'STALE_OBSERVATION');
 mutate((p,o)=>{o.headSha='b'.repeat(40);o.observedAtMs=o.decisionMs+1},'HEAD_MISMATCH');
 const o=observation();o.observedAtMs=0;o.decisionMs=300000;o.maxAgeMs=300000;
 assert.equal(validate(packet(),o).valid,true);
 o.observedAtMs=Number.MAX_SAFE_INTEGER;o.decisionMs=Number.MAX_SAFE_INTEGER;o.maxAgeMs=1;
 assert.equal(validate(packet(),o).valid,true);
 for(const value of [0,300001,'1'])mutate((p,o)=>{o.maxAgeMs=value},'OBSERVATION_MAX_AGE');
});
test('all list and engineering bounds, including fully populated maxima',()=>{
 const p=packet();p.conceptIds=Array.from({length:22},(_,i)=>`C${String(i+1).padStart(2,'0')}`);
 p.economicFamilyRefs=Array.from({length:22},(_,i)=>`family-${i}`);
 p.sources=Array.from({length:16},(_,i)=>({path:doc(i),commitSha:'b'.repeat(40),blobSha:'c'.repeat(40)}));
 p.allowedPaths=Array.from({length:8},(_,i)=>doc(i));p.proposedWrites=[...p.allowedPaths];
 p.acceptance=Array.from({length:8},(_,i)=>({id:`check-${i}`,testPath:check(i)}));
 p.engineeringBudget={maxAttempts:3,maxChangedFiles:8};p.objective='x'.repeat(500);p.packetId='x'.repeat(64);
 p.revision=1000000;p.predecessor={packetId:p.packetId,revision:999999,operationKey:'d'.repeat(64)};
 assert.equal(validate(p,observation()).valid,true);
 for(const [key,error] of [['conceptIds','CONCEPT_IDS'],['economicFamilyRefs','ECONOMIC_FAMILY_REFS'],['sources','SOURCES'],
  ['allowedPaths','ALLOWED_PATHS'],['proposedWrites','PROPOSED_WRITES'],['acceptance','ACCEPTANCE']]) {
  const q=structuredClone(p);q[key].push(structuredClone(q[key][0]));reject(q,observation(),error);
  if(key!=='proposedWrites'){const empty=packet();empty[key]=[];reject(empty,observation(),error);}
 }
 const empty=packet();empty.proposedWrites=[];assert.equal(validate(empty,observation()).valid,true);
 for(const [key,values] of [['maxAttempts',[0,4]],['maxChangedFiles',[0,9]]])
  for(const value of values)mutate(p=>{p.engineeringBudget[key]=value},'ENGINEERING_BUDGET');
 mutate(p=>{p.revision=1000001},'REVISION');
 mutate(p=>{p.allowedPaths.push(doc(3));p.proposedWrites.push(doc(3))},'ENGINEERING_BUDGET');
});
test('campaign, ledger and validator governance paths are read-only metadata',()=>{
 const protectedPaths=[
  'docs/strategy-lab/campaign-20261013.json',
  'docs/strategy-lab/CAMPAIGN-EXAMPLE.json',
  'docs/strategy-lab/trial-ledger-reconciliation.json',
  'docs/strategy-lab/TRIAL_LEDGER_RECONCILIATION.md',
  'docs/strategy-lab/validate-campaign.mjs',
  'docs/strategy-lab/strategy-work-packet.mjs',
  'test/strategy-work-packet.test.js',
  'test/strategy-campaign-draft.test.js',
  'docs/strategy-lab/STRATEGY_WORK_PACKET_V1.md',
  'docs/strategy-lab/STRATEGY_AUTONOMY_HANDOFF_CONTRACT_20261014.md'
 ];
 for(const path of protectedPaths) {
  mutate(p=>{p.allowedPaths=[path]},'ALLOWED_PATHS');
  mutate(p=>{p.proposedWrites=[path]},'PROPOSED_WRITES');
  const p=packet();p.sources[0].path=path;
  assert.equal(validate(p,observation()).valid,true,`read-only source ${path}`);
 }
 const p=packet();p.acceptance=[{id:'own-validator',testPath:'test/strategy-work-packet.test.js'},
  {id:'campaign-validator',testPath:'test/strategy-campaign-draft.test.js'}];
 assert.equal(validate(p,observation()).valid,true,'inert acceptance is not write authority');
});
test('both frozen fixtures stay readable and unwritable',()=>{
 for(const name of ['elliott-frozen-v1.mjs','elliott-frozen-wave5.mjs']) {
  const path=`docs/strategy-lab/fixtures/${name}`,p=packet();p.sources[0].path=path;
  assert.equal(validate(p,observation()).valid,true);
  mutate(p=>{p.allowedPaths=[path]},'ALLOWED_PATHS');
  mutate(p=>{p.proposedWrites=[path]},'PROPOSED_WRITES');
 }
});
test('predecessor key participates in identity and never aliases caller data',()=>{
 const p=packet();p.revision=2;p.predecessor={packetId:p.packetId,revision:1,operationKey:'d'.repeat(64)};
 const before=structuredClone(p),r=validate(p,observation());assert.equal(r.valid,true);
 r.canonicalPacket.predecessor.operationKey='e'.repeat(64);
 assert.deepEqual(p,before);assert.notEqual(r.operationKey,validate(r.canonicalPacket,observation()).operationKey);
 assert.equal(validate(p,observation()).operationKey,r.operationKey);
});
test('96 character names admit, 97 reject; M11 acceptance remains forbidden',()=>{
 for(const prefix of ['docs/strategy-lab/','test/']) {
  const name=prefix==='test/'?'strategy-'+'x'.repeat(87):'x'.repeat(96);
  const suffix=prefix==='test/'?'.test.js':'.md',path=prefix+name+suffix;
  const p=packet();p.allowedPaths=[path];p.proposedWrites=[path];
  assert.equal(validate(p,observation()).valid,true);
  mutate(p=>{p.allowedPaths=[prefix+name+'x'+suffix]},'ALLOWED_PATHS');
 }
 mutate(p=>{p.acceptance[0].testPath='test/strategy-M11-check.test.js'},'ACCEPTANCE');
});
test('trusted null-prototype records preserve metadata and canonical identity',()=>{
 const convert=value=>Array.isArray(value)?value.map(convert):value!==null&&typeof value==='object'?
  Object.assign(Object.create(null),Object.fromEntries(Object.entries(value).map(([k,v])=>[k,convert(v)]))):value;
 const p=packet(),o=observation();
 assert.deepEqual(validate(convert(p),convert(o)),validate(p,o));
});
