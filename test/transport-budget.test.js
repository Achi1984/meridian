import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {transportLimits,checkVisibleBudget,checkUploadBudget,sourceBlobSha,verifySourceBlob} from '../scripts/transport-budget.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const cp=JSON.parse(fs.readFileSync(new URL('../MERIDIAN_LIVE_CHECKPOINT.json',import.meta.url),'utf8'));
const limits=transportLimits(cp);
const contents=content=>({repository_full_name:'fixture/repo',path:'source.js',content,message:'fixture',sha:'a'.repeat(40),branch:'fixture'});
const blob=(content,encoding='utf-8')=>({repository_full_name:'fixture/repo',content,encoding});
const tree=rows=>({repository_full_name:'fixture/repo',base_tree_sha:'a'.repeat(40),tree_elements:rows});
const entry=(path,content)=>({path,type:'blob',mode:'100644',content});
const clone=()=>structuredClone(cp);

test('Transport V1 rejects the unscoped old policy',()=>{const c=clone();delete c.streamSafety.maxPayloadBytesScope;assert.throws(()=>transportLimits(c),/UNSCOPED_POLICY/)});
test('Transport V1 rejects unilateral budget expansion',()=>{const c=clone();c.streamSafety.maxSourceFileBytes++;assert.throws(()=>transportLimits(c),/UNAPPROVED_LIMITS/)});
test('Transport V1 limits are frozen',()=>assert.ok(Object.isFrozen(limits)));
for(const [size,valid] of [[4096,true],[4097,false]])test('Visible ASCII byte boundary '+size,()=>{
  const run=()=>checkVisibleBudget('x'.repeat(size),limits);if(valid)assert.equal(run().bytes,size);else assert.throws(run,/VISIBLE_TOO_LARGE/);
});
test('Visible Unicode uses bytes rather than character count',()=>{assert.equal(checkVisibleBudget('😀'.repeat(1024),limits).bytes,4096);assert.throws(()=>checkVisibleBudget('😀'.repeat(1025),limits),/VISIBLE_TOO_LARGE/)});
test('Source content above 4 KB is permitted without enlarging display budget',()=>assert.equal(checkUploadBudget('contents',contents('x'.repeat(8192)),limits).fileBytes[0],8192));
for(const [size,valid] of [[262144,true],[262145,false]])test('Source ASCII byte boundary '+size,()=>{
  const run=()=>checkUploadBudget('contents',contents('x'.repeat(size)),limits);if(valid)assert.equal(run().fileBytes[0],size);else assert.throws(run,/SOURCE_TOO_LARGE/);
});
test('Source Unicode byte boundary is not a JS string-length limit',()=>{assert.equal(checkUploadBudget('blob',blob('😀'.repeat(65536)),limits).fileBytes[0],262144);assert.throws(()=>checkUploadBudget('blob',blob('😀'.repeat(65537)),limits),/SOURCE_TOO_LARGE/)});
test('Empty source upload and its canonical Git blob hash are valid',()=>{assert.equal(checkUploadBudget('contents',contents(''),limits).fileBytes[0],0);assert.equal(sourceBlobSha(''),'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391')});
for(const [size,valid] of [[393216,true],[393217,false]])test('Complete serialized-request boundary '+size,()=>{
  const payload=contents('x'), overhead=Buffer.byteLength(JSON.stringify({...payload,content:'eA=='}));
  payload.message+='x'.repeat(size-overhead);
  const run=()=>checkUploadBudget('contents',payload,limits);if(valid)assert.equal(run().requestBytes,size);else assert.throws(run,/REQUEST_TOO_LARGE/);
});
test('Contents API base64 overhead is included',()=>{
  const payload=contents('x'.repeat(262144));payload.message='m'.repeat(50000);
  assert.ok(Buffer.byteLength(JSON.stringify(payload))<393216);
  assert.throws(()=>checkUploadBudget('contents',payload,limits),/REQUEST_TOO_LARGE/);
});
test('Native JSON escaping is bounded even when encoded wire is smaller',()=>assert.throws(()=>checkUploadBudget('contents',contents('"'.repeat(262144)),limits),/REQUEST_TOO_LARGE/));
test('UTF-8 and base64 blob transports produce identical source hashes',()=>{
  const text='Größe 😀';const a=checkUploadBudget('blob',blob(text),limits),b=checkUploadBudget('blob',blob(Buffer.from(text).toString('base64'),'base64'),limits);
  assert.deepEqual(a.blobShas,b.blobShas);assert.deepEqual(a.fileBytes,b.fileBytes);
});
for(const content of ['@@@','eA=','eB==','/w=='])test('Malformed or non-UTF-8 base64 is rejected: '+content,()=>assert.throws(()=>checkUploadBudget('blob',blob(content,'base64'),limits),/INVALID_BASE64/));
for(const text of ['\ud800','\udc00'])test('Unpaired surrogate rejected '+text.charCodeAt(0),()=>assert.throws(()=>checkUploadBudget('contents',contents(text),limits),/INVALID_UTF8_TEXT/));
test('Tree uploads apply both per-file and combined-request limits',()=>{
  const out=checkUploadBudget('tree',tree([entry('a','x'.repeat(8192)),entry('b','y'.repeat(8192))]),limits);assert.equal(out.files,2);
  assert.throws(()=>checkUploadBudget('tree',tree([entry('a','x'.repeat(200000)),entry('b','y'.repeat(200000))]),limits),/REQUEST_TOO_LARGE/);
});
test('Reference-only tree entries do not misrepresent new uploaded content',()=>assert.equal(checkUploadBudget('tree',tree([{path:'a',type:'blob',mode:'100644',sha:'a'.repeat(40)}]),limits).files,0));
test('Duplicate and ambiguous tree entries are rejected',()=>{
  assert.throws(()=>checkUploadBudget('tree',tree([entry('a','x'),entry('a','y')]),limits),/INVALID_TREE_ENTRY/);
  assert.throws(()=>checkUploadBudget('tree',tree([{...entry('a','x'),sha:'b'.repeat(40)}]),limits),/AMBIGUOUS_TREE_ENTRY/);
});
test('Budget preflight rejects unknown operations and malformed requests',()=>{assert.throws(()=>checkUploadBudget('merge',{},limits),/UNSUPPORTED_OPERATION/);assert.throws(()=>checkUploadBudget('contents',null,limits),/INVALID_REQUEST/)});
test('Source hash verification detects post-upload byte drift',()=>{const text='fixture\n',sha=sourceBlobSha(text);assert.equal(verifySourceBlob(text,sha),true);assert.throws(()=>verifySourceBlob(text+'x',sha),/BLOB_MISMATCH/)});
test('Complete argument CLI is network-free and emits no source data',()=>{
  const marker='PRIVATE_SENTINEL_DO_NOT_ECHO',run=spawnSync(process.execPath,['scripts/stream-safe-preflight.mjs','--upload-budget','contents'],{cwd:root,input:JSON.stringify(contents(marker)),encoding:'utf8',timeout:5000});
  assert.equal(run.status,0,run.stderr);assert.equal(JSON.parse(run.stdout).files,1);assert.ok(!run.stdout.includes(marker));
});
test('CLI invalid JSON rejects without leaking input or parse context',()=>{
  const marker='PRIVATE_SENTINEL_DO_NOT_ECHO',run=spawnSync(process.execPath,['scripts/stream-safe-preflight.mjs','--upload-budget','contents'],{cwd:root,input:'{'+marker,encoding:'utf8',timeout:5000});
  assert.equal(run.status,1);assert.equal(run.stderr.trim(),'TRANSPORT_BUDGET: INPUT_REJECTED');assert.ok(!run.stderr.includes(marker));
});
test('Canonical budgets and operating/research boundaries are kept distinct',()=>{
  assert.equal(cp.protocol,'STREAM-SAFE-V7');assert.equal(cp.streamSafety.maxMutationsPerTurn,1);assert.equal(cp.streamSafety.stopTurnAfterMutation,true);
  assert.equal(cp.streamSafety.compareAndSwapRequired,true);assert.equal(cp.streamSafety.requireExpectedBranchHead,true);assert.equal(cp.streamSafety.mergeExactHeadAndBaseRequired,true);
  assert.equal(cp.streamSafety.transportApprovalCommentId,6037360103);assert.equal(cp.activeResearch.stage,'SOURCE_AUDIT');
  const flags=Object.entries(cp.activeResearch).filter(([k])=>k.endsWith('Authorized'));assert.equal(flags.length,7);assert.ok(flags.every(([,v])=>v===false));
});
test('Bootstrap and workflow docs specify separate budgets without claiming watchdog deployment',()=>{
  for(const name of ['MERIDIAN_GO.md','MERIDIAN_AGENT_WORKFLOW.md']){
    const text=fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');for(const n of ['4096','262144','393216'])assert.ok(text.includes(n));assert.ok(text.includes('--upload-budget'));
  }
  const workflow=fs.readFileSync(new URL('../MERIDIAN_AGENT_WORKFLOW.md',import.meta.url),'utf8');assert.match(workflow,/part A only/);assert.match(workflow,/separate implementation\/tests/);
});
