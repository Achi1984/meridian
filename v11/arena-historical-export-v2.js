export const MAX_HISTORICAL_EXPORT_V2_BYTES = 8 * 1024 * 1024;
export const MAX_HISTORICAL_RESULT_V2_BYTES = 1024 * 1024;
export const HISTORICAL_EXPORT_V2_SCHEMA = 'MERIDIAN_B1_HISTORICAL_RESULT_EXPORT_V2';
export const HISTORICAL_EXPORT_V2_PURPOSE = 'B1_HISTORICAL_RESULT_REVIEW_NOT_AUTHENTICITY_RECEIPT';

const HASH = /^[a-f0-9]{64}$/;
const ENVELOPE_KEYS = ['schema','purpose','provenance','job','summary','payloadSha256'];
const PROVENANCE_KEYS = [
  'source','assertionStatus','sourceAuthenticity','assertedDatasetClass','generatedFixture'
];
const JOB_KEYS = [
  'trialId','trialKey','state','attempts','owner','fence','profile','protocolSha256','sourceSha256',
  'dataSha256','manifestSha256','pathIds','computationPathIds','timestamps','paths','controls',
  'controlBindings','result','resultSha256','summarySha256','reason','unresolved',
  'executionAuthorized','promotionAuthorized','profitabilityInferred'
];
const RESULT_KEYS = [
  'attemptedPaths','authority','budget','completedPaths','computedPaths','controlRealization','evidence',
  'executionId','failure','identity','implementationId','implementationSha256','plannedPaths',
  'protocolId','protocolReview','protocolSha256','schema','screen','status','controlDefinitions','paths'
];
const SCREEN_CHECKS = [
  'primaryDiagnosticNetPositive','primaryDiagnosticDrawdownAtMost25Percent',
  'primaryReturnAtLeastBothFrozenControls','primaryDrawdownAtMostBothFrozenControls',
  'relativeDrawdownReductionAtLeast20Percent','primaryNetPositiveAt30bpNonDelayed',
  'primaryNetPositiveAt30bpPlusDelay','atLeastThreeOfFourNeighboursPositiveAt15bp',
  'atLeastThreeOfFourNeighboursPositiveAt30bpNonDelayed'
];
const SCREEN_KEYS = [
  'status','interpretation','comparisonSegment','neighbourStressScenario','checks',
  'relativeDrawdownReduction','neighbourPositiveCounts','stopPolicy','tradeCRV'
];
const AUTHORITY_KEYS = [
  'researchOnly','executionAuthorized','strategyPnlAuthorized','discoveryAuthorized',
  'validationAuthorized','holdoutAuthorized','paperAuthorized','liveAuthorized'
];
const ASSETS = ['XBTUSD','ETHUSD','SOLUSD','XRPUSD','LINKUSD','AVAXUSD','SUIUSD'];
const EVIDENCE_KEYS = [
  'syntheticFixture','priceSource','costModel','executionEvidence','sourceAuthenticity',
  'survivorship','historyLabel','candidateInterpretation','diagnosticRescaling','holdoutClaim',
  'trialLedger','stoppedPolicy','crv'
];
const CONTROL_REALIZATION_KEYS = [
  'pathId','variantId','scenarioId','segmentId','status','frozenTargetExposure',
  'meanRealizedExposure','meanTargetRealizedMismatch','meanAbsoluteTargetMismatch',
  'maxAbsoluteTargetMismatch','diagnosticRescaling'
];
const PROTOCOL_REVIEW_KEYS = [
  'r1RequestId','r1ResponseComment','r1Verdict','r2RequestId','r2ResponseComment',
  'r2Verdict','r2Scope','r3Review'
];
const PATH_KEYS = [
  'attempts','cancelledInstructionCount','cancelledInstructions','computed','dailyHeldTarget',
  'dailyReturnCount','dailyReturnSd','dailyReturns','diagnosticRescaling','endEquity','fillCostCount',
  'fillCosts','kind','maxAbsoluteTargetMismatch','maxConcentration','maxDrawdownDuration',
  'meanAbsoluteTargetMismatch','meanHeldTarget','meanRealizedExposure','meanTargetRealizedMismatch',
  'netReturn','observationClass','pathId','quarterlyReturns','rows','sampledDrawdown','scenarioId',
  'segmentId','startEquity','status','totalCosts','tradeCRV','turnoverNotional',
  'turnoverOnInitialEquity','variantId'
];
const FILL_COST_KEYS = [
  'date','kind','turnover','cost','cumulativeCost','equityAfterFees','cashAfterFees','conservationResidual'
];
const CANCEL_KEYS = ['decisionIndex','fillIndex','target','decisionTimestamp','reason'];
const NOT_RUN_KEYS = [
  'pathId','kind','variantId','scenarioId','segmentId','status','attempts','computed','failure'
];
const CONTROL_KEYS = [
  'status','meanExposure','riskExposure','primaryDevelopmentSd','fullBasketDevelopmentSd','calibration'
];
const INSUFFICIENT_CONTROL_KEYS = ['ok','status','reason','primarySd','benchmarkSd'];
const COMPLETED_SCREEN_INSUFFICIENT = {
  status:'INSUFFICIENT_EVIDENCE',
  checks:{fullBasketDrawdownDenominator:false},
  relativeDrawdownReduction:null
};
const ERROR = () => ({status:'INVALID',message:'Historischer V2-Export abgelehnt · Format, Bindung oder Prüfsumme widersprüchlich.'});

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value,keys) => record(value) && Object.keys(value).length === keys.length &&
  keys.every(key=>Object.hasOwn(value,key));
