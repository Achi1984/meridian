/* MERIDIAN v7.65 — Trade/Grid risk presentation rules. Display-only; no execution impact. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.MERIDIAN_TRADE_RISK_V765=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const VERSION='7.65-TRADE-RISK-PRESENTATION-V1';
  const round=(v,d=2)=>Math.round((Number(v)||0)*10**d)/10**d;

  function recoveryState(buffer){
    const b=Number(buffer);
    if(!Number.isFinite(b))return {buffer:null,target:null,phase:'UNAVAILABLE',targetText:'—',gapText:'—',gate:'BLOCKED'};
    if(b<8){
      const gap=round(8-b,2);
      return {buffer:b,target:8,phase:'RECOVERY',targetText:'RECOVERY ≥8,00%',gapText:`${gap.toFixed(2).replace('.',',')} %-Pkt.`,gate:'BLOCKED'};
    }
    if(b<12){
      const gap=round(12-b,2);
      return {buffer:b,target:12,phase:'SAFE',targetText:'SAFE ≥12,00%',gapText:`${gap.toFixed(2).replace('.',',')} %-Pkt.`,gate:'BLOCKED'};
    }
    const surplus=round(b-12,2);
    return {buffer:b,target:12,phase:'SAFE',targetText:'SAFE ≥12,00%',gapText:`+${surplus.toFixed(2).replace('.',',')} %-Pkt. ÜBER`,gate:'OPEN'};
  }

  function commanderTarget(buffer){
    const s=recoveryState(buffer);
    if(s.buffer==null)return 'PUFFER PRÜFEN';
    if(s.buffer<8)return 'RECOVERY ≥8%';
    if(s.buffer<12)return 'SAFE ≥12%';
    return 'PORTFOLIO GATE';
  }

  function fibRole({side,level,current}){
    const l=Number(level),c=Number(current),s=String(side||'').toUpperCase();
    if(!(l>0)||!(c>0)||!['LONG','SHORT'].includes(s))return {role:'MODEL',tone:'amber'};
    const rel=(l-c)/c;
    if(Math.abs(rel)<=0.002)return {role:'PIVOT',tone:'amber'};
    if(s==='SHORT')return rel>0?{role:'RISK',tone:'red'}:{role:'PROFIT',tone:'green'};
    return rel>0?{role:'PROFIT',tone:'green'}:{role:'RISK',tone:'red'};
  }

  return {VERSION,recoveryState,commanderTarget,fibRole};
});
