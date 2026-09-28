import crypto from 'node:crypto';

const HASH_RE=/^[a-f0-9]{64}$/;

export function hashAssetWatchShareToken(token){
  return crypto.createHash('sha256').update(String(token||'')).digest('hex');
}

export function createAssetWatchShareToken(randomBytes=crypto.randomBytes){
  const token=randomBytes(32).toString('base64url');
  return {
    token,
    tokenHash:hashAssetWatchShareToken(token)
  };
}

export function verifyAssetWatchShareToken(token,expectedHash){
  const supplied=String(token||'').trim();
  const expected=String(expectedHash||'').trim().toLowerCase();
  if(!supplied||!HASH_RE.test(expected))return false;
  const actual=hashAssetWatchShareToken(supplied);
  return crypto.timingSafeEqual(Buffer.from(actual,'hex'),Buffer.from(expected,'hex'));
}

export function rotateAssetWatchShareState(current,{tokenHash,at=new Date().toISOString()}={}){
  const hash=String(tokenHash||'').trim().toLowerCase();
  if(!HASH_RE.test(hash))throw new Error('asset_watch_share_invalid_hash');
  return {
    schemaVersion:'MERIDIAN-ASSET-WATCH-SHARE-V1',
    enabled:true,
    tokenHash:hash,
    createdAt:at,
    revokedAt:null,
    scope:'SANITIZED_PIONEX_BOT_WATCH_ONLY',
    readOnly:true,
    executionImpact:false
  };
}

export function revokeAssetWatchShareState(current,{at=new Date().toISOString()}={}){
  return {
    schemaVersion:'MERIDIAN-ASSET-WATCH-SHARE-V1',
    enabled:false,
    tokenHash:null,
    createdAt:current?.createdAt||null,
    revokedAt:at,
    scope:'SANITIZED_PIONEX_BOT_WATCH_ONLY',
    readOnly:true,
    executionImpact:false
  };
}

export function assetWatchShareEnabled(state){
  return state?.enabled===true&&HASH_RE.test(String(state?.tokenHash||'').toLowerCase());
}