const hash = value => typeof value === 'string' && HASH.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0 && !Object.is(value,-0);
const scalarString = value => {
  for(let index=0;index<value.length;index++){
    const code=value.charCodeAt(index);
    if(code>=0xd800&&code<=0xdbff){
      const next=value.charCodeAt(index+1);
      if(!(next>=0xdc00&&next<=0xdfff))return false;
      index++;
    }else if(code>=0xdc00&&code<=0xdfff)return false;
  }
  return true;
};
const utf8 = value => new TextEncoder().encode(value);
const stamp = value => value === null || typeof value === 'string' && value.length <= 64 &&
  /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value.slice(0,10)).toISOString().slice(0,10) === value.slice(0,10);

function parseStrictJson(text,{maxBytes,maxDepth=12,maxNodes=100_000,stringLimit=4096,layer='nested'}={}){
  if(typeof text!=='string'||!scalarString(text)||utf8(text).length>maxBytes||text.charCodeAt(0)===0xfeff)return null;
  let index=0,nodes=0;
  const whitespace=()=>{while(text[index]===' '||text[index]==='\t'||text[index]==='\r'||text[index]==='\n')index++;};
  const string=limit=>{
    const start=index;
    index++;
    while(index<text.length){
      const char=text[index++];
      if(char==='"'){
        let value;
        try{value=JSON.parse(text.slice(start,index));}catch{return null;}
        return scalarString(value)&&utf8(value).length<=limit?value:null;
      }
      if(char==='\\'){
        if(index>=text.length)return null;
        index++;
      }
    }
    return null;
  };
  const value=(depth,path)=>{
    whitespace();
    if(depth>maxDepth||++nodes>maxNodes)return {ok:false};
    const char=text[index];
    if(char==='"'){
      const limit=layer==='outer'&&path[0]==='job'&&path[1]==='result'
        ?MAX_HISTORICAL_RESULT_V2_BYTES
        :layer==='outer'&&path[0]==='job'&&path[1]==='controls'?8192:
          layer==='outer'&&path[0]==='summary'?MAX_HISTORICAL_RESULT_V2_BYTES:
            layer==='export-input'&&path[0]==='observation'&&path[1]==='result'
              ?MAX_HISTORICAL_RESULT_V2_BYTES:
                layer==='export-input'&&['resultBytesBase64','summaryBytesBase64'].includes(path[0])
                  ?Math.ceil(MAX_HISTORICAL_RESULT_V2_BYTES*4/3)+4:stringLimit;
      const parsed=string(limit);
      return parsed===null?{ok:false}:{ok:true,value:parsed};
    }
    if(char==='{'){
      index++;whitespace();
      const object=Object.create(null),keys=new Set();
      if(text[index]==='}'){index++;return {ok:true,value:object};}
      while(index<text.length){
        whitespace();
        if(text[index]!=='"')return {ok:false};
        const key=string(stringLimit);
        if(key===null||keys.has(key))return {ok:false};
        keys.add(key);nodes++;
        if(nodes>maxNodes)return {ok:false};
        whitespace();
        if(text[index++]!==':')return {ok:false};
        const child=value(depth+1,path.concat(key));
        if(!child.ok)return child;
        object[key]=child.value;
        whitespace();
        if(text[index]==='}'){index++;return {ok:true,value:object};}
        if(text[index++]!==',')return {ok:false};
      }
      return {ok:false};
    }
    if(char==='['){
      index++;whitespace();
      const array=[];
      if(text[index]===']'){index++;return {ok:true,value:array};}
      while(index<text.length){
        const child=value(depth+1,path.concat(array.length));
        if(!child.ok)return child;
        array.push(child.value);
        if(array.length>1000)return {ok:false};
        whitespace();
        if(text[index]===']'){index++;return {ok:true,value:array};}
        if(text[index++]!==',')return {ok:false};
      }
      return {ok:false};
    }
    for(const [token,result] of [['true',true],['false',false],['null',null]]){
      if(text.startsWith(token,index)){index+=token.length;return {ok:true,value:result};}
    }
    const number=text.slice(index).match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/)?.[0];
    if(number){
      index+=number.length;
      if(layer==='outer'&&(!/^(?:0|[1-9][0-9]*)$/.test(number)||!Number.isSafeInteger(Number(number))))
        return {ok:false};
      const parsed=Number(number);
      return Number.isFinite(parsed)?{ok:true,value:parsed}:{ok:false};
    }
    return {ok:false};
  };
  const parsed=value(0,[]);
  whitespace();
  return parsed.ok&&index===text.length?parsed.value:null;
}

function compareScalars(left,right){
  let a=0,b=0;
  while(a<left.length&&b<right.length){
    const x=left.codePointAt(a),y=right.codePointAt(b);
    if(x!==y)return x-y;
    a+=x>0xffff?2:1;b+=y>0xffff?2:1;
  }
  return (left.length-a)-(right.length-b);
}

