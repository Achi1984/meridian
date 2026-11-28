import {okxStatus} from './paper-status.js?v=B20-M11-FIX6';

const source='https://api.github.com/repos/Achi1984/meridian/contents/';
const amount=new Intl.NumberFormat('de-AT',{maximumFractionDigits:6,signDisplay:'exceptZero'});
const localTime=new Intl.DateTimeFormat('de-AT',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Vienna'});
const phases={planned:'Geplant',running:'Läuft',final:'Beendet'};

function number(value){
  if((typeof value!=='number' && typeof value!=='string') || String(value).trim()==='' || !Number.isFinite(Number(value)))throw Error('number');
  return Number(value);
}
function count(value){
  if(!Number.isSafeInteger(value)||value<0)throw Error('count');
  return value;
}
function row(name,pnl,currency,detail){
  const div=document.createElement('div');
  div.style.cssText='display:flex;flex-wrap:wrap;justify-content:space-between;gap:1px 8px;padding:6px 0;border-bottom:1px solid var(--line,#334155)';
  const title=document.createElement('strong');
  title.textContent=name;
  const value=document.createElement('strong');
  value.textContent='PnL '+amount.format(pnl)+' '+currency;
  value.className=pnl>0?'paper-gain':pnl<0?'paper-loss':'';
  const note=document.createElement('small');
  note.style.flexBasis='100%';
  note.textContent=detail;
  div.append(title,value,note);
  return div;
}
function demoRows(report){
  const sessions=Object.values(report.sessions);
  return ['LONG','SHORT'].map(side=>{
    const trades=sessions.filter(t=>t.signal===side);
    const closed=trades.filter(t=>t.state==='closed'&&t.demoFilled);
    const pendingFunding=closed.some(t=>t.demoNetUSDC==null);
    const pnl=closed.reduce((s,t)=>s+number(pendingFunding?t.demoAfterFees:t.demoNetUSDC),0);
    const open=trades.filter(t=>t.state!=='closed'&&t.demoFilled).length;
    const pending=trades.some(t=>t.state==='reserved'||t.state==='exit_due');
    const completed=trades.filter(t=>t.state==='closed');
    const modelResult=field=>amount.format(completed.reduce((sum,t)=>sum+number(t[field]),0));
    return row(side==='LONG'?'Long':'Short',pnl,'USDC',
      (pending?'Orderabgleich · ':'')+open+' offen · '+closed.length+' geschlossen'+(pendingFunding?' · vor Funding':'')+
      (completed.length?' · Paper Basis '+modelResult('modelBase')+' / Filter '+modelResult('modelFiltered')+' USDC':''));
  });
}
const money=new Intl.NumberFormat('de-AT',{minimumFractionDigits:2,maximumFractionDigits:2});
const signedMoney=new Intl.NumberFormat('de-AT',{minimumFractionDigits:2,maximumFractionDigits:2,signDisplay:'exceptZero'});
function compoundRows(report,previous){
  return ['Long','Short'].map(side=>{
    const bot=report.bots[side], a=bot.compound, fixed=bot.fixed;
    const details=document.createElement('details');
    details.className='compound-bot';
    details.dataset.side=side;
    details.open=Boolean(previous.querySelector('[data-side="'+side+'"][open]'));
    const summary=document.createElement('summary');
    const title=document.createElement('strong');
    title.className='compound-direction';
    title.textContent=side+'-Compounder';
    const state=document.createElement('small');
    state.textContent=bot.decision?.reason || (bot.position?'Position offen':
      Number.isFinite(report.start) && report.cursor===report.start?'Erste Auswertung nach '+localTime.format(report.start+3600000)+' Wien':'Wartet');
    const pnl=document.createElement('strong');
    const net=number(a.equity)-1000;
    pnl.textContent='PnL '+signedMoney.format(net)+' USDT';
    pnl.className=net>0?'paper-gain':net<0?'paper-loss':'';
    const head=document.createElement('div');
    head.className='compound-head';
    head.append(title,state,pnl);
    const metrics=document.createElement('div');
    metrics.className='compound-metrics';
    const balance=document.createElement('b'), risk=document.createElement('b');
    balance.textContent='Konto '+money.format(number(a.equity))+' USDT';
    risk.textContent='Risiko '+money.format(number(a.balance)*0.005)+' USDT';
    metrics.append(balance,risk);
    summary.append(head,metrics);
    const detail=document.createElement('p');
    const percent=n=>number(n*100).toLocaleString('de-AT',{maximumFractionDigits:2})+' %';
    detail.textContent='Max. Drawdown '+percent(number(a.drawdown))+' · '+count(a.closed)+' Trades geschlossen';
    const comparison=document.createElement('p');
    comparison.textContent='Vergleich mit 5 USDT Fixrisiko · PnL '+signedMoney.format(number(fixed.equity)-1000)+
      ' USDT · max. Drawdown '+percent(number(fixed.drawdown));
    details.append(summary);
    if(Number.isFinite(bot.decision?.closeMs)){
      const stamp=document.createElement('p');
      stamp.textContent='Ausgewerteter Kerzenschluss · '+localTime.format(bot.decision.closeMs)+' Wien';
      details.append(stamp);
    }
    const difference=document.createElement('p');
    difference.textContent='Kontowert gegenüber Fixrisiko · '+signedMoney.format(number(a.equity)-number(fixed.equity))+' USDT';
    details.append(detail,comparison,difference);
    if(a.closed>0){
      const costs=document.createElement('p');
      const trades=bot.trades;
      if(Array.isArray(trades)&&trades.length===a.closed&&trades.every(t=>
        Number.isFinite(t.fees?.compound)&&Number.isFinite(t.funding?.compound))){
        const fees=trades.reduce((sum,t)=>sum+t.fees.compound,0);
        const funding=trades.reduce((sum,t)=>sum+t.funding.compound,0);
        costs.textContent='Geschlossene Compound-Trades · Gebühren '+amount.format(fees)+' USDT · modelliertes Funding '+amount.format(funding)+' USDT';
      }else costs.textContent='Kostenaufschlüsselung für geschlossene Trades unvollständig';
      details.append(costs);
    }
    return details;
  });
}
function gridRows(report){
  const rows= [['fixed','Fest'],['adaptive','Adaptiv'],['model','KI-Filter']].map(([key,name])=>{
    const a=report.accounts[key];
    return row(name,number(a.equity)-1000,'USDT',count(a.fills)+' Ausführungen'+
      (Number.isFinite(a.vsHold)?' · '+amount.format(a.vsHold)+' USDT ggü. Halten':'')+
      (Number.isFinite(a.drawdown)?' · Max. Drawdown '+money.format(a.drawdown)+' USDT':'')+
      (Number.isFinite(a.fees)?' · Gebühren '+money.format(a.fees)+' USDT':''));
  });
  if(Number.isFinite(report.holdEquity)){
    const reference=document.createElement('p');
    reference.textContent='Halten ab Teststart · 500 USDT in BTC und 500 USDT in Cash · Kontowert '+money.format(report.holdEquity)+' USDT';
    rows.push(reference);
  }
  return rows;
}
function shortRows(report){
  return [['historyFilter','Mit Historienfilter'],['control','Ohne Historienfilter']].map(([key,name])=>{
    const a=report[key];
    return row(name,number(a.equity)-1000,'USDT',count(a.open)+' offen · '+count(a.closed)+' geschlossen');
  });
}

export function createOkxOverview(fibonacci){
  const root=document.createElement('section');
  root.id='okx-overview';
  root.setAttribute('aria-label','OKX-Tradingübersicht');
  const heading=document.createElement('h2');
  heading.textContent='OKX-Tradingübersicht';
  root.append(heading,fibonacci);
  const groups=[
    ['BTC Long/Short · Demo','okx-filter-demo',demoRows,90],
    ['BTC-Compounder · Futures-Paper','btc-compound-paper',compoundRows,90],
    ['BTC-Grid · Paper','btc-grid-paper',gridRows,45],
    ['Short nach Fehlausbruch · Paper','okx-rejection-paper',shortRows,360]
  ];
  const updates=groups.map(([title,file,render,maxMinutes])=>{
    const section=document.createElement('section');
    section.className='card';
    const name=document.createElement('h3');
    name.textContent=title;
    const status=document.createElement('small');
    status.textContent='Daten werden geladen …';
    const rows=document.createElement('div');
    section.append(name,status,rows);
    root.append(section);
    return async()=>{
      try{
        const response=await fetch(source+file+'.json?ref=paper-dashboard-data',{
          credentials:'omit',cache:'no-store',headers:{Accept:'application/vnd.github.raw+json'},signal:AbortSignal.timeout(10000)
        });
        if(!response.ok)throw Error('response');
        const report=await response.json();
        const time=typeof report.asOf==='number'?report.asOf:Date.parse(report.asOf);
        if(!Number.isFinite(time)||time>Date.now()+60000)throw Error('timestamp');
        let label,light;
        if(render===demoRows){
          const [tone,state,detail]=okxStatus(report);
          light={on:'🟢',warn:'🟡',off:'🔴',unknown:'⚪'}[tone]||'⚪';
          label=state==='Aktiv'?detail:state;
        }else{
          label=phases[report.phase];
          if(!label)throw Error('phase');
          light=report.phase==='running'?'🟢':report.phase==='final'?'🔴':'🟡';
          if(report.phase!=='final' && Date.now()-time>maxMinutes*60000){light='🟡';label='Stand veraltet';}
        }
        const focused=rows.contains(document.activeElement)?document.activeElement.closest('.compound-bot')?.dataset.side:null;
        rows.replaceChildren(...render(report,rows));
        if(focused)rows.querySelector('[data-side="'+focused+'"] > summary')?.focus({preventScroll:true});
        let coverage='';
        if(render===gridRows && Number.isSafeInteger(report.bars)&&report.bars>=0)
          coverage=' · '+report.bars+' ausgewertete 15-min-Kerzen';
        if(render===compoundRows && Number.isSafeInteger(report.cursor)&&Number.isSafeInteger(report.start)){
          const hours=(report.cursor-report.start)/3600000;
          if(Number.isSafeInteger(hours)&&hours>=0)coverage=' · '+hours+' ausgewertete Stundenkerze'+(hours===1?'':'n');
        }
        status.textContent=light+' '+label+' · '+localTime.format(time)+' Wien'+coverage;
      }catch{
        status.textContent='⚪ Daten derzeit nicht verfügbar';
        rows.replaceChildren();
      }
    };
  });
  let busy=false;
  async function refresh(){
    if(busy||document.hidden||!root.getClientRects().length)return;
    busy=true;
    try{await Promise.all(updates.map(update=>update()));}finally{busy=false;}
  }
  new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))void refresh();}).observe(root);
  setInterval(refresh,60000);
  return root;
}
