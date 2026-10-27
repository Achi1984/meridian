import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {canonicalHistoricalExportPayload} from '../../../v11/arena-historical-export.js';
import {exportHistoricalResult} from '../../../scripts/research/b1-7/export-historical-result.mjs';
import {createExecution} from '../../../scripts/research/b1-7/engine.mjs';

const digest=value=>createHash('sha256').update(value).digest('hex');
const pythonGenerator=String.raw`
import hashlib, json, sys
def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False)
def sha(value):
    return hashlib.sha256(value).hexdigest()
source = json.load(sys.stdin)
profile, result, state, trial_key = source['profile'], source['result'], source['state'], source['trialKey']
result_bytes = canonical(result).encode('ascii')
by_id = {path['pathId']: path for path in result['paths']}
computation_ids = [profile['pathIds'][i] for i in profile['computationOrder']]
count = 44 if result['status'] == 'COMPLETED' else 19
paths = [{
    'pathId': path_id, 'ordinal': index + 1,
    'phase': 'DEVELOPMENT' if index < 19 else 'DIAGNOSTIC',
    'state': 'completed', 'startedAt': '2026-01-01T00:00:01Z',
    'payloadSha256': sha(canonical(by_id[path_id]).encode('ascii')),
    'completedAt': '2026-01-01T00:00:01Z'
} for index, path_id in enumerate(computation_ids[:count])]
summary = {key: value for key, value in result.items() if key not in ('paths', 'controlDefinitions')}
controls = canonical(result['controlDefinitions'])
job = {
    'trialId': sha(trial_key.encode('utf8')), 'trialKey': trial_key,
    'state': state, 'attempts': 1, 'owner': 'synthetic-generated-sample', 'fence': 1,
    'profile': profile['profile'], 'protocolSha256': profile['protocolSha256'],
    'sourceSha256': profile.get('sourceIdentitySha256') or sha(canonical(profile['sourceSha256']).encode('ascii')),
    'dataSha256': profile['inputSha256'], 'manifestSha256': profile['manifestSha256'],
    'pathIds': profile['pathIds'], 'computationPathIds': computation_ids,
    'timestamps': {'createdAt': '2026-01-01T00:00:00Z', 'startedAt': '2026-01-01T00:00:01Z',
                   'finishedAt': '2026-01-01T00:00:01Z'},
    'paths': paths, 'controls': controls,
    'controlBindings': {'primaryDevelopmentSha256': paths[0]['payloadSha256'],
                        'fullBasketDevelopmentSha256': paths[15]['payloadSha256']},
    'result': result_bytes.decode('utf8'), 'resultSha256': sha(result_bytes),
    'summarySha256': sha(canonical(summary).encode('ascii')),
    'reason': None if result['status'] == 'COMPLETED' else 'INVALID_OR_ZERO_DEVELOPMENT_RISK_DENOMINATOR',
    'unresolved': False, 'executionAuthorized': False, 'promotionAuthorized': False,
    'profitabilityInferred': False
}
print(json.dumps(job, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False))
`;

export {digest};

export function generatedResult(profile,series){
  const execution=createExecution({
    seriesByAsset:series,
    source:{kind:'SYNTHETIC_FIXTURE'},
    implementationSha256:profile.implementationSha256
  });
  while(execution.status==='READY')execution.advanceOne();
  return execution.finalResult();
}

export function generatedObservation(profile,result,state,trialKey){
  const input=JSON.stringify({profile,result:JSON.parse(JSON.stringify(result)),state,trialKey});
  const generated=spawnSync('python3',['-c',pythonGenerator],{
    input,encoding:'utf8',maxBuffer:8*1024*1024
  });
  if(generated.status!==0)throw new Error(generated.stderr||'GENERATED_OBSERVATION_FAILED');
  return JSON.parse(generated.stdout);
}

export async function generatedEnvelope(profile,result,state,trialKey){
  const observation=generatedObservation(profile,result,state,trialKey);
  const resultBytes=observation.result===null?null:new TextEncoder().encode(observation.result);
  return exportHistoricalResult({observation,resultBytes,syntheticFixture:true});
}

export async function seal(envelope){
  envelope.payloadSha256=digest(Buffer.from(canonicalHistoricalExportPayload(envelope),'ascii'));
  return envelope;
}
