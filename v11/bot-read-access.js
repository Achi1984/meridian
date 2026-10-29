import {parseBotReadCredential} from './bot-read-client.js?v=B17-M11';

// Inactive memory-only credential holder. No authentication or account activation.
// The caller supplies the existing client's lock operation; no token is sent to it.
export function createBotReadAccess({lock} = {}) {
  if (typeof lock !== 'function') throw new Error('Access unavailable');
  let credential = null, generation = 0, locking = false;
  function clear() {
    generation++;
    credential = null;
    if (locking) return false;
    locking = true;
    try { lock(); return true; } catch { return false; }
    finally { credential = null; locking = false; }
  }
  function provide(value) {
    const id = generation + 1;
    if (!clear()) return false;
    // Reentrant access changes invalidate this operation and remain locked.
    if (generation !== id) return false;
    if (!parseBotReadCredential(value)) return false;
    const candidate = value.trim();
    if (!candidate) return false;
    credential = candidate;
    return true;
  }
  function getToken() { return credential; }
  return Object.freeze({provide,clear,getToken});
}
