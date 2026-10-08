// Actual snapshot/rebuild/replay fixture for deterministic crash simulation.
import {createOfflineStore} from './autonomy-v2-offline-store.mjs';
const METHODS=Object.freeze({CLAIM:'claim',MARK_RECOVERY:'markRecovery',REQUEUE:'reconcileToQueue',COMPLETE:'complete'});
export function replayRestart(initial,operations,{crashAfter=Number.POSITIVE_INFINITY}={}){
  if(!Array.isArray(operations)||!(Number.isSafeInteger(crashAfter)||crashAfter===Number.POSITIVE_INFINITY)||crashAfter<0)throw Error('INVALID_OPERATIONS');
  let store=createOfflineStore(initial),applied=0,restarts=0;const results=[];
  for(const operation of operations){if(applied===crashAfter){store=createOfflineStore(store.snapshotAll());restarts++;}const method=operation&&METHODS[operation.type];if(!method){results.push({ok:false,reason:'UNSUPPORTED_OPERATION'});break;}const value=store[method](operation.args);results.push({ok:value.ok,reason:value.reason});if(!value.ok)break;applied++;}
  return Object.freeze({results:Object.freeze(results),audit:store.audit(),snapshot:store.snapshotAll(),restarts});
}
