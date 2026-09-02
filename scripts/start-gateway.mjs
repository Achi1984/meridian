import { applyReadTokenSecret } from './read-token-auth.mjs';

const auth=applyReadTokenSecret(process.env);
if(auth.mode==='LEGACY_FALLBACK'){
  throw new Error('MERIDIAN read auth secret missing: configure MERIDIAN_READ_TOKEN or MERIDIAN_READ_TOKEN_SHA256');
}
console.log(`[GATEWAY] read auth mode ${auth.mode}`);
await import('../server-gateway.js');