function quoteAscii(value){
  let result='"';
  for(const char of value){
    const code=char.codePointAt(0);
    if(char==='"')result+='\\"';
    else if(char==='\\')result+='\\\\';
    else if(code===8)result+='\\b';
    else if(code===9)result+='\\t';
    else if(code===10)result+='\\n';
    else if(code===12)result+='\\f';
    else if(code===13)result+='\\r';
    else if(code<0x20||code===0x7f)result+=`\\u${code.toString(16).padStart(4,'0')}`;
    else if(code<=0x7e)result+=char;
    else if(code<=0xffff)result+=`\\u${code.toString(16).padStart(4,'0')}`;
    else{
      const adjusted=code-0x10000;
      result+=`\\u${(0xd800+(adjusted>>10)).toString(16)}\\u${(0xdc00+(adjusted&0x3ff)).toString(16)}`;
    }
  }
  return `${result}"`;
}

function canonical(value){
  if(value===null)return 'null';
  if(typeof value==='boolean')return value?'true':'false';
  if(typeof value==='number'){
    if(!integer(value))throw new TypeError('OUTER_NUMBER_INVALID');
    return String(value);
  }
  if(typeof value==='string'){
    if(!scalarString(value))throw new TypeError('STRING_INVALID');
    return quoteAscii(value);
  }
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  if(!record(value))throw new TypeError('OBJECT_INVALID');
  return `{${Object.keys(value).sort(compareScalars).map(key=>
    `${quoteAscii(key)}:${canonical(value[key])}`).join(',')}}`;
}

function canonicalWithoutPayload(envelope){
  const copy=Object.create(null);
  for(const key of Object.keys(envelope))if(key!=='payloadSha256')copy[key]=envelope[key];
  return canonical(copy);
}

function deepEqual(left,right){
  if(Object.is(left,right))return true;
  if(Array.isArray(left)||Array.isArray(right))
    return Array.isArray(left)&&Array.isArray(right)&&left.length===right.length&&
      left.every((item,index)=>deepEqual(item,right[index]));
  if(!record(left)||!record(right))return false;
  const a=Object.keys(left).sort(compareScalars),b=Object.keys(right).sort(compareScalars);
  return a.length===b.length&&a.every((key,index)=>key===b[index]&&deepEqual(left[key],right[key]));
}

function boundedTree(value,depth=0,budget={nodes:0}){
  if(depth>12||++budget.nodes>100_000)return false;
  if(value===null||typeof value==='boolean')return true;
  if(typeof value==='number')return Number.isFinite(value);
  if(typeof value==='string')return scalarString(value)&&utf8(value).length<=4096;
  if(Array.isArray(value))return value.length<=1000&&value.every(item=>boundedTree(item,depth+1,budget));
  if(!record(value))return false;
  return Object.entries(value).every(([key,child])=>
    scalarString(key)&&utf8(key).length<=4096&&boundedTree(child,depth+1,budget));
}

function boundedOuter(value,depth=0,budget={nodes:0},path=[]){
  if(depth>12||++budget.nodes>100_000)return false;
  if(value===null||typeof value==='boolean')return true;
  if(typeof value==='number')return integer(value);
  if(typeof value==='string'){
    const limit=path[0]==='job'&&path[1]==='result'||
      path.length===1&&path[0]==='summary'?MAX_HISTORICAL_RESULT_V2_BYTES:
        path[0]==='job'&&path[1]==='controls'?8192:4096;
    return scalarString(value)&&utf8(value).length<=limit;
  }
  if(Array.isArray(value))return value.length<=1000&&value.every((item,index)=>
    boundedOuter(item,depth+1,budget,path.concat(index)));
  if(!record(value)||Object.keys(value).some(key=>!scalarString(key)||utf8(key).length>4096))return false;
  return Object.keys(value).every(key=>boundedOuter(value[key],depth+1,budget,path.concat(key)));
}

function validControls(value){
  if(!record(value))return false;
  if(value.status==='FROZEN_DEVELOPMENT_ONLY')
    return exact(value,CONTROL_KEYS)&&
      value.calibration==='DEVELOPMENT_15BP_DAILY_NET_RETURNS_AND_HELD_TARGETS'&&
      ['meanExposure','riskExposure','primaryDevelopmentSd','fullBasketDevelopmentSd']
        .every(key=>typeof value[key]==='number'&&Number.isFinite(value[key]))&&
      ['meanExposure','riskExposure'].every(key=>value[key]>=0&&value[key]<=1);
  return value.status==='INSUFFICIENT_EVIDENCE'&&exact(value,INSUFFICIENT_CONTROL_KEYS)&&
    value.ok===false&&value.reason==='INVALID_OR_ZERO_DEVELOPMENT_RISK_DENOMINATOR'&&
    ['primarySd','benchmarkSd'].every(key=>value[key]===null||
      typeof value[key]==='number'&&Number.isFinite(value[key]));
}

function validTimestamp(value){
  return typeof value==='string'&&stamp(value)&&value!==null;
}

