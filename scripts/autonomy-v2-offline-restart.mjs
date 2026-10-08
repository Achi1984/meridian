// Offline-only deterministic restart fixture. No persistence or dispatch.
import {createOfflineStore} from './autonomy-v2-offline-store.mjs';
export function replayRestart(initial, operations) {
  if (!Array.isArray(operations)) throw Error('INVALID_OPERATIONS');
  const store=createOfflineStore(initial);
  const results=[];
  for (const operation of operations) {
    if (!operation || operation.type!=='CLAIM') {
      results.push({ok:false,reason:'UNSUPPORTED_OPERATION'});
      break;
    }
    if (!operation.args || typeof operation.args !== 'object' || Array.isArray(operation.args)) {
      results.push({ok:false,reason:'INVALID_CLAIM'});
      break;
    }
    const result=store.claim(operation.args);
    results.push({ok:result.ok,reason:result.reason??'CLAIMED'});
    if (!result.ok) break;
  }
  return Object.freeze({results:Object.freeze(results),audit:store.audit()});
}
