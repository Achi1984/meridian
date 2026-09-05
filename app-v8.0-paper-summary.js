/* MERIDIAN v8.0 R1 — customer-first PAPER summary. Presentation only. */
(function(){
  'use strict';
  const VERSION='8.0';
  const BUILD='8.0-20260905-R1';
  const money=v=>{const n=Number(v);if(!Number.isFinite(n))return '—';return `${n>0?'+':n<0?'−':''}$${Math.abs(n).toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})}`};
  const fmt=(v,d=2)=>Number.isFinite(Number(v))?Number(v).toLocaleString('de-DE',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
  const num=s=>{const x=String(s||'').replace(/\s/g,'').replace(/\$/g,'').replace(/%/g,'').replace(/−/g,'-').replace(/\./g,'').replace(',','.');const m=x.match(/-?\d+(?:\.\d+)?/);return m?Number(m[0]):null};
  const text=el=>String(el?.textContent||'').trim();

  function card(root,name){return [...root.querySelectorAll('.v731-compare-card')].find(x=>text(x.querySelector('h4'))===name)||null}
  function metric(c,label){if(!c)return null;const row=[...c.querySelectorAll('.line')].find(x=>text(x.querySelector('span')).toLowerCase()===label.toLowerCase());return row?num(text(row.querySelector('b'))):null}
  function pfMetric(c){if(!c)return null;const row=[...c.querySelectorAll('.line')].find(x=>/^WR\s*\/\s*PF$/i.test(text(x.querySelector('span'))));if(!row)return null;const vals=text(row.querySelector('b')).match(/-?\d+(?:[,.]\d+)?/g)||[];return vals.length>1?num(vals[1]):null}
  function stats(root,name){const c=card(root,name);if(!c)return {name,missing:true};return {name,pnl:metric(c,'P&L'),trades:metric(c,'Trades'),dd:metric(c,'DD'),pf:pfMetric(c),open:metric(c,'Open')}}
  function verdict(s){
    if(s.missing)return {label:'NO DATA',tone:'muted'};
    if(!(s.trades>=20))return {label:'SAMPLE LOW',tone:'muted'};
    if((s.pnl||0)>0&&(s.pf||0)>=1.05&&(s.dd||99)<=10)return {label:'WATCH+',tone:'green'};
    if((s.pf||0)>=0.95&&(s.pnl||0)>-100)return {label:'WATCH',tone:'amber'};
    return {label:'REJECT',tone:'red'};
  }
  function leader(rows){return rows.filter(x=>!x.missing&&x.trades>0).sort((a,b)=>(b.pnl??-Infinity)-(a.pnl??-Infinity))[0]||null}
  function rowHtml(s){const v=verdict(s);return `<div class="v8-paper-row ${v.tone}"><div class="v8-paper-name"><b>${s.name}</b><span>${v.label}</span></div><div><small>TRADES</small><b>${s.missing?'—':s.trades??'—'}</b></div><div><small>P&L</small><b>${s.missing?'—':money(s.pnl)}</b></div><div><small>PF</small><b>${s.missing?'—':fmt(s.pf)}</b></div><div><small>DD</small><b>${s.missing?'—':fmt(s.dd,2)+'%'}</b></div></div>`}

  function transform(html){
    const active=typeof window.meridianPaperBotTab==='function'?window.meridianPaperBotTab():window.MERIDIAN_PAPER_BOT_TAB;
    if(active!=='compare')return html;
    const t=document.createElement('template');t.innerHTML=html;
    const names=['BASELINE 6.2','SHADOW V1','CHALLENGER V2','REGIME V1'];
    const rows=names.map(n=>stats(t.content,n));
    const lead=leader(rows);
    const qualified=rows.some(s=>verdict(s).label==='WATCH+');
    const original=t.innerHTML;
    return `<section id="v8-paper-summary" class="v8-customer-screen">
      <div class="v8-answer-head"><span>PAPER · BOT QUALITY</span><b>${qualified?'FORWARD CANDIDATE FOUND':'NO MODEL QUALIFIES'}</b><small>${lead?`Current leader: ${lead.name} · ${money(lead.pnl)} · PF ${fmt(lead.pf)}`:'Noch keine belastbare Bot-Stichprobe.'}</small></div>
      <div class="v8-paper-list">${rows.map(rowHtml).join('')}</div>
      <div class="v8-paper-note">Bewertung hier ist nur eine schnelle Forward-Übersicht. Promotion benötigt weiterhin OOS/Walk-Forward, ausreichende Stichprobe und explizite Freigabe.</div>
      <details class="v8-research-details"><summary>RESEARCH DETAILS</summary><div class="v8-legacy-paper">${original}</div></details>
    </section>`;
  }

  function install(){
    const cur=window.cloudPaperTradeView;if(typeof cur!=='function'||cur.__v8PaperWrapped)return;
    const raw=cur;const wrapped=function(){try{return transform(raw.apply(this,arguments))}catch(e){console.warn('MERIDIAN v8 PAPER',e);return raw.apply(this,arguments)}};
    wrapped.__v8PaperWrapped=true;
    wrapped.__v732Wrapped=true;wrapped.__v733Wrapped=true;wrapped.__v741Wrapped=true;
    window.cloudPaperTradeView=wrapped;try{cloudPaperTradeView=wrapped}catch(_e){}
  }
  function css(){if(document.getElementById('v8-paper-css'))return;const s=document.createElement('style');s.id='v8-paper-css';s.textContent=`
    #v8-paper-summary{max-width:980px;margin:14px auto 90px;padding:0 14px;color:#eaf2f8}
    .v8-answer-head{border:1px solid #1b4058;background:#06131e;border-radius:18px;padding:18px;margin-bottom:12px}
    .v8-answer-head>span{display:block;color:#55c8ff;font-size:9px;letter-spacing:.13em;font-weight:800}
    .v8-answer-head>b{display:block;margin-top:7px;font-size:24px;line-height:1.05}
    .v8-answer-head>small{display:block;margin-top:8px;color:#8ea0b2;font-size:11px}
    .v8-paper-list{display:grid;gap:8px}
    .v8-paper-row{display:grid;grid-template-columns:minmax(150px,1.8fr) repeat(4,minmax(70px,1fr));gap:8px;align-items:center;border:1px solid #17354f;background:#07121c;border-radius:14px;padding:12px}
    .v8-paper-row.red{border-left:3px solid #ff5d62}.v8-paper-row.amber{border-left:3px solid #e8b24a}.v8-paper-row.green{border-left:3px solid #4bc27d}.v8-paper-row.muted{border-left:3px solid #526474}
    .v8-paper-name b{font-size:12px}.v8-paper-name span{display:block;margin-top:4px;font-size:8px;letter-spacing:.08em;color:#8294a8}
    .v8-paper-row div:not(.v8-paper-name) small{display:block;color:#71859a;font-size:7px;letter-spacing:.08em}.v8-paper-row div:not(.v8-paper-name) b{display:block;margin-top:3px;font-size:11px}
    .v8-paper-note{margin:10px 2px;color:#7f91a6;font-size:9px;line-height:1.45}
    .v8-research-details{margin-top:14px;border:1px solid #17354f;border-radius:14px;background:#050d14;overflow:hidden}.v8-research-details>summary{cursor:pointer;padding:14px;color:#55c8ff;font-size:10px;font-weight:800;letter-spacing:.1em}.v8-legacy-paper{padding:0 8px 12px}
    @media(max-width:650px){#v8-paper-summary{padding:0 10px}.v8-answer-head>b{font-size:20px}.v8-paper-row{grid-template-columns:1.55fr repeat(4,.72fr);padding:10px 8px;gap:5px}.v8-paper-name b{font-size:10px}.v8-paper-row div:not(.v8-paper-name) b{font-size:9px}.v8-paper-row div:not(.v8-paper-name) small{font-size:6px}}
  `;document.head.appendChild(s)}
  function stamp(){window.MERIDIAN_RELEASE_VERSION=VERSION;window.MERIDIAN_UI_VERSION=VERSION;window.MERIDIAN_RELEASE_BUILD=BUILD;window.__MERIDIAN_BUILD__=BUILD;const badge=document.getElementById('versionBadge');if(badge)badge.textContent='v8.0 · PREVIEW'}
  function start(){stamp();css();install();try{if(document.body?.dataset?.view==='paper'&&typeof renderOne==='function')renderOne('paper')}catch(_e){}}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
  addEventListener('pageshow',start);setInterval(install,1200);
})();