import {DEPOT_WINDOWS} from './depot-history-model.js?v=B16-M11-FIX3';
const money=x=>new Intl.NumberFormat('de-DE',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(x);
export function createDepotHistoryView(root,{onRange}={}){
  const d=root.ownerDocument,el=(tag,text)=>{const n=d.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
  root.className='depot-history';root.append(el('h3','Depotverlauf'));
  const controls=el('div'),output=el('div'),buttons=[];
  controls.className='depot-range';controls.setAttribute('role','group');controls.setAttribute('aria-label','Zeitraum des Depotverlaufs');
  for(const [key,label] of [['1h','1h'],['1d','1 Tag'],['1w','1 Woche']]){
    const b=el('button',label);b.type='button';b.dataset.range=key;
    b.addEventListener('click',()=>onRange(key));buttons.push(b);controls.append(b);
  }
  output.setAttribute('aria-live','polite');root.append(controls,output);
  function render(model,range='1d'){
    for(const b of buttons)b.setAttribute('aria-pressed',String(b.dataset.range===range));
    output.replaceChildren();
    if(!model||model.status!=='ready'){
      output.append(el('p',model?.status==='empty'?'Für diesen Zeitraum sind noch keine vollständigen Bewertungen gespeichert.':'Verlauf nicht verfügbar. Depot manuell aktualisieren.'));return;
    }
    const vals=model.points.map(p=>p.totalUsd),low=Math.min(...vals),high=Math.max(...vals),span=high-low||Math.max(1,high*.01),base=high===low?low-span/2:low;
    const ns='http://www.w3.org/2000/svg',svg=d.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 320 174');svg.setAttribute('role','img');
    svg.setAttribute('aria-label',`Gespeicherter Depotwert, ${model.points.length} Messpunkte. Minimum ${money(low)}, Maximum ${money(high)}. Keine Renditeberechnung.`);
    const coord=p=>[12+(p.timestamp-model.start)/(model.end-model.start)*296,132-(p.totalUsd-base)/span*112];
    for(const segment of model.segments){
      const line=d.createElementNS(ns,'polyline');line.setAttribute('points',segment.map(p=>coord(p).join(',')).join(' '));line.setAttribute('fill','none');line.setAttribute('stroke','currentColor');line.setAttribute('stroke-width','2');svg.append(line);
      for(const p of segment){const c=d.createElementNS(ns,'circle'),[x,y]=coord(p);c.setAttribute('cx',x);c.setAttribute('cy',y);c.setAttribute('r','2');c.setAttribute('fill','currentColor');svg.append(c);}
    }
    const axis=d.createElementNS(ns,'line');
    for(const [key,value] of Object.entries({x1:12,x2:308,y1:142,y2:142,stroke:'currentColor','stroke-opacity':'.35'}))axis.setAttribute(key,value);
    svg.append(axis);
    for(const [time,x,anchor] of [[model.start,12,'start'],[(model.start+model.end)/2,160,'middle'],[model.end,308,'end']]){
      const tick=d.createElementNS(ns,'text');
      tick.setAttribute('x',x);tick.setAttribute('y',162);tick.setAttribute('text-anchor',anchor);tick.setAttribute('fill','currentColor');tick.setAttribute('font-size','10');
      tick.textContent=new Date(time).toLocaleString('de-AT',range==='1w'?{day:'2-digit',month:'2-digit'}:{hour:'2-digit',minute:'2-digit'});svg.append(tick);
    }
    output.append(el('p','Zeitachse: '+new Date(model.start).toLocaleString('de-AT')+' bis '+new Date(model.end).toLocaleString('de-AT')+' (lokale Zeit). Vorhandene Messungen: '+new Date(model.points[0].timestamp).toLocaleString('de-AT')+' bis '+new Date(model.points.at(-1).timestamp).toLocaleString('de-AT')+'.'));
    output.append(svg,el('p',`${model.points.length} Messpunkte · Min. ${money(low)} · Max. ${money(high)}`));
    const first=model.points[0],last=model.points.at(-1);
    output.append(el('p',`Erster Punkt: ${new Date(first.timestamp).toLocaleString('de-AT')} · ${money(first.totalUsd)}`),el('p',`Letzter Punkt: ${new Date(last.timestamp).toLocaleString('de-AT')} · ${money(last.totalUsd)}`));
    output.append(el('p',model.gaps?'Datenlücken: unterbrochene oder ausgeschlossene Messungen werden nicht verbunden.':'Gespeicherte Bewertungen; vor dem ersten und nach dem letzten Punkt bleibt die Kurve offen.'));
    output.append(el('p','Ein- und Auszahlungen können den Verlauf verändern. Keine Renditeberechnung.'));
  }
  return {render};
}
