// MERIDIAN private dashboard update helpers.
// Pure validation/merge logic only; no secrets, network or database access.

const ALLOWED_SECTIONS=new Set(['portfolio','pionexRisk','pionex','exposure']);
const isObject=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
const clone=x=>JSON.parse(JSON.stringify(x));

export function validatePrivateDashboardPatch(body){
  if(!isObject(body))return {ok:false,error:'invalid_body'};
  if(!isObject(body.patch))return {ok:false,error:'patch_required'};
  const keys=Object.keys(body.patch);
  if(!keys.length)return {ok:false,error:'empty_patch'};
  const forbidden=keys.filter(k=>!ALLOWED_SECTIONS.has(k));
  if(forbidden.length)return {ok:false,error:'section_not_allowed',forbidden};
  for(const key of keys){
    if(!isObject(body.patch[key]))return {ok:false,error:'section_must_be_object',section:key};
  }
  if(body.expectedRevision!=null&&(!Number.isInteger(body.expectedRevision)||body.expectedRevision<0)){
    return {ok:false,error:'invalid_expected_revision'};
  }
  if(body.source!=null&&(typeof body.source!=='string'||body.source.length>80)){
    return {ok:false,error:'invalid_source'};
  }
  if(body.dryRun!=null&&typeof body.dryRun!=='boolean')return {ok:false,error:'invalid_dry_run'};
  return {ok:true,keys};
}

export function mergePrivateDashboard(current,body,{now=new Date().toISOString()}={}){
  const check=validatePrivateDashboardPatch(body);
  if(!check.ok)return check;
  const base=isObject(current)?clone(current):{};
  const currentRevision=Number.isInteger(base.privateRevision)?base.privateRevision:0;
  if(body.expectedRevision!=null&&body.expectedRevision!==currentRevision){
    return {ok:false,error:'revision_conflict',currentRevision};
  }
  for(const key of check.keys){
    const previous=isObject(base[key])?base[key]:{};
    base[key]={...previous,...clone(body.patch[key])};
  }
  base.privateStorageVersion=String(base.privateStorageVersion||'1');
  base.privateRevision=currentRevision+1;
  base.privateUpdatedAt=now;
  base.privateUpdateSource=String(body.source||'authenticated_manual_update');
  return {ok:true,data:base,currentRevision,nextRevision:base.privateRevision,updatedSections:check.keys};
}

export function privateDashboardPublicReceipt(result,{dryRun=false}={}){
  return {
    ok:true,
    dryRun:!!dryRun,
    revision:result.nextRevision,
    previousRevision:result.currentRevision,
    updatedSections:result.updatedSections,
    updatedAt:result.data.privateUpdatedAt
  };
}
