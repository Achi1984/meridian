// Inactive temporal checks. Host metadata and clock are trusted dependencies,
// never HTTP request fields or proof of an acknowledged database reservation.
function need(ok){if(!ok)throw new Error('PUBLICATION_TIME_WINDOW_REJECTED');}
const millis=n=>Number.isSafeInteger(n)&&n>0&&n<=8640000000000000;
export function snapshotPublicationWindow(raw){
 need(raw&&Object.keys(raw).sort().join()==='reservedAtMs,responseReceivedAtMs,sendStartedAtMs');
 const window={reservedAtMs:raw.reservedAtMs,sendStartedAtMs:raw.sendStartedAtMs,
  responseReceivedAtMs:raw.responseReceivedAtMs};
 need(Object.values(window).every(millis));
 need(window.reservedAtMs<=window.sendStartedAtMs&&window.sendStartedAtMs<=window.responseReceivedAtMs);
 need(window.sendStartedAtMs-window.reservedAtMs<=900000);
 need(window.responseReceivedAtMs-window.sendStartedAtMs<=4500);
 return Object.freeze(window);
}
export function checkPublicationWindow(raw,createdAt,nowMs){
 const window=snapshotPublicationWindow(raw);
 need(millis(nowMs)&&window.responseReceivedAtMs<=nowMs
  &&nowMs-window.responseReceivedAtMs<=30000);
 need(typeof createdAt==='string'&&/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/.test(createdAt));
 const created=Date.parse(createdAt);
 need(Number.isFinite(created)&&new Date(created).toISOString().replace('.000Z','Z')===createdAt);
 // GitHub seconds precision: compare second buckets, not fictional milliseconds.
 // An older comment in the same second remains indistinguishable by time alone.
 need(created>=Math.floor(window.sendStartedAtMs/1000)*1000
  &&created<=Math.floor(window.responseReceivedAtMs/1000)*1000);
 return true;
}
