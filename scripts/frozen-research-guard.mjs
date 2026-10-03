import fs from 'node:fs';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';

export const FROZEN_RESEARCH_BLOBS=Object.freeze({
  '.github/workflows/perpetual-taker-order-flow-relative-strength-v2.yml':'5efd8fdfc7efcb61010b4390bfe81c20155effb3',
  'test/test_perpetual_taker_order_flow_relative_strength_v2.py':'272c4db92e2cfb7e9c20dad20b5912c5dca7d09b',
  'research/run-perpetual-taker-order-flow-relative-strength-v2-validation.py':'6f51d4e7a97d563d2aa1612edad1ddb6e0d76b02',
  'scripts/collect-perpetual-taker-order-flow-relative-strength-v2-validation.py':'fa72fa88d3bccc0fb8c7fe50e38b16feb7ee2b7c',
  'research/perpetual_taker_order_flow_relative_strength_v2.py':'c7411e57723462a03037ae0fdc8fa590c7239ac4',
  'research/perpetual-taker-order-flow-relative-strength-v2-protocol.json':'4b2aaf182098c6beecadd56d69b3b51c1dd7c5d8',
  'research/PERPETUAL-TAKER-ORDER-FLOW-RELATIVE-STRENGTH-V2-PREREGISTRATION.md':'a352a3bfa8be3d22f32d4e647f4660a100a7c7ed',
  'research/perpetual_taker_order_flow_v1.py':'580f8885118aa1bfcccd6c77a431d5b7835e8bba',
  '.github/workflows/paper-profit-regime-trend-breakout-v1-holdout.yml':'4e6a502db972d4d2c0cd4a0b56e914d946432acc',
  'research/PAPERBOT-PROFIT-REGIME-TREND-BREAKOUT-V1-HOLDOUT-IMPLEMENTATION.md':'9570eaef974870eb4a3a44aeee125407a24eb91d',
  'research/paper-profit-regime-trend-breakout-v1-holdout.js':'7e0abb50d64a2a27be47590172058c59c4c9dc55',
  'research/run-paper-profit-regime-trend-breakout-v1-holdout.mjs':'f3e709237758a607321fd7a16de4a9dcbd2782fc',
  'test/paper-profit-regime-trend-breakout-v1-holdout.test.js':'34cf1bf89387e8ea193333ab9c05702ae5156a37',
  'research/PAPERBOT-PROFIT-REGIME-TREND-BREAKOUT-V1-HOLDOUT-RUN-AUTHORIZATION.md':'03d683f8f32534b3831692a09a2d0d68cab039b3',
  'research/results/regime-trend-breakout-v1-holdout-result.json':'f68452cae0bad17448a336113a9a264c3c999213',
  'research/results/regime-trend-breakout-v1-holdout-result.md':'00dfd074c34b3d9412f1ef945851e4911c8bc32f',
  'research/PAPERBOT-PROFIT-REGIME-TREND-BREAKOUT-V1-HOLDOUT-EVIDENCE.md':'40654266f711348d9577a424962327e23cf45a2d',
  'research/results/regime-trend-breakout-v1-result.json':'c3a5b72d27f825e2df951794fb782af429cfafc8',
  'research/results/regime-trend-breakout-v1-result.md':'3d2e9bc3a9e95752ecb8875f0cb514d0de21d360',
  'research/PAPERBOT-PROFIT-REGIME-TREND-BREAKOUT-V1-RUN-AUTHORIZATION.md':'7ecb7aadf0075f3a834001453ab2c32b2f1783f5',
  'research/PAPERBOT-PROFIT-REGIME-TREND-BREAKOUT-V1-DISCOVERY-EVIDENCE.md':'75cfb173c5d0e8681c00bafb634d11b0ba3490fb',
  'research/PAPERBOT-PROFIT-CONTROL-V2-STAGE-B.md':'6f3df6f877c67ef7f65408331ed1f1c6be25be4a',
  'research/paperbot-profit-control-v2-stage-b.js':'7b3217ae4a84577b711820ac630c38b1f09593cd',
  'research/PAPERBOT-PROFIT-REGIME-TREND-BREAKOUT-V1-PREREGISTRATION.md':'31f8e924939c2a713c4831db760f93661c2fe8c1',
  'research/paper-profit-regime-trend-breakout-v1-preregistration.js':'804e94486a8d4ab88c8a593586f43a08fb56ea20',
  'research/PAPERBOT-PROFIT-REGIME-TREND-BREAKOUT-V1-IMPLEMENTATION.md':'24a129607ee5b0625fe9cd14925d31c3e446bba0',
  'research/paper-profit-regime-trend-breakout-v1-evaluator.js':'1947cb7e85929c1cd49966e8b5fc96fd340eca2b',
  'scripts/collect-paper-profit-regime-trend-breakout-v1.mjs':'82a93703e46746ccdf6e21bcf0702d0506b15839',
  'research/run-paper-profit-regime-trend-breakout-v1.mjs':'a2d995393c2882b1fb2451403e6ac81af9e7f3b6',
  '.github/workflows/paper-profit-regime-trend-breakout-v1.yml':'5158e7777631a658d68fab8e9342ba27a2ff538f',
  'test/paper-profit-regime-trend-breakout-v1.test.js':'e14a92e95added82a045d147ea40851214a0090c',
  'research/PERPETUAL-QUARTER-HOUR-BOUNDARY-IMBALANCE-STRATEGY-V2-RESULT.md':'7bc0ef10fec1c89d0daa6023372ac03f8243c53e',
  'research/quarter-hour-boundary-imbalance-strategy-v2-result-summary.json':'a3fd70940357f2fe5d2d48fe11f5b2dc68856969',
  '.github/workflows/qh-boundary-strategy-v2.yml':'da9eb28f506104bc04f3308a2703a4cbd97ed62d',
  'research/PERPETUAL-QUARTER-HOUR-BOUNDARY-IMBALANCE-STRATEGY-V2-IMPLEMENTATION.md':'b179a35b0d71e7bff8eec259bef5fb375a3737ba',
  'research/qh_boundary_strategy_v2_core.py':'074c64575404d0cebfdf53ac83531a698ffdc766',
  'scripts/aggregate-qh-boundary-strategy-v2.py':'cdbf30133b8e596c8fbe6f1768675439742493de',
  'test/test_qh_boundary_strategy_v2.py':'14d408bce54506445a10a8ba562d00f4f04fdf93',
  'research/PERPETUAL-QUARTER-HOUR-BOUNDARY-IMBALANCE-STRATEGY-V1-RESULT.md':'b33649ff9813acfbaffbf3f2edfa5c456cb30739',
  'research/quarter-hour-boundary-imbalance-strategy-v1-result-summary.json':'0d85a4d5d728c52c813e3a7a69d416efcbbd53e9',
  'research/PERPETUAL-QUARTER-HOUR-BOUNDARY-IMBALANCE-STRATEGY-V2-PREREGISTRATION.md':'2170f11622207ed61add031ff79d6e296c00299d',
  '.github/workflows/research-profit-discovery-v1.yml':'33209e0efbf7e1011561cf0f9103b15788f6168d',
  '.github/workflows/research-profit-v2-upup.yml':'2673da0f4f9839fdec151cfa15b431ce40924039',
  'research/PAPERBOT-PROFIT-DISCOVERY-V1-RESULT.md':'bf0f891a8ad440774ac0bca716c2d394e6e9cd66',
  'research/PAPERBOT-PROFIT-SPECIAL-AGENT-V1.md':'da04b201a6fb07dcbf5cf24c580c574dbeda81b4',
  'research/PAPERBOT-PROFIT-SPECIAL-AGENT-V2.md':'23590bd494317dba813fa6b20b18d5a118f33488',
  'research/PAPERBOT-PROFIT-V2-UPUP-RESULT.md':'b39b76b3d8199a7d6c99817b304a31893c5dce7d',
  'research/paperbot-profit-special-agent-v1.js':'42b3dca22dd563990a351b08c9fa40cc582a322a',
  'research/paperbot-profit-special-agent-v2.js':'50bf5c1ab3456e33133767889f76017182f309ab',
  'research/results/paperbot-profit-discovery-v1-frozen.json':'7e64ccbe5595b7c453b61535cacdfea083faf30f',
  'research/results/paperbot-profit-v2-upup-frozen.json':'ca806d3c180a0f2394a89fe6766a27e0d1f61fb4',
  'research/run-paperbot-profit-discovery.mjs':'5a3eebd482f599c1eb48a7695ad873cb0b20e5c2',
  'research/run-paperbot-profit-v2-upup.mjs':'9dee9cef3c0b71259c7deeab42d2c0d66351087d',
  'test/paperbot-profit-special-agent-v1.test.js':'90ea64163e467760fd0290a467fcc230c126057f',
  'test/paperbot-profit-special-agent-v2.test.js':'9b63818b40926746699d2e49e41054f1acf43985'
});

export function gitBlobSha(content){
  const body=Buffer.isBuffer(content)?content:Buffer.from(content);
  const header=Buffer.from(`blob ${body.length}\0`);
  return crypto.createHash('sha1').update(header).update(body).digest('hex');
}

export function verifyFrozenResearch({readFile=path=>fs.readFileSync(path)}={}){
  const mismatches=[];
  for(const [path,expected] of Object.entries(FROZEN_RESEARCH_BLOBS)){
    let body;
    try{body=readFile(path)}
    catch(error){
      mismatches.push({path,expected,actual:null,reason:'MISSING'});
      continue;
    }
    const actual=gitBlobSha(body);
    if(actual!==expected)mismatches.push({path,expected,actual,reason:'MODIFIED'});
  }
  return {ok:mismatches.length===0,checked:Object.keys(FROZEN_RESEARCH_BLOBS).length,mismatches};
}

function run(){
  const result=verifyFrozenResearch();
  console.log('frozen-research guard',JSON.stringify(result));
  if(!result.ok){
    console.error('Frozen research lineage changed. Create a new ruleset/version instead of rewriting completed V1/V2 evidence.');
    process.exit(1);
  }
}

const direct=process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href;
if(direct)run();
