// Snapshot/rebuild/replay fixture. Crashes occur between atomic offline operations.
import {createOfflineStore} from './autonomy-v2-offline-store.mjs';
const METHODS=Object.freeze({CLAIM:'claim',MARK_RECOVERY:'markRecovery',REQUEUE:'reconcileToQueue',COMPLETE:'complete'});
export function replayRestart(initial,operations,{crashAfter=Number.POSITIVE_INFINITY}={}) {
  if(!Array.isArray(operations)||!(Number.isSafeInteger(crashAfter)||crashAfter===Number.POSITIVE_INFINITY)||crashAfter<0)
    throw Error('INVALID_OPERATIONS');
  let store=createOfflineStore(initial),applied=0,restarts=0;
  const results=[],audit=[];
  for(const operation of operations) {
    if(applied===crashAfter) {
      audit.push(...store.audit());store=createOfflineStore(store.snapshotAll());restarts++;
    }
    if(!operation||typeof operation.type!=='string'||!Object.hasOwn(METHODS,operation.type)) {
      results.push({ok:false,reason:'UNSUPPORTED_OPERATION'});break;
    }
    const value=store[METHODS[operation.type]](operation.args);
    results.push({ok:value.ok,reason:value.reason});
    if(!value.ok)break;
    applied++;
  }
  audit.push(...store.audit());
  return Object.freeze({results:Object.freeze(results),audit,snapshot:store.snapshotAll(),restarts});
}