function validProgress(job){
  if(!Array.isArray(job.paths)||job.paths.length>44)return false;
  const started=job.timestamps.startedAt===null?Date.parse(job.timestamps.createdAt):
    Date.parse(job.timestamps.startedAt);
  const finished=job.timestamps.finishedAt===null?null:Date.parse(job.timestamps.finishedAt);
  let previous=started;
  for(let index=0;index<job.paths.length;index++){
    const item=job.paths[index],completed=item?.state==='completed';
    const keys=completed
      ?['pathId','ordinal','phase','state','startedAt','payloadSha256','completedAt']
      :['pathId','ordinal','phase','state','startedAt'];
    const begins=Date.parse(item?.startedAt);
    const ends=completed?Date.parse(item?.completedAt):begins;
    if(!exact(item,keys)||item.pathId!==job.computationPathIds[index]||
       item.ordinal!==index+1||item.phase!==(index<19?'DEVELOPMENT':'DIAGNOSTIC')||
       !['started','completed'].includes(item.state)||!validTimestamp(item.startedAt)||
       begins<previous||begins<started||finished!==null&&begins>finished||
       completed&&(!hash(item.payloadSha256)||!validTimestamp(item.completedAt)||
         ends<begins||ends<previous||finished!==null&&ends>finished)||
       !completed&&index!==job.paths.length-1)return false;
    previous=ends;
  }
  return true;
}

function validJob(job){
  if(!exact(job,JOB_KEYS)||!hash(job.trialId)||
     typeof job.trialKey!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(job.trialKey)||
     !['queued','unknown','completed','rejected','failed','timed_out','partial'].includes(job.state)||
     !integer(job.attempts)||job.attempts>1||
     !(job.owner===null||typeof job.owner==='string'&&job.owner.length<=80&&
       /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(job.owner))||
     !integer(job.fence)||!hash(job.protocolSha256)||!hash(job.sourceSha256)||
     !hash(job.dataSha256)||!hash(job.manifestSha256)||typeof job.profile!=='string'||
     !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(job.profile)||
     !Array.isArray(job.pathIds)||job.pathIds.length!==44||!job.pathIds.every(hash)||
     new Set(job.pathIds).size!==44||!Array.isArray(job.computationPathIds)||
     job.computationPathIds.length!==44||!job.computationPathIds.every(hash)||
     new Set(job.computationPathIds).size!==44||
     job.computationPathIds.some(id=>!job.pathIds.includes(id))||
     !exact(job.timestamps,['createdAt','startedAt','finishedAt'])||
     !validTimestamp(job.timestamps.createdAt)||
     ![job.timestamps.startedAt,job.timestamps.finishedAt].every(value=>value===null||validTimestamp(value))||
     !validProgress(job)||typeof job.unresolved!=='boolean'||
     !(job.result===null||typeof job.result==='string')||
     !(job.resultSha256===null||hash(job.resultSha256))||
     !(job.summarySha256===null||hash(job.summarySha256))||
     !(job.reason===null||typeof job.reason==='string'&&utf8(job.reason).length<=256)||
     job.executionAuthorized!==false||job.promotionAuthorized!==false||job.profitabilityInferred!==false)
    return false;
  const notAttempted=['queued','rejected'].includes(job.state);
  if(job.attempts!==(notAttempted?0:1)||job.fence===0!==notAttempted||
     (notAttempted?job.owner!==null:job.owner===null)||
     (job.state==='queued'&&(job.paths.length||job.timestamps.startedAt!==null||
       job.timestamps.finishedAt!==null||job.result!==null))||
     (job.state==='rejected'&&(job.paths.length||job.timestamps.startedAt!==null||
       job.timestamps.finishedAt===null||job.result!==null))||
     (job.state==='completed'&&(job.paths.length!==44||
       job.paths.some(item=>item.state!=='completed')||job.timestamps.finishedAt===null))||
     (['failed','timed_out','partial'].includes(job.state)&&job.timestamps.finishedAt===null)||
     (job.state==='unknown'&&job.unresolved!==(job.timestamps.finishedAt===null))||
     (job.unresolved&&(job.state!=='unknown'||job.timestamps.finishedAt!==null||job.result!==null))||
     (['completed','failed','timed_out','partial'].includes(job.state)&&job.timestamps.startedAt===null)||
     (job.paths.length>0&&job.timestamps.startedAt===null)||
     (job.timestamps.startedAt!==null&&Date.parse(job.timestamps.startedAt)<Date.parse(job.timestamps.createdAt))||
     (job.timestamps.finishedAt!==null&&Date.parse(job.timestamps.finishedAt)<
       Date.parse(job.timestamps.startedAt??job.timestamps.createdAt)))return false;
  const hasResult=job.result!==null;
  if((job.resultSha256===null)!==!hasResult||(job.summarySha256===null)!==!hasResult||
     hasResult&&(!hash(job.resultSha256)||!hash(job.summarySha256))||
     job.state==='completed'&&!hasResult||notAttempted&&hasResult)return false;
  if((job.controls===null)!==(job.controlBindings===null))return false;
  if(job.controls!==null){
    if(typeof job.controls!=='string'||utf8(job.controls).length>8192||job.paths.length<19)return false;
    const controls=parseStrictJson(job.controls,{maxBytes:8192,maxNodes:10_000});
    if(!controls||!boundedTree(controls)||!validControls(controls)||
       !exact(job.controlBindings,['primaryDevelopmentSha256','fullBasketDevelopmentSha256'])||
       !hash(job.controlBindings.primaryDevelopmentSha256)||
       !hash(job.controlBindings.fullBasketDevelopmentSha256)||
       job.controlBindings.primaryDevelopmentSha256!==job.paths[0]?.payloadSha256||
       job.controlBindings.fullBasketDevelopmentSha256!==job.paths[15]?.payloadSha256)return false;
  }
  if(hasResult&&(job.controls===null||
     ![job.timestamps.finishedAt!==null,job.state==='completed'||job.state==='failed'].every(Boolean)))
    return false;
  return true;
}

