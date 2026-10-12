import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';

const source=readFileSync(new URL('../.github/workflows/native-observe-once.yml',import.meta.url),'utf8');
const MAIN='03f5c78068b74fdeb0e3c02450a0b5a389b0612b';
const CONTROL='b42966ab3ba05964bca4d9fcfb2bb00cea85922d';
const HEAD='2b4bce3ff1ece837b19e8acdf655db6d922390b8';
const flags="'authenticated', 'provenanceVerified', 'authorized', 'dispatchAllowed', 'mergeAllowed', 'durable', 'fullReviewEvidence'";
const mainGuard='test "$(gh api repos/Achi1984/meridian/commits/main --jq .sha)" = "$EXPECTED_MAIN"';
const headGuard='test "$(gh api "repos/Achi1984/meridian/pulls/$PILOT_PR" --jq .head.sha)" = "$EVENT_HEAD"';
const invocation='python3 -I -B native_review_observe.py --allow-read-only-network pins.json > receipt.json || status=$?';

// This is a deliberately narrow frozen pilot contract, not a general YAML parser
// or execution authorization. Changed scope requires explicit test re-review.
function validate(raw) {
  const text=raw.split('\n').filter(line=>!/^\s*#/.test(line)).join('\n');
  const has=value=>assert.ok(text.includes(value),'missing safety boundary: '+value);
  assert.equal((text.match(/^on:/gm)||[]).length,1);
  assert.match(text,/^on:\n  pull_request:\n    types: \[ready_for_review\]\npermissions:/m);
  assert.equal((text.match(/^\s*permissions:/gm)||[]).length,1);
  assert.match(text,/^permissions:\n  contents: read\n  actions: read\n  pull-requests: read\njobs:/m);
  const guards=["github.repository == 'Achi1984/meridian'", "github.event.sender.login == 'Achi1984'",
    'github.event.sender.id == 319562141', "github.event.pull_request.head.repo.full_name == 'Achi1984/meridian'",
    "github.event.pull_request.head.ref == 'pilot/native-review-read-once-736'",
    "github.event.pull_request.base.ref == 'main'", `github.event.pull_request.base.sha == '${MAIN}'`,
    'github.event.pull_request.draft == false', 'github.run_attempt == 1'];
  const condition=text.match(/^    if: >-\n([\s\S]*?)^    runs-on:/m)?.[1];
  assert.equal(condition?.trim().replace(/\s+/g,' '),guards.join(' && '));
  has('    timeout-minutes: 4');
  has('GH_TOKEN: ${{ github.token }}');
  has('SOURCE_SHA: '+CONTROL);has('EXPECTED_MAIN: '+MAIN);
  has('EVENT_HEAD: ${{ github.event.pull_request.head.sha }}');
  has('PILOT_PR: ${{ github.event.pull_request.number }}');
  assert.doesNotMatch(text,/\buses:|secrets\.|pull_request_target|workflow_dispatch|schedule:|\bcheckout\b/);
  assert.doesNotMatch(text,/gh api[^\n]*(?:--method| -X |--field| -f | -F )/);
  assert.equal((text.match(/set -euo pipefail/g)||[]).length,2);
  assert.equal((text.match(/      - name:/g)||[]).length,2);
  has('for file in collector.py review_handoff.py native_review_observation.py native_review_transport.py native_review_observe.py; do');
  has('contents/docs/autonomy/event-receiver/$file?ref=$SOURCE_SHA');
  has('test "$(wc -c < "$file")" -le 262144');
  const at=text.indexOf(invocation);assert.ok(at>0);
  for(const guard of [mainGuard,headGuard]) {
    assert.equal(text.split(guard).length,3,'exactly before and after guard');
    assert.ok(text.indexOf(guard)<at && text.lastIndexOf(guard)>at);
  }
  has('test "$status" -eq 2');has('assert len(raw) <= 4096');
  has("assert result['status'] == 'OBSERVED_APPROVAL_INCOMPLETE'");
  has("assert result['plannerResponse'] is None");
  has('for key in ('+flags+'):');has('assert result[key] is False');
  assert.ok(text.lastIndexOf(mainGuard)<text.indexOf("print(raw.decode('utf-8'))"));
  const pins=JSON.parse(text.match(/cat > pins.json <<'JSON'\n\s*(\{[^\n]+\})\n\s*JSON/)?.[1]||'null');
  assert.deepEqual(pins,{scope:{prNumber:736,headSha:HEAD,baseSha:MAIN,
    ci:{runId:38306411836,runAttempt:1,workflowId:347821227,headSha:HEAD}},
    review:{id:5495805683,submittedAt:'2026-10-12T20:48:50Z',
      bodySha256:'e94a2027902dc9d215e1dd740beddd15a9bc61365c148e5a1b8ec1609b9c12df'}});
}

test('native observation pilot retains bounded read-only frozen contract',()=>validate(source));
test('both pilot shell blocks remain syntactically valid without execution',()=>{
  const blocks=[...source.matchAll(/^        run: \|\n((?:          .*\n)*)/gm)];
  assert.equal(blocks.length,2);
  for(const block of blocks) {
    const script=block[1].replace(/^          /gm,'');
    const result=spawnSync('bash',['-n'],{input:script,encoding:'utf8',timeout:5000});
    assert.equal(result.status,0,result.stderr);
  }
});
test('unsafe trigger, authority, control and receipt mutations are rejected',()=>{
  const mutations=[
    ['types: [ready_for_review]','types: [opened, synchronize, ready_for_review]'],
    ['  contents: read','  contents: write'],
    ['    runs-on:', '    permissions:\n      contents: write\n    runs-on:'],
    ["github.event.sender.login == 'Achi1984'","true"],
    ['github.event.sender.id == 319562141','github.event.sender.id == 1'],
    ["github.repository == 'Achi1984/meridian'",'true'],
    ["github.event.pull_request.head.repo.full_name == 'Achi1984/meridian'",'true'],
    ["github.event.pull_request.head.ref == 'pilot/native-review-read-once-736'",'true'],
    ['github.run_attempt == 1','true'],[CONTROL,'main'],
    ['GH_TOKEN: ${{ github.token }}','GH_TOKEN: ${{ secrets.OTHER_TOKEN }}'],
    ['native_review_transport.py native_review_observe.py; do','evil.py; do'],
    [mainGuard,'true'],[headGuard,'true'],
    [invocation,invocation.replace('-I -B ','')],
    ['test "$status" -eq 2','true'],['assert len(raw) <= 4096','pass'],
    ["assert result['status'] == 'OBSERVED_APPROVAL_INCOMPLETE'",'pass'],
    ["assert result['plannerResponse'] is None",'pass'],
    ['assert result[key] is False','assert result[key] is True'],
    ["'dispatchAllowed', ",''],['-le 262144','-le 999999999'],
    ['"runAttempt":1','"runAttempt":2']
  ];
  for(const [before,after] of mutations) {
    assert.ok(source.includes(before),'mutation target exists');
    assert.throws(()=>validate(source.replace(before,after)),before);
  }
});
