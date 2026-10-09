// Deterministic crash simulation around an injected synthetic atomic-memory boundary.
import {createOfflineAuthority} from './autonomy-v2-offline-authority.mjs';
import {isOfflineDataRecord as record} from './autonomy-v2-offline-data.mjs';

export const OFFLINE_CRASH_POINTS=Object.freeze(['BEFORE_STAGE','AFTER_STAGE','BEFORE_COMMIT','AFTER_COMMIT','BEFORE_ACK']);
const answer=(ok,reason,extra={})=>Object.freeze({ok,reason,...extra});

export function createOfflineTransactionLab(initial=[],options={}) {
  const authority=createOfflineAuthority(initial,options);
  function openWriter(writer) {
    const session=authority.openWriter(writer);
    function execute(request,crashOptions={}) {
      if(!record(crashOptions)||Object.keys(crashOptions).some(key=>key!=='crashAt')||
        (Object.hasOwn(crashOptions,'crashAt')&&!OFFLINE_CRASH_POINTS.includes(crashOptions.crashAt)))return answer(false,'INVALID_CRASH_POINT');
      const invalid=session.preflight(request);if(invalid)return invalid;
      const crash=committed=>{
        // A crashed coordinator is restarted; trusted memory persists, its incarnation advances.
        const restarted=authority.restart();
        return answer(false,'SIMULATED_CRASH',{crashAt:crashOptions.crashAt,committed,restarted:restarted.ok});
      };
      if(crashOptions.crashAt==='BEFORE_STAGE')return crash(false);
      const staged=session.stage(request);if(!staged.ok)return staged;
      if(crashOptions.crashAt==='AFTER_STAGE'||crashOptions.crashAt==='BEFORE_COMMIT')return crash(false);
      const committed=session.commit(staged.ticket);if(!committed.ok)return committed;
      if(crashOptions.crashAt==='AFTER_COMMIT'||crashOptions.crashAt==='BEFORE_ACK')return crash(true);
      return committed;
    }
    return Object.freeze({execute,stage:session.stage,commit:session.commit,checkFence:session.checkFence});
  }
  return Object.freeze({openWriter,snapshot:authority.snapshot,restore:authority.restore,authorityState:authority.authorityState,restart:authority.restart});
}