function validPath(path,index,job,status){
  const descriptorKeys=['kind','variantId','scenarioId','segmentId'];
  if(!record(path)||path.pathId!==job.pathIds[index]||
     !['CANDIDATE','FULL_BASKET','FIXED_CONTROL','CASH'].includes(path.kind)||
     !['development','diagnostic'].includes(path.segmentId)||
     typeof path.variantId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9-]{0,79}$/.test(path.variantId)||
     typeof path.scenarioId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9-]{0,79}$/.test(path.scenarioId)||
     descriptorKeys.some(key=>typeof path[key]!=='string'))return false;
  const expected=status==='NOT_RUN_INSUFFICIENT_EVIDENCE'
    ?NOT_RUN_KEYS
    :path.kind==='CANDIDATE'?PATH_KEYS:PATH_KEYS.concat('targetExposure');
  if(!exact(path,expected))return false;
  if(status==='NOT_RUN_INSUFFICIENT_EVIDENCE')
    return path.status===status&&path.attempts===0&&path.computed===false&&path.failure===null;
  const rows=path.segmentId==='development'?180:365;
  if(path.status!=='COMPLETED'||path.attempts!==1||path.computed!==true||
     path.diagnosticRescaling!=='NONE'||
     path.observationClass!=='HISTORICAL_DIAGNOSTIC_NOT_HOLDOUT'||
     path.rows!==rows||path.dailyReturnCount!==rows||
     !['dailyReturns','dailyHeldTarget'].every(key=>Array.isArray(path[key])&&
       path[key].length===rows&&path[key].every(value=>typeof value==='number'&&Number.isFinite(value)))||
     !Array.isArray(path.quarterlyReturns)||path.quarterlyReturns.length!==(rows===180?2:4)||
     !path.quarterlyReturns.every(item=>exact(item,['quarter','netReturn'])&&
       typeof item.quarter==='string'&&/^\d{4}-Q[1-4]$/.test(item.quarter)&&
       typeof item.netReturn==='number'&&Number.isFinite(item.netReturn))||
     !Array.isArray(path.fillCosts)||path.fillCostCount!==path.fillCosts.length||
     !path.fillCosts.every(item=>exact(item,FILL_COST_KEYS)&&
       typeof item.date==='string'&&/^\d{4}-\d{2}-\d{2}T00:00:00Z$/.test(item.date)&&
       ['REBALANCE','TERMINAL_LIQUIDATION'].includes(item.kind)&&
       ['turnover','cost','cumulativeCost','equityAfterFees','cashAfterFees','conservationResidual']
         .every(key=>typeof item[key]==='number'&&Number.isFinite(item[key]))&&
       item.turnover>=0&&item.cost>=0&&item.cumulativeCost>=0&&item.equityAfterFees>=0&&
       item.cashAfterFees>=0&&Math.abs(item.conservationResidual)<=1e-6)||
     !Array.isArray(path.cancelledInstructions)||path.cancelledInstructionCount!==path.cancelledInstructions.length||
     !path.cancelledInstructions.every(item=>exact(item,CANCEL_KEYS)&&
       integer(item.decisionIndex)&&integer(item.fillIndex)&&
       typeof item.target==='number'&&Number.isFinite(item.target)&&
       typeof item.decisionTimestamp==='string'&&
       /^\d{4}-\d{2}-\d{2}T00:00:00Z$/.test(item.decisionTimestamp)&&
       item.reason==='BEYOND_SEGMENT_HORIZON')||
     !exact(path.tradeCRV,['status','value','promotionEligible'])||
     path.tradeCRV.status!=='UNDEFINED_NO_FINITE_STOP'||path.tradeCRV.value!==null||
     path.tradeCRV.promotionEligible!==false||
     !['dailyReturnSd','endEquity','maxAbsoluteTargetMismatch','maxConcentration',
       'maxDrawdownDuration','meanAbsoluteTargetMismatch','meanHeldTarget','meanRealizedExposure',
       'meanTargetRealizedMismatch','netReturn','sampledDrawdown','startEquity','totalCosts',
       'turnoverNotional','turnoverOnInitialEquity'].every(key=>
       typeof path[key]==='number'&&Number.isFinite(path[key])))return false;
  return path.kind==='CANDIDATE'||
    typeof path.targetExposure==='number'&&Number.isFinite(path.targetExposure)&&
    path.targetExposure>=0&&path.targetExposure<=1;
}

