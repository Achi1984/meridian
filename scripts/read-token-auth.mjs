import crypto from 'node:crypto';

export function sha256(value){
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function applyReadTokenSecret(env=process.env){
  const plain=String(env.MERIDIAN_READ_TOKEN||'').trim();
  if(!plain){
    return {mode:String(env.MERIDIAN_READ_TOKEN_SHA256||'').trim()?'SHA256_SECRET':'LEGACY_FALLBACK'};
  }
  env.MERIDIAN_READ_TOKEN_SHA256=sha256(plain);
  delete env.MERIDIAN_READ_TOKEN;
  return {mode:'PASSWORD_SECRET'};
}
