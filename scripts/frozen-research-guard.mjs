import fs from 'node:fs';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';

export const FROZEN_RESEARCH_BLOBS=Object.freeze({
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
