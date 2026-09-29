import crypto from 'node:crypto';

const HASH_RE=/^[a-f0-9]{64}$/;
const MAX_BOTS=100;

function timingSafeToken(token,expectedHash){
  const supplied=String(token||'').trim();
  const expected=String(expectedHash||'').trim().toLowerCase();
  if(!supplied||!HASH_RE.test(expected))return false;
  const actual=crypto.createHash('sha256').update(supplied).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(actual,'hex'),Buffer.from(expected,'hex'));
}

function safeString(v,max=120){
  const s=String(v??'').trim();
  return s?s.slice(0,max):null;
}
function finite(v){
  const n=Number(v);
  return Number.isFinite(n)?n:null;
}
function sanitizeBot(bot={}){
  return {
    botRef:safeString(bot.botRef,64),
    symbol:safeString(bot.symbol,24)?.toUpperCase()||null,
    side:safeString(bot.side,12)?.toUpperCase()||null,
    leverage:finite(bot.leverage),
    limits:{
      lower:finite(bot?.limits?.lower),
      upper:finite(bot?.limits?.upper),
      liquidationPrice:finite(bot?.limits?.liquidationPrice),
      takeProfit:finite(bot?.limits?.takeProfit),
      stopLoss:finite(bot?.limits?.stopLoss)
    },
    grid:{grids:finite(bot?.grid?.grids)},
    position:{
      size:finite(bot?.position?.size),
      positionOpenPrice:finite(bot?.position?.positionOpenPrice),
      breakEvenPrice:finite(bot?.position?.breakEvenPrice),
      breakEvenSource:safeString(bot?.position?.breakEvenSource,80)
    },
    margin:{
      extraMargin:finite(bot?.margin?.extraMargin),
      riskStatus:safeString(bot?.margin?.riskStatus,40),
      marginStatus:safeString(bot?.margin?.marginStatus,40)
    },
    investment:{
      usd:finite(bot?.investment?.usd),
      currency:safeString(bot?.investment?.currency,24),
      quoteAmount:finite(bot?.investment?.quoteAmount)
    },
    pnl:{
      usd:finite(bot?.pnl?.usd),
      totalProfitPct:finite(bot?.pnl?.totalProfitPct)
    },
    source:safeString(bot.source,80)
  };
}
function sanitizeSnapshot(x={}){
  const bots=Array.isArray(x.bots)?x.bots.slice(0,MAX_BOTS).map(sanitizeBot):[];
  return {
    schemaVersion:safeString(x.schemaVersion,80),
    readOnly:x.readOnly===true,
    executionImpact:x.executionImpact===false?false:null,
    generatedAt:safeString(x.generatedAt,80),
    source:safeString(x.source,80),
    sourceSnapshotAt:safeString(x.sourceSnapshotAt,80),
    sourceAgeMs:finite(x.sourceAgeMs),
    freshnessLimitMs:finite(x.freshnessLimitMs),
    detailsComplete:x.detailsComplete===true,
    sourceStatusOk:x.sourceStatusOk===true,
    fresh:x.fresh===true,
    usableForOverwrite:x.usableForOverwrite===true,
    overwriteRule:safeString(x.overwriteRule,80),
    botCount:bots.length,
    snapshotFingerprint:safeString(x.snapshotFingerprint,128),
    bots,
    fieldSemantics:{
      positionOpenPrice:safeString(x?.fieldSemantics?.positionOpenPrice,120),
      breakEvenPrice:safeString(x?.fieldSemantics?.breakEvenPrice,120),
      screenshotBreakEven:safeString(x?.fieldSemantics?.screenshotBreakEven,120)
    }
  };
}

function json(res,status,body){
  res.status(status);
  res.setHeader('content-type','application/json; charset=utf-8');
  res.setHeader('cache-control','no-store, max-age=0');
  res.setHeader('pragma','no-cache');
  res.setHeader('x-robots-tag','noindex, nofollow, noarchive');
  res.setHeader('referrer-policy','no-referrer');
  return res.send(JSON.stringify(body));
}

export default async function handler(req,res){
  if(req.method!=='GET')return json(res,405,{error:'method_not_allowed'});
  if(String(req.query?.health||'')==='1'){
    return json(res,200,{
      ok:true,
      service:'meridian-asset-watch-relay',
      upstreamConfigured:!!String(process.env.MERIDIAN_ASSET_WATCH_UPSTREAM_URL||'').trim(),
      authConfigured:HASH_RE.test(String(process.env.MERIDIAN_RELAY_TOKEN_SHA256||'').trim().toLowerCase())
    });
  }

  if(!timingSafeToken(req.query?.share,process.env.MERIDIAN_RELAY_TOKEN_SHA256)){
    return json(res,401,{error:'relay_token_required'});
  }

  const upstream=String(process.env.MERIDIAN_ASSET_WATCH_UPSTREAM_URL||'').trim();
  if(!/^https:\/\//i.test(upstream)){
    return json(res,503,{error:'upstream_not_configured'});
  }

  let response;
  try{
    response=await fetch(upstream,{
      method:'GET',
      headers:{accept:'application/json','user-agent':'MERIDIAN-Asset-Watch-Relay/1.0'},
      cache:'no-store',
      signal:AbortSignal.timeout(10000)
    });
  }catch{
    return json(res,502,{error:'upstream_unreachable'});
  }

  if(!response.ok){
    return json(res,502,{error:'upstream_http_error',status:response.status});
  }

  let payload;
  try{payload=await response.json()}
  catch{return json(res,502,{error:'upstream_invalid_json'})}

  const out=sanitizeSnapshot(payload);
  if(out.schemaVersion!=='MERIDIAN-ASSET-WATCH-BRIDGE-V1'||out.readOnly!==true||out.executionImpact!==false){
    return json(res,502,{error:'upstream_schema_rejected'});
  }

  return json(res,200,out);
}

export {timingSafeToken,sanitizeSnapshot};
