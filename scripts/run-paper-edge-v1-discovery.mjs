import fs from 'node:fs/promises';
import {runEdgeV1Discovery} from '../research/paper-edge-v1-discovery-runner.js';

const sourcePath=process.argv[2]||'research/data/paper-edge-v1-source.json';
const outputPath=process.argv[3]||'research/data/paper-edge-v1-discovery.json';
const source=JSON.parse(await fs.readFile(sourcePath,'utf8'));
const result=runEdgeV1Discovery(source);
await fs.mkdir('research/data',{recursive:true});
await fs.writeFile(outputPath,JSON.stringify(result,null,2));
console.log(JSON.stringify({
 schema:result.schema,
 ruleset:result.ruleset,
 authorizedStage:result.authorizedStage,
 sourceDigest:result.sourceDigest,
 split:result.split,
 summary:result.summary,
 decision:result.decision,
 digest:result.digest
},null,2));
