// Actual snapshot/rebuild/replay fixture for deterministic crash simulation.
import {createOfflineStore} from './autonomy-v2-offline-store.mjs';
import {isOfflineDataRecord as record} from './autonomy-v2-offline-data.mjs';
const METHODS=Object.freeze({CLAIM:'claim',MARK_RECOVERY:'markRecovery',REQUEUE:'reconcileToQueue',COMPLETE:'complete'});
export function replayRestart(initial,operations,options={}){
  if(!record(options))throw Error('INVALID_OPERATIONS');
  const crashAfter=Object.hasOwn(options,'crashAfter')?options.crashAfter:Number.POSITIVE_INFINITY;
  if(!Array.isArray(operations)||!(Number.isSafeInteger(crashAfter)||crashAfter===Number.POSITIVE_INFINITY)||crashAfter<0)throw Error('INVALID_OPERATIONS');
  let store=createOfflineStore(initial),applied=0,restarts=0;const results=[];
  const restartAtBoundary=()=>{
    if(restarts===0&&applied===crashAfter){store=createOfflineStore(store.snapshotAll());restarts++;}
  };
  for(const operation of operations){
    restartAtBoundary();
    if(!record(operation)||!Object.hasOwn(operation,'type')||typeof operation.type!=='string'||!Object.hasOwn(METHODS,operation.type)){
      results.push({ok:false,reason:'UNSUPPORTED_OPERATION'});break;
    }
    const value=store[METHODS[operation.type]](Object.hasOwn(operation,'args')?operation.args:undefined);
    results.push({ok:value.ok,reason:value.reason});if(!value.ok)break;applied++;
  }
  // Include the boundary after the final accepted operation, also for an empty list.
  restartAtBoundary();
  return Object.freeze({results:Object.freeze(results),audit:store.audit(),snapshot:store.snapshotAll(),restarts});
}