function validScreen(screen,status){
  if(status==='INSUFFICIENT_EVIDENCE')
    return exact(screen,['status'])&&screen.status==='INSUFFICIENT_EVIDENCE';
  if(deepEqual(screen,COMPLETED_SCREEN_INSUFFICIENT))return true;
  return exact(screen,SCREEN_KEYS)&&['PASS','NO_EDGE'].includes(screen.status)&&
    screen.interpretation==='HISTORICAL_CANDIDATE_ONLY_NOT_HOLDOUT'&&
    screen.comparisonSegment==='diagnostic'&&
    screen.neighbourStressScenario==='stress-30bp-non-delayed'&&
    exact(screen.checks,SCREEN_CHECKS)&&SCREEN_CHECKS.every(key=>typeof screen.checks[key]==='boolean')&&
    (screen.relativeDrawdownReduction===null||
      typeof screen.relativeDrawdownReduction==='number'&&Number.isFinite(screen.relativeDrawdownReduction))&&
    exact(screen.neighbourPositiveCounts,['base15bp','stress30bp'])&&
    ['base15bp','stress30bp'].every(key=>integer(screen.neighbourPositiveCounts[key])&&
      screen.neighbourPositiveCounts[key]<=4)&&screen.stopPolicy==='NO_FINITE_TRADE_STOP'&&
    deepEqual(screen.tradeCRV,{status:'UNDEFINED_NO_FINITE_STOP',value:null});
}

async function validHistoricalResult(result,job,controls,digestBytes){
  if(!record(result)||!exact(result,RESULT_KEYS)||result.schema!=='MERIDIAN_B1_7_ENGINE_RESULT_R3'||
     !['COMPLETED','INSUFFICIENT_EVIDENCE'].includes(result.status)||
     result.plannedPaths!==44||!Array.isArray(result.paths)||result.paths.length!==44||
     !exact(result.identity,['datasetKind','sourceCommit','sourceProvenance','canonicalSeriesSha256','inputSha256'])||
     result.identity.datasetKind!=='FROZEN_RESEARCH_INPUT'||
     typeof result.identity.sourceCommit!=='string'||result.identity.sourceCommit.length===0||
     result.identity.inputSha256!==job.dataSha256||!exact(result.identity.sourceProvenance,['normalizedFileSha256'])||
     !record(result.identity.sourceProvenance.normalizedFileSha256)||
     Object.keys(result.identity.sourceProvenance.normalizedFileSha256).length===0||
     Object.keys(result.identity.sourceProvenance.normalizedFileSha256).length>32||
     !Object.entries(result.identity.sourceProvenance.normalizedFileSha256).every(([key,value])=>
       /^[A-Za-z0-9._/-]{1,128}$/.test(key)&&hash(value))||
     !exact(result.identity.canonicalSeriesSha256,ASSETS)||
     !Object.values(result.identity.canonicalSeriesSha256).every(hash)||
     result.protocolSha256!==job.protocolSha256||!hash(result.implementationSha256)||
     !hash(result.executionId)||!exact(result.authority,AUTHORITY_KEYS)||
     result.authority.researchOnly!==true||
     Object.entries(result.authority).some(([key,value])=>key!=='researchOnly'&&value!==false)||
     !validHistoricalEvidence(result.evidence)||
     !controls||!deepEqual(result.controlDefinitions,controls)||
     !validBudget(result.budget)||!validProtocolReview(result.protocolReview)||
     typeof result.protocolId!=='string'||typeof result.implementationId!=='string'||
     !hash(result.protocolSha256)||
     !Array.isArray(result.controlRealization)||result.controlRealization.length!==6||
     result.failure!==null||!validScreen(result.screen,result.status))return false;
  const completed=result.status==='COMPLETED';
  const expectedCompleted=completed?44:19;
  if(result.attemptedPaths!==expectedCompleted||result.completedPaths!==expectedCompleted||
     result.computedPaths!==expectedCompleted||job.paths.filter(item=>item.state==='completed').length!==expectedCompleted||
    completed&&job.state!=='completed'||!completed&&job.state!=='failed')return false;
  if(completed&&result.screen.status==='INSUFFICIENT_EVIDENCE'&&!deepEqual(result.screen,COMPLETED_SCREEN_INSUFFICIENT))
    return false;
  if(!completed&&result.screen.status!=='INSUFFICIENT_EVIDENCE')
    return false;
  const id={protocolId:result.protocolId,protocolSha256:result.protocolSha256,
    implementationId:result.implementationId,implementationSha256:result.implementationSha256,
    inputSha256:job.dataSha256,pathIds:job.pathIds};
  if(result.executionId!==await digestBytes(utf8(canonical(id))))return false;
  const controlDescriptors=new Set();
  for(const item of result.controlRealization){
    const path=result.paths.find(candidate=>candidate.pathId===item?.pathId);
    if(!exact(item,CONTROL_REALIZATION_KEYS)||!hash(item.pathId)||
       item.segmentId!=='diagnostic'||item.diagnosticRescaling!=='NONE'||
       !path||path.kind!=='FIXED_CONTROL'||item.variantId!==path.variantId||
       item.scenarioId!==path.scenarioId||
       item.status!==(completed?'COMPLETED':'NOT_RUN_INSUFFICIENT_EVIDENCE')||
       !['frozenTargetExposure','meanRealizedExposure','meanTargetRealizedMismatch',
         'meanAbsoluteTargetMismatch','maxAbsoluteTargetMismatch'].every(key=>
         item[key]===null||typeof item[key]==='number'&&Number.isFinite(item[key])))return false;
    if(completed){
      const target=controls[item.variantId==='frozen-mean-exposure'?'meanExposure':'riskExposure'];
      if(item.frozenTargetExposure!==target||
         item.meanRealizedExposure!==path.meanRealizedExposure||
         item.meanTargetRealizedMismatch!==path.meanTargetRealizedMismatch||
         item.meanAbsoluteTargetMismatch!==path.meanAbsoluteTargetMismatch||
         item.maxAbsoluteTargetMismatch!==path.maxAbsoluteTargetMismatch)return false;
    }else if(['frozenTargetExposure','meanRealizedExposure','meanTargetRealizedMismatch',
      'meanAbsoluteTargetMismatch','maxAbsoluteTargetMismatch'].some(key=>item[key]!==null))return false;
    const key=[item.variantId,item.scenarioId,item.segmentId].join('\0');
    if(controlDescriptors.has(key))return false;
    controlDescriptors.add(key);
  }
  if(controlDescriptors.size!==6)return false;
  const descriptorSet=new Set();
  const progressById=new Map(job.paths.map(item=>[item.pathId,item.state]));
  for(let index=0;index<44;index++){
    const path=result.paths[index];
    if(!validPath(path,index,job,path?.status)||
       (path.status==='COMPLETED')!==(progressById.get(path.pathId)==='completed'))return false;
    const descriptor=[path.kind,path.variantId,path.scenarioId,path.segmentId].join('\0');
    if(descriptorSet.has(descriptor))return false;
    descriptorSet.add(descriptor);
  }
  if(!completed&&result.paths.filter(item=>item.status==='NOT_RUN_INSUFFICIENT_EVIDENCE').length!==25){
    return false;
  }
  return result.paths.every((path,index)=>path.pathId===job.pathIds[index]);
}

