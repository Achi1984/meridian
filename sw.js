// MERIDIAN v5.96 cache reset
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil((async()=>{
for(const k of await caches.keys())await caches.delete(k);
await self.registration.unregister();await self.clients.claim();
})()));

/* MERIDIAN v5.96 — Dual Liquidation Risk Transparency
   Display/risk-observability only. Frozen entry/SL/TP rules remain unchanged. */
window.MERIDIAN_DUAL_LIQ_RISK = {
  updatedAt: "2026-08-26T19:11:00+02:00",
  btcReference: 78028.1,
  gateTargetPct: 8.0,
  bots: [
    { id:"BTC-S30", side:"SHORT", leverage:30, liq:83746.1, bufferPct:7.33, status:"CRITICAL",
      range:[59589.2,79671.1], breakEven:72246.6, dynamicMargin:174.53, investment:52 },
    { id:"BTC-L20", side:"LONG", leverage:20, liq:70309.2, bufferPct:9.89, status:"OK",
      range:[63000,88000], breakEven:78825.2, dynamicMargin:0, investment:50 }
  ],
  gate: { status:"BLOCKED", reason:"BTC-S30", worstBufferPct:7.33 }
};

window.renderMeridianDualLiqRisk = function(){
  const d=window.MERIDIAN_DUAL_LIQ_RISK;
  const rows=d.bots.map(b=>`
    <div class="dual-liq-row ${b.status==='OK'?'dual-ok':'dual-critical'}">
      <div><b>${b.id}</b><span>${b.side} ${b.leverage}×</span></div>
      <div><small>LIQ</small><b>$${b.liq.toLocaleString('de-DE',{minimumFractionDigits:1,maximumFractionDigits:1})}</b></div>
      <div><small>PUFFER</small><b>${b.bufferPct.toLocaleString('de-DE',{minimumFractionDigits:2})}%</b></div>
      <div><small>STATUS</small><b>${b.status==='OK'?'OK':'CRITICAL'}</b></div>
    </div>`).join('');
  return `<section class="dual-liq-card">
    <div class="dual-liq-title">BTC LIQUIDATION RISK <span>DUAL</span></div>
    ${rows}
    <div class="dual-liq-gate"><span>GESAMT-RISK-GATE</span><b>BLOCKED · BTC-S30 7,33% &lt; 8,00%</b></div>
    <p>Gate basiert auf dem kritischeren tatsächlichen Liquidationspuffer. „Exposure −3%“ ist keine Kursprognose und wird nicht mehr als Hauptsignal verwendet.</p>
  </section>`;
};
