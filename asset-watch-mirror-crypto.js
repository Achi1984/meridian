import crypto from 'node:crypto';

const AAD='MERIDIAN-ASSET-WATCH-MIRROR-V1';
const HASH_RE=/^[a-f0-9]{64}$/;

function keyFromHash(tokenHash){
  const h=String(tokenHash||'').trim().toLowerCase();
  if(!HASH_RE.test(h))throw new Error('asset_watch_mirror_invalid_key_hash');
  return Buffer.from(h,'hex');
}
export function assetWatchMirrorKeyHashFromShareToken(shareToken){
  return crypto.createHash('sha256').update(String(shareToken||'')).digest('hex');
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