function validBudget(budget){
  return exact(budget,['limits','attemptsPerStartedPath','automaticRetry','status'])&&
    exact(budget.limits,['paths','pathMs','totalMs','outputBytes','attemptsPerPath'])&&
    deepEqual(budget.limits,{paths:44,pathMs:60_000,totalMs:1_800_000,
      outputBytes:MAX_HISTORICAL_RESULT_V2_BYTES,attemptsPerPath:1})&&
    budget.attemptsPerStartedPath===1&&budget.automaticRetry===false&&budget.status==='WITHIN_LIMITS';
}

function validProtocolReview(review){
  return exact(review,PROTOCOL_REVIEW_KEYS)&&deepEqual(review,{
    r1RequestId:'MERIDIAN-B1-7-DESIGN-R1',r1ResponseComment:'6249442046',
    r1Verdict:'REVISION_REQUIRED',r2RequestId:'MERIDIAN-B1-7-DESIGN-R2',
    r2ResponseComment:'6249482850',r2Verdict:'GREEN_LIGHT_DESIGN_ONLY',
    r2Scope:'HISTORICAL_R2_ONLY_NOT_APPROVAL_FOR_R3',r3Review:'PENDING'
  });
}

function validHistoricalEvidence(evidence){
  return exact(evidence,EVIDENCE_KEYS)&&deepEqual(evidence,{
    syntheticFixture:false,priceSource:'PINNED_KRAKEN_SPOT_USD_CANDLES',
    costModel:'OKX_INSPIRED_ASSUMED_15_30BP_NOT_EXECUTION_EVIDENCE',
    executionEvidence:'NOT_OKX_EXECUTION_EVIDENCE',sourceAuthenticity:'NOT_ESTABLISHED',
    survivorship:'UNIVERSE_HISTORY_LIMITATION_HBAR_OMITTED_FOR_COVERAGE_ONLY',
    historyLabel:'DEVELOPMENT_AND_HISTORICAL_DIAGNOSTIC',
    candidateInterpretation:'HISTORICAL_CANDIDATE_ONLY_IF_PROPOSED_REAL_SCREEN_PASSES',
    diagnosticRescaling:'NONE',holdoutClaim:false,trialLedger:'UNKNOWN',
    stoppedPolicy:'NO_FINITE_TRADE_STOP',
    crv:{status:'UNDEFINED_NO_FINITE_STOP',value:null,researchOnly:true}
  });
}

