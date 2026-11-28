// Each model has its own simulated account. Show results side by side.
export function paperGroupPnl(section) {
  const summary=section.querySelector?.('summary');
  if(!summary)return ()=>{};
  const line=section.ownerDocument.createElement('small');
  line.className='paper-group-pnl';
  summary.append(line);
  return (kind,unit,rows=[],note='')=>{
    line.replaceChildren();
    if(!rows.length){line.textContent='P/L offen';return;}
    const doc=section.ownerDocument;
    const label=doc.createElement('span');
    label.textContent=kind;
    line.append(label);
    for(const [name,value] of rows){
      const item=doc.createElement('output');
      item.setAttribute('role','none');
      const valid=Number.isFinite(value);
      const cents=valid?Math.sign(value)*Math.round(Math.abs(value)*100):0;
      const amount=valid?new Intl.NumberFormat('de-AT',{minimumFractionDigits:2,maximumFractionDigits:2,signDisplay:'exceptZero'}).format(cents/100)+' '+unit:'offen';
      item.textContent=name+' '+amount;
      if(cents)item.className=cents>0?'paper-gain':'paper-loss';
      line.append(item);
    }
    if(note){const status=doc.createElement('em');status.textContent=note;line.append(status);}
  };
}

export function strategyLamp(section) {
  const summary = section.querySelector?.('summary');
  if (!summary) return () => {};
  const badge = section.ownerDocument.createElement('small');
  badge.className = 'strategy-lamp';
  summary.append(badge);
  function update(tone, label) {
    badge.setAttribute('data-paper-lamp', tone);
    badge.textContent = label;
  }
  update('unknown', 'Unbekannt');
  return update;
}
