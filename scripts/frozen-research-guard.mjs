import fs from 'node:fs';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';

export const FROZEN_RESEARCH_BLOBS=Object.freeze({
  'research/CROSS-VENUE-FUNDING-EDGE-V1-SOURCE-DECISION.md':'27b0e5965b23e2574ea7e16ed9ee2e7d670aba8d',
  'research/cross-venue-funding-edge-v1-stage-lock.js':'e8702969ee9f23f487b0d85a71af4cdece049727',
  'test/cross-venue-funding-edge-v1-stage-lock.test.js':'f69d7e94f029b5fcb3109691b37b0ac381856595',
  'research/CROSS-VENUE-FUNDING-EDGE-V2-PREREGISTRATION.md':'6d590fb5b8c7b49c9f5da5b70f0e0e67a72880fb',
  'research/cross-venue-funding-edge-v2-stage-lock.js':'9ceb94c5a14f56284cd0e473707d6106819ccf80',
  'test/cross-venue-funding-edge-v2-preregistration.test.js':'8c48bf34b36fc1ac86f2922047ea74b1fc492350',
  'test/cross-venue-funding-edge-v2-stage-lock.test.js':'a8eb7ee316a9eb5a9a7ab2fd13786061e72c5d86',
  'research/CROSS-VENUE-FUNDING-EDGE-V2-SOURCE-AUDIT-AUTHORIZATION.md':'a7623f82ce6049342f8ce3e338b27595e1f975f2',
  'research/CROSS-VENUE-FUNDING-EDGE-V2-SOURCE-AUDIT-EVALUATION.md':'04d8f5a59184a9812874123265bc05466b136f36',
  'research/cross-venue-funding-edge-v2-source-evaluation.json':'0cc60ce3dbee82d8f334074269832bcdc9e761f8',
  'test/cross-venue-funding-edge-v2-source-evaluation.test.js':'1224cfad7ad4d20929e3881560bf6c1bf8fb4f58',
  'research/CROSS-VENUE-FUNDING-EDGE-V2-COVERAGE-EVIDENCE.json':'07c2778e0e91d68689bf0891e2c76f94ceaef1ac',
  'research/CROSS-VENUE-FUNDING-EDGE-V2-IMPLEMENTATION.md':'1b8918679ac3a4163cd731ec58b963a5775ce280',
  'research/cross-venue-funding-edge-v2.js':'8d34e355d639571f0e250b35a7f0b71159527788',
  'research/cross-venue-funding-edge-v2-data-contract.js':'c6e53fd86c55cad0d2ea9fb414cb7c065a61c5cf',
  'research/cross-venue-funding-edge-v2-ledger.js':'5b1e4a400951568a093779cfeaad26d86b936c90',
  'research/cross-venue-funding-edge-v2-runner.js':'7060a76720fdfd137e094d07417b67b4d8cb909c',
  'scripts/collect-cross-venue-funding-edge-v2-source.mjs':'b6b66f5c36f5e3b52f4b45ca7cb33e794a64da7e',
  'test/cross-venue-funding-edge-v2.test.js':'3da819c6f55ef9d67ae60a634ffc83ca6dbc5f9b',
  'test/cross-venue-funding-edge-v2-data-contract.test.js':'83900dcc2f193fb32c98dc379c6cb4be0aff4c4a',
  'test/cross-venue-funding-edge-v2-ledger.test.js':'ee78a72c96003542cc8c9e85232d5b722d730152',
  'test/cross-venue-funding-edge-v2-runner.test.js':'1f9f706bf792daf648d06bb7c91bddf43641fc80',
  'test/cross-venue-funding-edge-v2-collector.test.js':'d9ee431eae1a7f4bcc8419bfe56852e4acdb601c',
  '.github/workflows/cross-venue-funding-edge-v2-source.yml':'c322791646ea6b308ddab79912a030f9ff64699b',
  'research/PAPER-EDGE-V1-DISCOVERY-DECISION.md':'6221e3fd9645a7f1bd577b98c46662974127f070',
  'research/paper-edge-v1-discovery-decision.json':'1a3d082b8c0ef85cb0fd5a773d029026818e3e9f',
  'research/edge-v1-stage-lock.js':'e63c4d8018a2ef17ae0712f09ae190174cba659a',
  'test/edge-v1-stage-lock.test.js':'fc8998aff337db7db3037bf01a97c4b658b4961b',
  'research/LOW-VOLATILITY-RANK-WEIGHTED-V2-PROSPECTIVE-ARCHIVE-RETRY-CORRECTION.md':'e2783e50a8cba6cd3278e80f608a6e6bf7f74c82',
  'research/LOW-VOLATILITY-RANK-WEIGHTED-V2-PROSPECTIVE-START-EVIDENCE.md':'626f7bbc82f841a2862a3257d2f4a6e187f56e37',
  'research/LOW-VOLATILITY-RANK-WEIGHTED-V2-PROSPECTIVE-START-AUTHORIZATION.md':'1d4ec4f2386005b7a5094ea3f4ea2d3143b9b9a7',
  'research/LOW-VOLATILITY-RANK-WEIGHTED-V2-PROSPECTIVE-BINANCE-VISION-CORRECTION.md':'9fa92d998c1360692016ee0b67161a03c28ce297',
  'research/LOW-VOLATILITY-RANK-WEIGHTED-V2-PROSPECTIVE-ENDPOINT-FAILOVER-CORRECTION.md':'2697a57b6bf268516ebc2b50da33d7a324c44d2b',
  '.github/workflows/low-volatility-rank-weighted-v2-prospective.yml':'d4935ee0b01917a84d46a9ea6919c467a8aaec03',
  'test/test_low_volatility_rank_weighted_v2_prospective.py':'4f06f31c7a7983dcc3ed8b6e07967ca0d54e9de5',
  'research/run-low-volatility-rank-weighted-v2-prospective.py':'0287e968a22c5c2be197fb10e5ef35b0189d0bc0',
  'scripts/collect-low-volatility-rank-weighted-v2-prospective.py':'57c74bb8099e3e92d73331e6061d910c6b17c4ef',
  'research/low_volatility_rank_weighted_v2_prospective.py':'b931390ed941e4c73fb0f5972aef682bbbab8a34',
  'research/LOW-VOLATILITY-RANK-WEIGHTED-V2-PROSPECTIVE-SHADOW-IMPLEMENTATION.md':'d156db5409c94bc6cfface2a65e5fb6bef9a6f40',
  'research/LOW-VOLATILITY-RANK-WEIGHTED-V2-PROSPECTIVE-REVIEW-PREREGISTRATION.md':'738965343f5fc28835f15bbbcdc0a12d8cf3cfbe',
  'research/LOW-VOLATILITY-RANK-WEIGHTED-V2-HOLDOUT-EVIDENCE.md':'f3e6c329fe57b3a5d6a4ee03dde693c33d4aa85b',
  'research/results/low-volatility-rank-weighted-v2-holdout-frozen-summary.json':'4e59899559fefe5c8f6697f9f4fc320fc9ed8516',
  'research/results/low-volatility-rank-weighted-v2-holdout-result.md':'08756eb06c30414a5c1e2ec52916e694829f7447',
  'research/LOW-VOLATILITY-RANK-WEIGHTED-V2-HOLDOUT-RUN-AUTHORIZATION.md':'2871e269b9dd31b4d6c4eb6d72b8873cd7c06cc0',
  '.github/workflows/low-volatility-rank-weighted-v2-holdout.yml':'a481844c1209609448eadc66b1690aceae1ed52f',
  'test/test_low_volatility_rank_weighted_v2_holdout.py':'899f6d4161d4a4572971a00886d768ffad770ff2',
  'research/run-low-volatility-rank-weighted-v2-holdout.py':'4ce41e23a5a6db4bf0a26f2218b4e372deebecb1',
  'scripts/collect-low-volatility-rank-weighted-v2-holdout.py':'3569c714b000c67184d7144b1da3b92a9c321c6d',
  'research/low_volatility_rank_weighted_v2_holdout.py':'0d07a763b4ed0bb2c4f4c6970de8d50b1823d55c',
  'research/LOW-VOLATILITY-RANK-WEIGHTED-V2-HOLDOUT-IMPLEMENTATION.md':'23e6f6bc8cc095f5dca437bd411501a2d0b825f6',
  'research/LOW-VOLATILITY-RANK-WEIGHTED-V2-DEVELOPMENT-EVIDENCE.md':'e9babe1566c8667a21eb6cae8388ca6dfb77385e',
  'research/results/low-volatility-rank-weighted-v2-development-frozen-summary.json':'5b3ada9fd32abe4747fbc854bb5f5388e15e6763',
  'research/results/low-volatility-rank-weighted-v2-development-result.md':'031b1487e487e1ab00cddd5e19b94a2533e3694e',
  'research/LOW-VOLATILITY-RANK-WEIGHTED-V2-DEVELOPMENT-RUN-AUTHORIZATION.md':'dd719ebe10f818a2a261df4a1fea6a4d3cf491fd',
  'research/LOW-VOLATILITY-RANK-WEIGHTED-V2-FUNDING-TIMESTAMP-CORRECTION.md':'ad5694309438c80aac0717700b7772fd94bc8f89',
  '.github/workflows/low-volatility-rank-weighted-v2.yml':'52bc76b5572b74cf4e7808e4f707e15bddda6769',
  'test/test_low_volatility_rank_weighted_v2.py':'8a5c044e76555ad11eaff0da9be2ef763a16329c',
  'research/run-low-volatility-rank-weighted-v2-development.py':'e8f076258612407dd3676af94a7442c785ab53ba',
  'scripts/collect-low-volatility-rank-weighted-v2-development.py':'c084d8ec4a72a666818b9e8a9f5ca143788a0c9d',
  'research/low_volatility_rank_weighted_v2.py':'87302fdc0c1880a35e1bfd663be8191d5f6be429',
  'research/LOW-VOLATILITY-RANK-WEIGHTED-V2-IMPLEMENTATION.md':'90e070996c399d6d678a10b25e6b52cd0aac6335',
  'research/LOW-VOLATILITY-RANK-WEIGHTED-V2-PREREGISTRATION.md':'b8c644a5a15c321a1a52514dd05eb088288cd8f4',
  'research/CROSS-SECTIONAL-LOW-VOLATILITY-V1-PREREGISTRATION.md':'7c72162b7cf2f3dd5b22ef2aecc30936de52f4c8',
  'research/cross_sectional_low_volatility_v1.py':'d161b6b4553d5a18fc7064570f4a4e956178d0c9',
  'scripts/collect-cross-sectional-low-volatility-v1-discovery.py':'c6d76e0feb0b779b96c6abe6d8a611bfe808fd3a',
  'research/run-cross-sectional-low-volatility-v1-discovery.py':'c2c787ad3bfb10b001af90c7af68b279be84515a',
  'test/test_cross_sectional_low_volatility_v1.py':'e168fa68825c19d6ceee22370b1129132c3529eb',
  '.github/workflows/cross-sectional-low-volatility-v1.yml':'43c72ee5dbfaf5e8002fc87f2cb95ca3e672a92f',
  'research/CROSS-SECTIONAL-LOW-VOLATILITY-V1-DISCOVERY-RUN-AUTHORIZATION.md':'90c4d65b64252ac21317c3e5f0dc59599b8e0da8',
  'research/results/cross-sectional-low-volatility-v1-discovery-result.json':'7c36feb6a7dfdd8eec7d14bd17f63759b0a2328a',
  'research/results/cross-sectional-low-volatility-v1-discovery-result.md':'a6130948918591515c764e056b3504cd9d8a545c',
  'research/CROSS-SECTIONAL-LOW-VOLATILITY-V1-DISCOVERY-EVIDENCE.md':'e7bfadcd358faaf52d8cb4d7bea230ed820191a0',
  'research/PERPETUAL-TAKER-ORDER-FLOW-RELATIVE-STRENGTH-V2-RUN-AUTHORIZATION.md':'3d79c17d43a2c242a25b0b05a6127b6cb514d759',
  'research/results/perpetual-taker-order-flow-relative-strength-v2-result.json':'6494dbfb5760671eadbde7b77ff619acd1f5073d',
  'research/results/perpetual-taker-order-flow-relative-strength-v2-result.md':'3cec79c16274cdb51a6d55bdf657c5374769adaf',
  'research/PERPETUAL-TAKER-ORDER-FLOW-RELATIVE-STRENGTH-V2-EVIDENCE.md':'a6775c5240e1d422b5dd4fc222e34fb79b967786',
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