function validEnvelope(envelope){
  if(!exact(envelope,ENVELOPE_KEYS)||envelope.schema!==HISTORICAL_EXPORT_V2_SCHEMA||
     envelope.purpose!==HISTORICAL_EXPORT_V2_PURPOSE||
     !exact(envelope.provenance,PROVENANCE_KEYS)||
     envelope.provenance.source!=='CALLER_SUPPLIED_INSPECT_B1'||
     envelope.provenance.assertionStatus!=='UNVERIFIED'||
     envelope.provenance.sourceAuthenticity!=='NOT_ESTABLISHED'||
     envelope.provenance.assertedDatasetClass!=='HISTORICAL'||
     typeof envelope.provenance.generatedFixture!=='boolean'||
     !hash(envelope.payloadSha256)||!validJob(envelope.job)||
     envelope.job.profile!=='MERIDIAN-B1-7-HISTORICAL-ONE-SHOT-R1')return null;
  const job=envelope.job;
  if(job.result===null){
    if(envelope.summary!==null||job.resultSha256!==null||job.summarySha256!==null)return null;
    return {controls:job.controls===null?null:parseStrictJson(job.controls,{maxBytes:8192,maxNodes:10_000})};
  }
  if(typeof envelope.summary!=='string'||utf8(envelope.summary).length>MAX_HISTORICAL_RESULT_V2_BYTES||
     utf8(job.result).length>MAX_HISTORICAL_RESULT_V2_BYTES)return null;
  return {controls:parseStrictJson(job.controls,{maxBytes:8192,maxNodes:10_000})};
}

export function canonicalHistoricalExportV2Payload(envelope){
  return canonicalWithoutPayload(envelope);
}

export function parseHistoricalExportV2Input(text){
  return parseStrictJson(text,{maxBytes:MAX_HISTORICAL_EXPORT_V2_BYTES,
    maxDepth:12,maxNodes:100_000,layer:'export-input'});
}

export async function validateArenaHistoricalExportV2(envelope,digestBytes){
  try{
    const initial=validEnvelope(envelope);
    if(!initial||!boundedOuter(envelope))return null;
    const payloadBytes=utf8(canonicalWithoutPayload(envelope));
    if(utf8(canonical(envelope)).length>MAX_HISTORICAL_EXPORT_V2_BYTES)return null;
    if(envelope.payloadSha256!==await digestBytes(payloadBytes))return null;
    const job=envelope.job;
    if(job.trialId!==await digestBytes(utf8(job.trialKey)))return null;
    if(job.result===null)return {
      status:'PRESENT_UNVERIFIED',schema:envelope.schema,purpose:envelope.purpose,
      provenance:envelope.provenance,job,result:null,summary:null,
      verification:{
        resultBytes:'NOT_SUPPLIED',summaryBytes:'NOT_SUPPLIED',
        summaryProjection:'NOT_SUPPLIED',progressPayloads:'NOT_VERIFIED_ORIGINAL_BYTES_NOT_SUPPLIED',
        identityBindings:'STRUCTURAL_CONSISTENCY_ONLY',sourceAuthenticity:'NOT_ESTABLISHED'
      }
    };
    const resultBytes=utf8(job.result),summaryBytes=utf8(envelope.summary);
    if(await digestBytes(resultBytes)!==job.resultSha256||
       await digestBytes(summaryBytes)!==job.summarySha256)return null;
    const result=parseStrictJson(job.result,{maxBytes:MAX_HISTORICAL_RESULT_V2_BYTES,
      maxDepth:12,maxNodes:100_000,layer:'nested'});
    const summary=parseStrictJson(envelope.summary,{maxBytes:MAX_HISTORICAL_RESULT_V2_BYTES,
      maxDepth:12,maxNodes:100_000,layer:'nested'});
    const controls=parseStrictJson(job.controls,{maxBytes:8192,maxNodes:10_000});
    if(!result||!summary||!controls||!boundedTree(result)||!boundedTree(summary)||
       !boundedTree(controls)||!validControls(controls)||
       !await validHistoricalResult(result,job,controls,digestBytes))return null;
    const projection={...result};
    delete projection.paths;
    delete projection.controlDefinitions;
    if(!deepEqual(projection,summary))return null;
    return {
      status:'PRESENT_UNVERIFIED',schema:envelope.schema,purpose:envelope.purpose,
      provenance:envelope.provenance,job,result,summary,
      verification:{
        resultBytes:'VERIFIED_EXACT_BYTES',summaryBytes:'VERIFIED_EXACT_BYTES',
        summaryProjection:'VERIFIED_EXCLUDING_PATHS_AND_CONTROL_DEFINITIONS',
        progressPayloads:'NOT_VERIFIED_ORIGINAL_BYTES_NOT_SUPPLIED',
        identityBindings:'STRUCTURAL_CONSISTENCY_ONLY',sourceAuthenticity:'NOT_ESTABLISHED'
      }
    };
  }catch{return null;}
}

export async function parseArenaHistoricalExportV2(input,digestBytes=async bytes=>{
  const subtle=globalThis.crypto?.subtle;
  if(!subtle)throw Error('SHA-256 unavailable');
  return [...new Uint8Array(await subtle.digest('SHA-256',bytes))]
    .map(value=>value.toString(16).padStart(2,'0')).join('');
}){
  try{
    if(!(input instanceof Uint8Array)||input.byteLength>MAX_HISTORICAL_EXPORT_V2_BYTES||
       input[0]===0xef&&input[1]===0xbb&&input[2]===0xbf)return ERROR();
    const text=new TextDecoder('utf-8',{fatal:true}).decode(input);
    const envelope=parseStrictJson(text,{maxBytes:MAX_HISTORICAL_EXPORT_V2_BYTES,
      maxDepth:12,maxNodes:100_000,layer:'outer'});
    if(!envelope)return ERROR();
    return await validateArenaHistoricalExportV2(envelope,digestBytes)||ERROR();
  }catch{return ERROR();}
}
