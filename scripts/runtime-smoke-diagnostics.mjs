const FLAGS=['readOnly','executionImpact','detailsComplete','sourceStatusOk','fresh','usableForOverwrite'];
const SOURCES=['PIONEX_BOT_API','PIONEX_WALLET_BOT_DETAIL','UNAVAILABLE'];

export function assetWatchStrictGateDiagnostics(envelope,health){
  const receipt=envelope?.receipt||{};
  const result=Object.fromEntries(FLAGS.map(key=>[
    key,typeof receipt[key]==='boolean'?receipt[key]:null
  ]));
  result.source=SOURCES.includes(receipt.source)?receipt.source:null;
  for(const key of ['sourceSnapshotAt','generatedAt']){
    const value=key==='generatedAt'?envelope?.generatedAt:receipt[key];
    result[key]=typeof value==='string'&&value.length<=32&&Number.isFinite(Date.parse(value))
      ?new Date(value).toISOString():null;
  }
  for(const key of ['sourceAgeMs','freshnessLimitMs']){
    const value=receipt[key];
    result[key]=typeof value==='number'&&Number.isFinite(value)?value:null;
  }
  const sha=health?.deploymentSha;
  result.deploymentSha=typeof sha==='string'&&/^[a-f0-9]{7,40}$/i.test(sha)?sha.toLowerCase():null;
  return JSON.stringify(result);
}
