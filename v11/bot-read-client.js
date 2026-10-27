import {buildBotReadModel} from './bot-read-model.js?v=B14';

const ENDPOINT = 'https://p01--achi-meridian--ttvk44grdlp7.code.run/api/private/asset-watch';
// Exact canonical gateway links only. Never use a supplied URL as a fetch target.
export function parseBotReadCredential(value) {
  if (typeof value !== 'string' || value.length > 4096 || /[\x00-\x1f\x7f]/.test(value)) return null;
  const candidate = value.trim();
  if (!candidate) return null;
  const prefix = ENDPOINT + '?share=';
  if (candidate.startsWith(prefix)) {
    const share = candidate.slice(prefix.length);
    // Gateway issues 32 random bytes encoded as 43 base64url characters.
    if (!/^[A-Za-z0-9_-]{43}$/.test(share)) return null;
    return {kind:'share', value:share};
  }
  // Malformed or foreign links must never be sent as bearer credentials.
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(candidate) || /^(?:[/\\]{2}|www\.)/i.test(candidate)) return null;
  return {kind:'bearer', value:candidate};
}

const MAX_BYTES = 256 * 1024;
const TIMEOUT_MS = 10000;

async function readBounded(response, signal) {
  if (!response.ok) throw new Error('unavailable');
  const length = response.headers?.get('content-length');
  if (length !== null && length !== undefined && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES))
    throw new Error('unavailable');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('unavailable');
  const decoder = new TextDecoder('utf-8', {fatal:true});
  let size = 0, text = '';
  const cancel = () => { try { Promise.resolve(reader.cancel()).catch(() => {}); } catch {} };
  signal.addEventListener('abort', cancel, {once:true});
  try {
    while (true) {
      if (signal.aborted) throw new Error('unavailable');
      const {done,value} = await reader.read();
      if (signal.aborted) throw new Error('unavailable');
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error('unavailable');
      text += decoder.decode(value, {stream:true});
    }
    text += decoder.decode();
    return JSON.parse(text);
  } finally {
    signal.removeEventListener('abort', cancel);
    cancel();
    try { reader.releaseLock(); } catch {}
  }
}

// Inactive until explicitly called. No token storage, engine import or account activation.
export function createBotReadClient({getToken, onChange = () => {}, fetchImpl = globalThis.fetch,
  now = Date.now, schedule = setTimeout, cancelSchedule = clearTimeout} = {}) {
  let generation = 0, pending = null, disposed = false, snapshot = null, snapshotToken = null,
    pendingToken = null, readIdentity = null;
  const token = () => {
    try {
      const value = getToken();
      return parseBotReadCredential(value) ? value.trim() : null;
    } catch { return null; }
  };
  const emit = (status, model = null, identity = null) => {
    if (disposed) return;
    const state={status,model};
    if(status==='fresh'&&identity!==null)state.readIdentity=identity;
    try { onChange(state); } catch {}
  };
  const stop = () => {
    generation++;
    if (pending) { pending.abort(); pending = null; }
    pendingToken = null;
  };
  const wipe = () => { snapshot = null; snapshotToken = null; readIdentity = null; };
  const project = () => {
    const model = buildBotReadModel(snapshot, {now:now()});
    const status=model.status === 'FRESH_SNAPSHOT' ? 'fresh' : model.status === 'STALE' ? 'stale' : 'unavailable';
    if(status==='fresh')emit(status,model,readIdentity);
    else {wipe();emit(status,model);}
  };
  function lock() { stop(); wipe(); emit('locked'); }
  async function refresh() {
    if (disposed) return;
    stop(); wipe();
    const credential = token();
    if (!credential) { emit('locked'); return; }
    const id = generation, controller = new AbortController();
    pending = controller;
    pendingToken = credential;
    let timer, onAbort;
    const aborted = new Promise((_, reject) => {
      onAbort = () => reject(new Error('unavailable'));
      controller.signal.addEventListener('abort', onAbort, {once:true});
    });
    aborted.catch(() => {});
    try {
      timer = schedule(() => controller.abort(), TIMEOUT_MS);
      emit('loading');
      if (id !== generation || disposed) return;
      const operation = async () => {
        const parsed = parseBotReadCredential(credential);
        const endpoint = parsed.kind === 'share' ? ENDPOINT + '?share=' + encodeURIComponent(parsed.value) : ENDPOINT;
        const headers = {accept:'application/json'};
        if (parsed.kind === 'bearer') headers.authorization = 'Bearer ' + parsed.value;
        const response = await fetchImpl(endpoint, {method:'GET', redirect:'error', credentials:'omit',
          cache:'no-store', referrerPolicy:'no-referrer', signal:controller.signal,
          headers});
        if (controller.signal.aborted) throw new Error('unavailable');
        if (response.status === 401 || response.status === 403) return {locked:true};
        return {snapshot:await readBounded(response, controller.signal)};
      };
      const result = await Promise.race([operation(), aborted]);
      if (id !== generation || disposed) return;
      if (token() !== credential || result.locked) { lock(); return; }
      snapshot = result.snapshot; snapshotToken = credential; readIdentity=Symbol('bot-read');
      project();
    } catch {
      if (id === generation && !disposed) {
        wipe(); emit(token() === credential ? 'unavailable' : 'locked');
      }
    } finally {
      if (timer !== undefined) cancelSchedule(timer);
      controller.signal.removeEventListener('abort', onAbort);
      if (pending === controller) { pending = null; pendingToken = null; }
    }
  }
  function revalidate() {
    if (disposed) return;
    const credential = token();
    if (!credential || (snapshotToken && credential !== snapshotToken) ||
        (pendingToken && credential !== pendingToken)) { lock(); return; }
    if (snapshot) {
      try { project(); } catch { wipe(); emit('unavailable'); }
    }
  }
  function dispose() {
    if (disposed) return;
    stop(); wipe(); disposed = true;
    try { onChange({status:'locked', model:null}); } catch {}
  }
  return {refresh, lock, revalidate, dispose};
}
