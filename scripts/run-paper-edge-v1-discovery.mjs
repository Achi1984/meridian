import fs from 'node:fs/promises';
import path from 'node:path';
import {runDiscovery} from '../research/paper-edge-v1-discovery-runner.js';

const sourcePath=process.env.EDGE_V1_SOURCE_PATH||'research/data/locked/paper-edge-v1-source.json';
const outputDir=process.env.EDGE_V1_DISCOVERY_OUTPUT_DIR||'research/results';
const pkg=JSON.parse(await fs.readFile(sourcePath,'utf8'));
const result=runDiscovery(pkg);
await fs.mkdir(outputDir,{recursive:true});
const fullPath=path.join(outputDir,'paper-edge-v1-discovery-full.json');
const summaryPath=path.join(outputDir,'paper-edge-v1-discovery-summary.json');
const {trades,equityCurve,...summary}=result;
await fs.writeFile(fullPath,JSON.stringify(result,null,2)+'\n');
await fs.writeFile(summaryPath,JSON.stringify({...summary,tradeCount:trades.length,equityPoints:equityCurve.length},null,2)+'\n');
console.log(JSON.stringify({decision:result.gate.decision,pass:result.gate.pass,reasons:result.gate.reasons,summary:result.summary,tradeDigest:result.tradeDigest,nextStage:result.nextStage},null,2));
