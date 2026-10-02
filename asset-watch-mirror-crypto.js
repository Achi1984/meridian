import crypto from 'node:crypto';

const AAD='MERIDIAN-ASSET-WATCH-MIRROR-V1';
const RECEIPT_SCHEMA='MERIDIAN-ASSET-WATCH-MIRROR-RECEIPT-V1';
const HASH_RE=/^[a-f0-9]{64}$/;

function keyFromHash(tokenHash){
  const h=String(tokenHash||'').trim().toLowerCase();
  if(!HASH_RE.test(h))throw new Error('asset_watch_mirror_invalid_key_hash');
  return Buffer.from(h,'hex');
}
export function assetWatchMirrorKeyHashFromShareToken(shareToken){
  return crypto.createHash('sha256').update(String(shareToken||'')).digest('hex');
}
export function assetWatchMirrorPublicReceipt(snapshot){
  return {
    schemaVersion:RECEIPT_SCHEMA,
    bridgeSchemaVersion:String(snapshot?.schemaVersion||''),
    readOnly:snapshot?.readOnly===true,
    executionImpact:snapshot?.executionImpact===true,
    detailsComplete:snapshot?.detailsComplete===true,
    sourceStatusOk:snapshot?.sourceStatusOk===true,
    fresh:snapshot?.fresh===true,
    usableForOverwrite:snapshot?.usableForOverwrite===true,
    source:String(snapshot?.source||'UNAVAILABLE'),
    sourceSnapshotAt:snapshot?.sourceSnapshotAt||null,
    sourceAgeMs:Number.isFinite(Number(snapshot?.sourceAgeMs))?Number(snapshot.sourceAgeMs):null,
    freshnessLimitMs:Number.isFinite(Number(snapshot?.freshnessLimitMs))?Number(snapshot.freshnessLimitMs):null
  };
}

export const ASSET_WATCH_MAX_FRESHNESS_MS=15*60*1000;
export const ASSET_WATCH_MAX_CLOCK_SKEW_MS=60*1000;

export function validateAssetWatchMirrorEnvelope(envelope,{
  nowMs=Date.now(),
  maxFreshnessMs=ASSET_WATCH_MAX_FRESHNESS_MS,
  maxClockSkewMs=ASSET_WATCH_MAX_CLOCK_SKEW_MS
}={}){
  const x=envelope||{},r=x.receipt||{};
  const shapeOk=
    x.schemaVersion===AAD &&
    x.alg==='A256GCM' &&
    !!x.generatedAt && !!x.iv && !!x.tag && !!x.ciphertext &&
    r.schemaVersion===RECEIPT_SCHEMA &&
    r.bridgeSchemaVersion==='MERIDIAN-ASSET-WATCH-BRIDGE-V1' &&
    r.readOnly===true && r.executionImpact===false &&
    r.detailsComplete===true && r.sourceStatusOk===true &&
    r.fresh===true && r.usableForOverwrite===true &&
    !!r.sourceSnapshotAt;
  if(!shapeOk)return{ok:false,reason:'receipt_invalid'};

  const sourceAt=Date.parse(r.sourceSnapshotAt);
  const generatedAt=Date.parse(x.generatedAt);
  const limitMs=Number(r.freshnessLimitMs);
  const reportedAgeMs=Number(r.sourceAgeMs);
  const policyMax=Number(maxFreshnessMs);
  const skewMax=Number(maxClockSkewMs);
  const now=Number(nowMs);
  if(![sourceAt,generatedAt,limitMs,reportedAgeMs,policyMax,skewMax,now].every(Number.isFinite))
    return{ok:false,reason:'freshness_fields_invalid'};
  if(limitMs<=0||policyMax<=0||skewMax<0)return{ok:false,reason:'freshness_policy_invalid'};
  if(limitMs>policyMax)return{ok:false,reason:'freshness_limit_exceeds_policy',limitMs,policyMax};

  const ageMs=generatedAt-sourceAt;
  if(ageMs<0)return{ok:false,reason:'source_timestamp_in_future',ageMs,limitMs};
  if(generatedAt>now+skewMax)return{ok:false,reason:'envelope_timestamp_in_future',generatedAt,now,skewMax};
  if(now-generatedAt>policyMax)return{ok:false,reason:'envelope_stale',generatedAt,now,policyMax};
  if(ageMs>limitMs||ageMs>policyMax)return{ok:false,reason:'source_snapshot_stale',ageMs,limitMs,policyMax};
  if(reportedAgeMs<0)return{ok:false,reason:'reported_source_age_negative',reportedAgeMs};
  if(reportedAgeMs>limitMs||reportedAgeMs>policyMax)
    return{ok:false,reason:'reported_source_age_stale',reportedAgeMs,limitMs,policyMax};

  return{ok:true,ageMs,reportedAgeMs,limitMs,policyMax};
}
export function encryptAssetWatchMirror(snapshot,tokenHash,{iv=crypto.randomBytes(12),now=new Date().toISOString()}={}){
  const key=keyFromHash(tokenHash);
  const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(Buffer.from(AAD));
  const plaintext=Buffer.from(JSON.stringify(snapshot));
  const ciphertext=Buffer.concat([cipher.update(plaintext),cipher.final()]);
  const tag=cipher.getAuthTag();
  return {
    schemaVersion:AAD,
    alg:'A256GCM',
    generatedAt:now,
    receipt:assetWatchMirrorPublicReceipt(snapshot),
    iv:Buffer.from(iv).toString('base64url'),
    tag:tag.toString('base64url'),
    ciphertext:ciphertext.toString('base64url')
  };
}
export function decryptAssetWatchMirror(envelope,shareToken){
  if(envelope?.schemaVersion!==AAD||envelope?.alg!=='A256GCM')throw new Error('asset_watch_mirror_invalid_envelope');
  const key=Buffer.from(assetWatchMirrorKeyHashFromShareToken(shareToken),'hex');
  const iv=Buffer.from(String(envelope.iv||''),'base64url');
  const tag=Buffer.from(String(envelope.tag||''),'base64url');
  const ciphertext=Buffer.from(String(envelope.ciphertext||''),'base64url');
  const decipher=crypto.createDecipheriv('aes-256-gcm',key,iv);
  decipher.setAAD(Buffer.from(AAD));
  decipher.setAuthTag(tag);
  const plaintext=Buffer.concat([decipher.update(ciphertext),decipher.final()]).toString('utf8');
  return JSON.parse(plaintext);
}
