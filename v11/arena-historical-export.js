export const MAX_HISTORICAL_EXPORT_BYTES = 8 * 1024 * 1024;
export const HISTORICAL_EXPORT_SCHEMA = 'MERIDIAN_B1_HISTORICAL_RESULT_EXPORT_V1';
export const HISTORICAL_EXPORT_PURPOSE = 'B1_RESULT_EXPORT_NOT_AUTHENTICITY_RECEIPT';

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
const ASSET_KEYS = ['XBTUSD','ETHUSD','SOLUSD','XRPUSD','LINKUSD','AVAXUSD','SUIUSD'];
const PATH_RESULT_KEYS = [
  'attempts','cancelledInstructionCount','cancelledInstructions','computed','dailyHeldTarget',
  'dailyReturnCount','dailyReturnSd','dailyReturns','diagnosticRescaling','endEquity','fillCostCount',
  'fillCosts','kind','maxAbsoluteTargetMismatch','maxConcentration','maxDrawdownDuration',
  'meanAbsoluteTargetMismatch','meanHeldTarget','meanRealizedExposure','meanTargetRealizedMismatch',
  'netReturn','observationClass','pathId','quarterlyReturns','rows','sampledDrawdown','scenarioId',
  'segmentId','startEquity','status','totalCosts','tradeCRV','turnoverNotional',
  'turnoverOnInitialEquity','variantId'
];
const NOT_RUN_PATH_KEYS = [
  'pathId','kind','variantId','scenarioId','segmentId','status','attempts','computed','failure'
];
const FILL_COST_KEYS = [
  'date','kind','turnover','cost','cumulativeCost','equityAfterFees','cashAfterFees','conservationResidual'
];
const CANCELLED_INSTRUCTION_KEYS = [
  'decisionIndex','fillIndex','target','decisionTimestamp','reason'
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
const NUMERIC_KEYS = new Set([
  'attempts','fence','ordinal','rows','dailyReturnCount','netReturn','dailyReturnSd','startEquity','endEquity',
  'turnoverNotional','turnoverOnInitialEquity','meanHeldTarget','meanRealizedExposure',
  'meanTargetRealizedMismatch','meanAbsoluteTargetMismatch','maxAbsoluteTargetMismatch',
  'maxConcentration','maxDrawdownDuration','sampledDrawdown','totalCosts','targetExposure',
  'fillCostCount','turnover','cost','cumulativeCost','equityAfterFees','cashAfterFees',
  'conservationResidual','cancelledInstructionCount','decisionIndex','fillIndex','target',
  'value','pathMs','totalMs','outputBytes','attemptsPerPath','attemptsPerStartedPath',
  'relativeDrawdownReduction','base15bp','stress30bp','meanExposure','riskExposure',
  'primaryDevelopmentSd','fullBasketDevelopmentSd','primarySd','benchmarkSd'
]);
const AUTHORITY_FLAGS = new Set([
  'executionAuthorized','promotionAuthorized','profitabilityInferred','strategyPnlAuthorized',
  'discoveryAuthorized','validationAuthorized','holdoutAuthorized','paperAuthorized','liveAuthorized',
  'promotionEligible','holdoutClaim'
]);
const HASH = /^[a-f0-9]{64}$/;
const STATES = new Set(['queued','unknown','completed','rejected','failed','timed_out','partial']);
const ENVELOPE_KEYS = ['schema','purpose','provenance','job','payloadSha256'];
const PROVENANCE_KEYS = ['source','assertionStatus','sourceAuthenticity','syntheticFixture'];
const COMPUTATION_ORDER = [0,2,4,6,8,10,12,14,16,18,20,22,24,26,28,30,32,34,42,1,3,5,7,9,11,13,15,17,19,21,23,25,27,29,31,33,35,36,37,38,39,40,41,43];
const RESULT_IDENTITY = {
  datasetKind:'SYNTHETIC_FIXTURE',
  sourceCommit:'SYNTHETIC_FIXTURE'
};
const DESCRIPTORS = (() => {
  const variants = ['primary-n30-f25','neighbour-n20-f25','neighbour-n45-f25',
    'neighbour-n30-f20','neighbour-n30-f35'];
  const scenarios = ['base-15bp','stress-30bp','stress-30bp-delay-1d'];
  return [
    ...variants.flatMap(variantId=>scenarios.flatMap(scenarioId=>
      ['development','diagnostic'].map(segmentId=>({kind:'CANDIDATE',variantId,scenarioId,segmentId})))),
    ...scenarios.flatMap(scenarioId=>['development','diagnostic']
      .map(segmentId=>({kind:'FULL_BASKET',variantId:'full-basket-weekly',scenarioId,segmentId}))),
    ...['frozen-mean-exposure','frozen-risk-exposure'].flatMap(variantId=>
      scenarios.map(scenarioId=>({kind:'FIXED_CONTROL',variantId,scenarioId,segmentId:'diagnostic'}))),
    {kind:'CASH',variantId:'cash-zero',scenarioId:'scenario-independent',segmentId:'development'},
    {kind:'CASH',variantId:'cash-zero',scenarioId:'scenario-independent',segmentId:'diagnostic'}
  ];
})();
const BINDINGS = [
  {
    profile:'MERIDIAN-B1-7-GENERATED-FIXTURE-BRIDGE-R1',
    protocolId:'MERIDIAN-B1-7-PROTOCOL-R3-20261018',
    protocolSha256:'a78e1ae8c71c8f85baee5b51f5691643fc29136f636f19465c61f553afe09185',
    implementationId:'MERIDIAN-B1-7-ENGINE-R3',
    implementationSha256:'ab73261f01b27b8655ffea7979fec03eb1a9bea667b6fc4cda8d77b75c4f3e06',
    sourceSha256:'64de87409d07004c7a8ab1a17e0ac7ce0c85a259e978c689745f907c9c55ea05',
    dataSha256:'7b98a6a6ef2834c8a4279406e2d6d174c7ee15d853283f619572b3e0da88fa99',
    manifestSha256:'98a9c4442a140c1e78d60251d312ad489975f58f8f5c48a87a8916b141c1c361',
    pathIdsSha256:'58e86b8528516bfbd9adb87227b3a922480d2920567c88194e575afe911260e9',
    computationPathIdsSha256:'306c304914c3f8e7dcfec40ae7918bae2ac6aa59815073cc8c4da1632f31411b'
  },
  {
    profile:'MERIDIAN-B1-7-GENERATED-FIXTURE-BRIDGE-R1',
    protocolId:'MERIDIAN-B1-7-PROTOCOL-R3-20261018',
    protocolSha256:'a78e1ae8c71c8f85baee5b51f5691643fc29136f636f19465c61f553afe09185',
    implementationId:'MERIDIAN-B1-7-ENGINE-R3',
    implementationSha256:'ab73261f01b27b8655ffea7979fec03eb1a9bea667b6fc4cda8d77b75c4f3e06',
    sourceSha256:'64de87409d07004c7a8ab1a17e0ac7ce0c85a259e978c689745f907c9c55ea05',
    dataSha256:'d0d0fbecb1c5bb39dd8b34fab9f689192182b089fd77dca2656f70889e81c048',
    manifestSha256:'8ce4b8e88fb2c3b391d73be392a1a02afd8beaf272106796a8a59b9701a19edd',
    pathIdsSha256:'f78148b3d854d88d00bc64cc9758b91ebc487283ee45da6d937a8f70da20caa2',
    computationPathIdsSha256:'b88b9cc4d8a78a635055e3aec962ad6291e0bd830520c96a12e73170cab33b4d'
  }
];

const invalid = () => ({
  status:'INVALID',
  message:'Historischer Producer-Export abgelehnt · Format, Identität oder Prüfsumme widersprüchlich.'
});
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => record(value) && Object.keys(value).length === keys.length &&
  keys.every(key=>Object.hasOwn(value,key));
const hash = value => typeof value === 'string' && HASH.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const utf8 = value => new TextEncoder().encode(value);
const scalarString = value => {
  for(let index=0;index<value.length;index++){
    const code=value.charCodeAt(index);
    if(code>=0xd800&&code<=0xdbff){
      const next=value.charCodeAt(index+1);
      if(!(next>=0xdc00&&next<=0xdfff))return false;
      index++;
    } else if(code>=0xdc00&&code<=0xdfff)return false;
  }
  return true;
};
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
      let limit=stringLimit;
      if(layer==='outer'&&path[0]==='job'&&path[1]==='result')limit=1024*1024;
      if(layer==='outer'&&path[0]==='job'&&path[1]==='controls')limit=8192;
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
  return left.length-a-(right.length-b);
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
    if(!Number.isSafeInteger(value)||value<0||Object.is(value,-0))throw new TypeError('OUTER_NUMBER_INVALID');
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

function boundedOuter(value,depth=0,budget={nodes:0},path=[]){
  if(depth>12||++budget.nodes>100_000)return false;
  if(value===null||typeof value==='boolean')return true;
  if(typeof value==='number')return Number.isSafeInteger(value)&&value>=0&&!Object.is(value,-0);
  if(typeof value==='string'){
    const limit=path[0]==='job'&&path[1]==='result'?1024*1024:
      path[0]==='job'&&path[1]==='controls'?8192:4096;
    return scalarString(value)&&utf8(value).length<=limit;
  }
  if(Array.isArray(value))return value.length<=1000&&value.every((item,index)=>
    boundedOuter(item,depth+1,budget,path.concat(index)));
  if(!record(value)||Object.keys(value).some(key=>!scalarString(key)||utf8(key).length>4096))return false;
  return Object.keys(value).every(key=>boundedOuter(value[key],depth+1,budget,path.concat(key)));
}

function deepEqual(left,right){
  if(left===right)return true;
  if(Array.isArray(left)||Array.isArray(right))
    return Array.isArray(left)&&Array.isArray(right)&&left.length===right.length&&
      left.every((item,index)=>deepEqual(item,right[index]));
  if(!record(left)||!record(right))return false;
  const a=Object.keys(left).sort(),b=Object.keys(right).sort();
  return a.length===b.length&&a.every((key,index)=>key===b[index]&&deepEqual(left[key],right[key]));
}

function boundedResult(value,depth=0,budget={nodes:0}){
  if(depth>12||++budget.nodes>100_000)return false;
  if(value===null||typeof value==='boolean')return true;
  if(typeof value==='number')return Number.isFinite(value);
  if(typeof value==='string')return scalarString(value)&&utf8(value).length<=4096;
  if(Array.isArray(value))return value.length<=1000&&value.every(item=>boundedResult(item,depth+1,budget));
  if(!record(value))return false;
  for(const [key,child] of Object.entries(value)){
    if(!scalarString(key)||utf8(key).length>4096||
       AUTHORITY_FLAGS.has(key)&&child!==false||
       NUMERIC_KEYS.has(key)&&child!==null&&typeof child!=='number'||
       !boundedResult(child,depth+1,budget))return false;
  }
  return true;
}

function validHashRecord(value){
  return exact(value,ASSET_KEYS)&&ASSET_KEYS.every(asset=>hash(value[asset]));
}

function validResultIdentity(identity,job){
  if(!exact(identity,['datasetKind','sourceCommit','sourceProvenance','canonicalSeriesSha256','inputSha256'])||
     identity.datasetKind!==RESULT_IDENTITY.datasetKind||identity.sourceCommit!==RESULT_IDENTITY.sourceCommit||
     identity.inputSha256!==job.dataSha256||!validHashRecord(identity.canonicalSeriesSha256)||
     !exact(identity.sourceProvenance,['syntheticFixtureSeriesSha256'])||
     !validHashRecord(identity.sourceProvenance.syntheticFixtureSeriesSha256))return false;
  return deepEqual(identity.sourceProvenance.syntheticFixtureSeriesSha256,
    identity.canonicalSeriesSha256);
}

function validResultEvidence(evidence){
  if(!exact(evidence,['syntheticFixture','priceSource','costModel','executionEvidence','sourceAuthenticity',
    'survivorship','historyLabel','candidateInterpretation','diagnosticRescaling','holdoutClaim','trialLedger',
    'stoppedPolicy','crv']))return false;
  return evidence.syntheticFixture===true&&evidence.priceSource==='SYNTHETIC_FIXTURE'&&
    evidence.costModel==='OKX_INSPIRED_ASSUMED_15_30BP_NOT_EXECUTION_EVIDENCE'&&
    evidence.executionEvidence==='NOT_OKX_EXECUTION_EVIDENCE'&&evidence.sourceAuthenticity==='SYNTHETIC_ONLY'&&
    evidence.survivorship==='UNIVERSE_HISTORY_LIMITATION_HBAR_OMITTED_FOR_COVERAGE_ONLY'&&
    evidence.historyLabel==='DEVELOPMENT_AND_HISTORICAL_DIAGNOSTIC'&&
    evidence.candidateInterpretation==='HISTORICAL_CANDIDATE_ONLY_IF_PROPOSED_REAL_SCREEN_PASSES'&&
    evidence.diagnosticRescaling==='NONE'&&evidence.holdoutClaim===false&&evidence.trialLedger==='UNKNOWN'&&
    evidence.stoppedPolicy==='NO_FINITE_TRADE_STOP'&&
    deepEqual(evidence.crv,{status:'UNDEFINED_NO_FINITE_STOP',value:null,researchOnly:true});
}

function validBudget(budget){
  return exact(budget,['limits','attemptsPerStartedPath','automaticRetry','status'])&&
    exact(budget.limits,['paths','pathMs','totalMs','outputBytes','attemptsPerPath'])&&
    deepEqual(budget.limits,{paths:44,pathMs:60_000,totalMs:1_800_000,
      outputBytes:1024*1024,attemptsPerPath:1})&&
    budget.attemptsPerStartedPath===1&&budget.automaticRetry===false&&budget.status==='WITHIN_LIMITS';
}

function validProtocolReview(review){
  return exact(review,PROTOCOL_REVIEW_KEYS)&&
    deepEqual(review,{
      r1RequestId:'MERIDIAN-B1-7-DESIGN-R1',r1ResponseComment:'6249442046',
      r1Verdict:'REVISION_REQUIRED',r2RequestId:'MERIDIAN-B1-7-DESIGN-R2',
      r2ResponseComment:'6249482850',r2Verdict:'GREEN_LIGHT_DESIGN_ONLY',
      r2Scope:'HISTORICAL_R2_ONLY_NOT_APPROVAL_FOR_R3',r3Review:'PENDING'
    });
}

function validControlRealization(realization,resultStatus,controls,job){
  if(!Array.isArray(realization)||realization.length!==6)return false;
  const expected=DESCRIPTORS.map((descriptor,index)=>({descriptor,index}))
    .filter(({descriptor})=>descriptor.kind==='FIXED_CONTROL'&&descriptor.segmentId==='diagnostic');
  return expected.length===6&&realization.every((item,index)=>{
    const {descriptor,index:descriptorIndex}=expected[index];
    if(!exact(item,CONTROL_REALIZATION_KEYS)||item.pathId!==job.pathIds[descriptorIndex]||
       item.variantId!==descriptor.variantId||item.scenarioId!==descriptor.scenarioId||
       item.segmentId!==descriptor.segmentId||item.diagnosticRescaling!=='NONE')return false;
    if(resultStatus==='INSUFFICIENT_EVIDENCE')
      return item.status==='NOT_RUN_INSUFFICIENT_EVIDENCE'&&
        ['frozenTargetExposure','meanRealizedExposure','meanTargetRealizedMismatch',
          'meanAbsoluteTargetMismatch','maxAbsoluteTargetMismatch'].every(key=>item[key]===null);
    const target=descriptor.variantId==='frozen-mean-exposure'?controls.meanExposure:controls.riskExposure;
    return item.status==='COMPLETED'&&item.frozenTargetExposure===target&&
      ['meanRealizedExposure','meanTargetRealizedMismatch','meanAbsoluteTargetMismatch',
        'maxAbsoluteTargetMismatch'].every(key=>typeof item[key]==='number'&&Number.isFinite(item[key]));
  });
}

function parseNested(text,limit,maxNodes){
  return parseStrictJson(text,{maxBytes:limit,maxNodes,maxDepth:12,layer:'nested'});
}

function descriptorAt(index){
  return DESCRIPTORS[index];
}

function matchingBinding(job){
  const matches=BINDINGS.filter(binding=>
    binding.profile===job.profile&&binding.protocolSha256===job.protocolSha256&&
    binding.sourceSha256===job.sourceSha256&&binding.dataSha256===job.dataSha256&&
    binding.manifestSha256===job.manifestSha256);
  return matches.length===1?matches[0]:null;
}

function validControls(text,progress){
  if(text===null)return null;
  if(typeof text!=='string'||utf8(text).length>8192||
     progress.filter(item=>item.state==='completed').length<19)return null;
  const controls=parseNested(text,8192,10_000);
  if(!record(controls)||!boundedResult(controls))return null;
  if(controls.status==='FROZEN_DEVELOPMENT_ONLY'){
    const keys=['status','meanExposure','riskExposure','primaryDevelopmentSd','fullBasketDevelopmentSd','calibration'];
    if(!exact(controls,keys)||controls.calibration!=='DEVELOPMENT_15BP_DAILY_NET_RETURNS_AND_HELD_TARGETS'||
       !['meanExposure','riskExposure','primaryDevelopmentSd','fullBasketDevelopmentSd']
         .every(key=>typeof controls[key]==='number'&&Number.isFinite(controls[key]))||
       !['meanExposure','riskExposure'].every(key=>controls[key]>=0&&controls[key]<=1))return null;
  }else if(controls.status==='INSUFFICIENT_EVIDENCE'){
    const keys=['ok','status','reason','primarySd','benchmarkSd'];
    if(!exact(controls,keys)||controls.ok!==false||
       controls.reason!=='INVALID_OR_ZERO_DEVELOPMENT_RISK_DENOMINATOR'||
       !['primarySd','benchmarkSd'].every(key=>controls[key]===null||
         typeof controls[key]==='number'&&Number.isFinite(controls[key])))return null;
  }else return null;
  return controls;
}

function validScreen(screen,resultStatus){
  if(resultStatus==='INSUFFICIENT_EVIDENCE')
    return exact(screen,['status'])&&screen.status==='INSUFFICIENT_EVIDENCE';
  if(!record(screen))return false;
  if(screen.status==='INSUFFICIENT_EVIDENCE')
    return exact(screen,['status','checks','relativeDrawdownReduction'])&&
      exact(screen.checks,['fullBasketDrawdownDenominator'])&&
      screen.checks.fullBasketDrawdownDenominator===false&&screen.relativeDrawdownReduction===null;
  const screenKeys=['status','interpretation','comparisonSegment','neighbourStressScenario','checks',
    'relativeDrawdownReduction','neighbourPositiveCounts','stopPolicy','tradeCRV'];
  const checkKeys=['primaryDiagnosticNetPositive','primaryDiagnosticDrawdownAtMost25Percent',
    'primaryReturnAtLeastBothFrozenControls','primaryDrawdownAtMostBothFrozenControls',
    'relativeDrawdownReductionAtLeast20Percent','primaryNetPositiveAt30bpNonDelayed',
    'primaryNetPositiveAt30bpPlusDelay','atLeastThreeOfFourNeighboursPositiveAt15bp',
    'atLeastThreeOfFourNeighboursPositiveAt30bpNonDelayed'];
  const synthetic=screen.status==='SYNTHETIC_ONLY_NOT_ASSESSED'&&
    screen.interpretation==='SYNTHETIC_FIXTURE_RULE_CHECKS_ONLY';
  return exact(screen,screenKeys)&&(['PASS','NO_EDGE'].includes(screen.status)||synthetic)&&
    (synthetic||screen.interpretation==='HISTORICAL_CANDIDATE_ONLY_NOT_HOLDOUT')&&
    screen.comparisonSegment==='diagnostic'&&
    screen.neighbourStressScenario==='stress-30bp-non-delayed'&&screen.stopPolicy==='NO_FINITE_TRADE_STOP'&&
    exact(screen.checks,checkKeys)&&checkKeys.every(key=>typeof screen.checks[key]==='boolean')&&
    (screen.relativeDrawdownReduction===null||Number.isFinite(screen.relativeDrawdownReduction))&&
    exact(screen.neighbourPositiveCounts,['base15bp','stress30bp'])&&
    ['base15bp','stress30bp'].every(key=>Number.isSafeInteger(screen.neighbourPositiveCounts[key])&&
      screen.neighbourPositiveCounts[key]>=0&&screen.neighbourPositiveCounts[key]<=4)&&
    deepEqual(screen.tradeCRV,{status:'UNDEFINED_NO_FINITE_STOP',value:null});
}

function validCompletedPath(path,descriptor,rows){
  const expectedKeys=descriptor.kind==='CANDIDATE'
    ?PATH_RESULT_KEYS:PATH_RESULT_KEYS.concat('targetExposure');
  const numericKeys=[
    'dailyReturnSd','endEquity','maxAbsoluteTargetMismatch','maxConcentration','maxDrawdownDuration',
    'meanAbsoluteTargetMismatch','meanHeldTarget','meanRealizedExposure','meanTargetRealizedMismatch',
    'netReturn','sampledDrawdown','startEquity','totalCosts','turnoverNotional','turnoverOnInitialEquity'
  ];
  if(!exact(path,expectedKeys)||path.status!=='COMPLETED'||path.attempts!==1||path.computed!==true||
     path.observationClass!=='HISTORICAL_DIAGNOSTIC_NOT_HOLDOUT'||path.diagnosticRescaling!=='NONE'||
     path.rows!==rows||path.dailyReturnCount!==rows||!integer(path.maxDrawdownDuration)||
     !integer(path.fillCostCount)||!integer(path.cancelledInstructionCount)||
     !numericKeys.every(key=>typeof path[key]==='number'&&Number.isFinite(path[key]))||
     !Array.isArray(path.dailyReturns)||path.dailyReturns.length!==rows||
     !path.dailyReturns.every(value=>typeof value==='number'&&Number.isFinite(value))||
     !Array.isArray(path.dailyHeldTarget)||path.dailyHeldTarget.length!==rows||
     !path.dailyHeldTarget.every(value=>typeof value==='number'&&Number.isFinite(value))||
     !Array.isArray(path.quarterlyReturns)||path.quarterlyReturns.length!==(rows===180?2:4)||
     !path.quarterlyReturns.every(item=>exact(item,['quarter','netReturn'])&&
       typeof item.quarter==='string'&&/^\d{4}-Q[1-4]$/.test(item.quarter)&&
       typeof item.netReturn==='number'&&Number.isFinite(item.netReturn))||
     !Array.isArray(path.fillCosts)||path.fillCosts.length!==path.fillCostCount||
     !path.fillCosts.every(item=>exact(item,FILL_COST_KEYS)&&
       typeof item.date==='string'&&/^\d{4}-\d{2}-\d{2}T00:00:00Z$/.test(item.date)&&
       ['REBALANCE','TERMINAL_LIQUIDATION'].includes(item.kind)&&
       ['turnover','cost','cumulativeCost','equityAfterFees','cashAfterFees','conservationResidual']
         .every(key=>typeof item[key]==='number'&&Number.isFinite(item[key]))&&
       item.turnover>=0&&item.cost>=0&&item.cumulativeCost>=0&&item.equityAfterFees>=0&&
       item.cashAfterFees>=0&&Math.abs(item.conservationResidual)<=1e-6)||
     !Array.isArray(path.cancelledInstructions)||
     path.cancelledInstructions.length!==path.cancelledInstructionCount||
     !path.cancelledInstructions.every(item=>exact(item,CANCELLED_INSTRUCTION_KEYS)&&
       integer(item.decisionIndex)&&integer(item.fillIndex)&&
       typeof item.target==='number'&&Number.isFinite(item.target)&&
       typeof item.decisionTimestamp==='string'&&
       /^\d{4}-\d{2}-\d{2}T00:00:00Z$/.test(item.decisionTimestamp)&&
       item.reason==='BEYOND_SEGMENT_HORIZON')||
     !exact(path.tradeCRV,['status','value','promotionEligible'])||
     path.tradeCRV.status!=='UNDEFINED_NO_FINITE_STOP'||path.tradeCRV.value!==null||
     path.tradeCRV.promotionEligible!==false)return false;
  if(descriptor.kind==='CASH'){
    if(path.targetExposure!==0||path.fillCosts.length!==0||path.totalCosts!==0||
       path.dailyReturns.some(value=>value!==0))return false;
  }else if(path.fillCosts.length===0||
     path.fillCosts.at(-1).kind!=='TERMINAL_LIQUIDATION')return false;
  return descriptor.kind==='CANDIDATE'||
    typeof path.targetExposure==='number'&&Number.isFinite(path.targetExposure)&&
    path.targetExposure>=0&&path.targetExposure<=1;
}

function validResult(text,job,controls){
  if(text===null)return null;
  const result=parseNested(text,1024*1024,100_000);
  const reject=()=>null;
  if(!record(result)||!boundedResult(result)||!exact(result,RESULT_KEYS))return reject('shape');
  if(result.schema!=='MERIDIAN_B1_7_ENGINE_RESULT_R3'||
     !['COMPLETED','INSUFFICIENT_EVIDENCE'].includes(result.status)||
     result.plannedPaths!==44||!Array.isArray(result.paths)||result.paths.length!==44||
     !record(result.controlDefinitions)||!record(result.authority))return reject('schema');
  const binding=matchingBinding(job);
  if(!exact(result.authority,['researchOnly','executionAuthorized','strategyPnlAuthorized','discoveryAuthorized',
        'validationAuthorized','holdoutAuthorized','paperAuthorized','liveAuthorized'])||
     result.authority.researchOnly!==true||
     Object.entries(result.authority).some(([key,value])=>key!=='researchOnly'&&value!==false)||
     !exact(result.identity,['datasetKind','sourceCommit','sourceProvenance','canonicalSeriesSha256','inputSha256'])||
     !validResultIdentity(result.identity,job)||
     !validResultEvidence(result.evidence)||result.evidence.syntheticFixture!==true||
     !validBudget(result.budget)||!validProtocolReview(result.protocolReview)||
     !hash(result.executionId)||result.protocolId!==binding?.protocolId||
     result.implementationId!==binding?.implementationId||
     result.implementationSha256!==binding?.implementationSha256)return reject('authority-or-schema');
  const evidence=result.evidence;
  if(result.identity.inputSha256!==job.dataSha256||
     result.protocolSha256!==job.protocolSha256||evidence.syntheticFixture!==true||
     !integer(result.attemptedPaths)||!integer(result.completedPaths)||
     !integer(result.computedPaths)||result.attemptedPaths>44||result.completedPaths>44||
     result.attemptedPaths!==result.completedPaths||result.completedPaths!==result.computedPaths||
     result.completedPaths!==job.paths.filter(item=>item.state==='completed').length||
     !validScreen(result.screen,result.status)||!controls||!deepEqual(result.controlDefinitions,controls)||
     !validControlRealization(result.controlRealization,result.status,controls,job))return reject('identity-or-summary');
  if(result.failure!==null)return reject('failure');
  if(!exact(result.screen,['status'])&&result.status==='INSUFFICIENT_EVIDENCE')return reject('screen-shape');
  if(result.status==='COMPLETED'&&
     (result.completedPaths!==44||job.state!=='completed'||result.paths.some(path=>path.status!=='COMPLETED')))return reject('completed-state');
  if(result.status==='INSUFFICIENT_EVIDENCE'&&
       (result.completedPaths!==19||job.state!=='failed'||
         result.paths.filter(path=>path.status==='COMPLETED').length!==19))return reject();
  const progressById=new Map(job.paths.map(path=>[path.pathId,path]));
  for(let index=0;index<result.paths.length;index++){
    const path=result.paths[index],descriptor=descriptorAt(index);
    if(!record(path)||path.pathId!==job.pathIds[index]||path.kind!==descriptor.kind||
        path.variantId!==descriptor.variantId||path.scenarioId!==descriptor.scenarioId||
        path.segmentId!==descriptor.segmentId)return reject(`descriptor-${index}`);
    if(path.status==='COMPLETED'){
       const rows=path.segmentId==='development'?180:365;
       if(!validCompletedPath(path,descriptor,rows)||progressById.get(path.pathId)?.state!=='completed')
         return reject(`progress-${index}`);
    }else if(path.status==='NOT_RUN_INSUFFICIENT_EVIDENCE'){
       if(!exact(path,NOT_RUN_PATH_KEYS)||result.status!=='INSUFFICIENT_EVIDENCE'||
          path.computed!==false||path.attempts!==0||path.failure!==null||
          progressById.has(path.pathId))return reject(`not-run-${index}`);
    }else return reject(`path-status-${index}`);
  }
  return result;
}

function validJob(job){
  if(!exact(job,JOB_KEYS)||!hash(job.trialId)||typeof job.trialKey!=='string'||
     !/^trial-[a-z0-9][a-z0-9-]{0,47}$/.test(job.trialKey)||!STATES.has(job.state)||
     !integer(job.attempts)||job.attempts>1||
     !(job.owner===null||typeof job.owner==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(job.owner))||
     !integer(job.fence)||!matchingBinding(job)||
     !Array.isArray(job.pathIds)||job.pathIds.length!==44||!job.pathIds.every(hash)||
     !Array.isArray(job.computationPathIds)||job.computationPathIds.length!==44||
     !job.computationPathIds.every(hash)||new Set(job.pathIds).size!==44||
     new Set(job.computationPathIds).size!==44||
     !exact(job.timestamps,['createdAt','startedAt','finishedAt'])||
     !Object.values(job.timestamps).every(stamp)||job.timestamps.createdAt===null||
     !Array.isArray(job.paths)||job.paths.length>44||
     !(job.reason===null||typeof job.reason==='string'&&utf8(job.reason).length<=256)||
     typeof job.unresolved!=='boolean'||job.executionAuthorized!==false||
     job.promotionAuthorized!==false||job.profitabilityInferred!==false)return null;
  const binding=matchingBinding(job);
  if(job.pathIds.some((id,index)=>job.computationPathIds[index]!==job.pathIds[COMPUTATION_ORDER[index]]))
    return null;
  const createdMs=Date.parse(job.timestamps.createdAt);
  const startedMs=job.timestamps.startedAt===null?null:Date.parse(job.timestamps.startedAt);
  const finishedMs=job.timestamps.finishedAt===null?null:Date.parse(job.timestamps.finishedAt);
  let previousProgressMs=startedMs??createdMs;
  for(let index=0;index<job.paths.length;index++){
    const item=job.paths[index],completed=item?.state==='completed';
    const keys=completed
      ?['pathId','ordinal','phase','state','startedAt','payloadSha256','completedAt']
      :['pathId','ordinal','phase','state','startedAt'];
    const progressStartedMs=typeof item?.startedAt==='string'?Date.parse(item.startedAt):NaN;
    const progressCompletedMs=completed&&typeof item?.completedAt==='string'?Date.parse(item.completedAt):NaN;
    if(!exact(item,keys)||item.pathId!==job.computationPathIds[index]||item.ordinal!==index+1||
       item.phase!==(index<19?'DEVELOPMENT':'DIAGNOSTIC')||!['started','completed'].includes(item.state)||
       !stamp(item.startedAt)||item.startedAt===null||
       progressStartedMs<(startedMs??createdMs)||progressStartedMs<previousProgressMs||
       finishedMs!==null&&progressStartedMs>finishedMs||
       completed&&(!hash(item.payloadSha256)||!stamp(item.completedAt)||item.completedAt===null||
         progressCompletedMs<progressStartedMs||progressCompletedMs<previousProgressMs||
         finishedMs!==null&&progressCompletedMs>finishedMs)||
       !completed&&index!==job.paths.length-1)return null;
    previousProgressMs=completed?progressCompletedMs:progressStartedMs;
  }
  const notAttempted=['queued','rejected'].includes(job.state);
  if(job.attempts!==(notAttempted?0:1)||job.fence===0!==notAttempted||
     (notAttempted?job.owner!==null:job.owner===null)||
     (job.unresolved&&job.state!=='unknown')||
     (job.state==='unknown'&&job.unresolved!==(job.timestamps.finishedAt===null))||
     (job.unresolved&&(job.timestamps.finishedAt!==null||job.result!==null))||
     (job.state==='queued'&&(job.paths.length!==0||job.timestamps.startedAt!==null||
       job.timestamps.finishedAt!==null||job.result!==null))||
     (job.state==='rejected'&&(job.timestamps.startedAt!==null||job.paths.length!==0||
       job.timestamps.finishedAt===null))||
     (['completed','failed','timed_out','partial'].includes(job.state)&&job.timestamps.startedAt===null)||
     (job.state==='completed'&&(job.paths.length!==44||
       job.paths.some(item=>item.state!=='completed')||job.timestamps.startedAt===null||
       job.timestamps.finishedAt===null))||
     (['failed','timed_out','partial'].includes(job.state)&&job.timestamps.finishedAt===null)||
     (job.paths.length>0&&job.timestamps.startedAt===null))return null;
  const {createdAt,startedAt,finishedAt}=job.timestamps;
  if(startedAt!==null&&Date.parse(startedAt)<Date.parse(createdAt)||
     finishedAt!==null&&Date.parse(finishedAt)<Date.parse(startedAt??createdAt))return null;
  if(finishedAt!==null&&previousProgressMs>Date.parse(finishedAt))return null;
  const noResult=job.result===null;
  if((job.resultSha256===null)!==noResult||(job.summarySha256===null)!==noResult||
     (!noResult&&(!hash(job.resultSha256)||!hash(job.summarySha256)))||
     (job.state==='completed'&&noResult)||(notAttempted&&!noResult))return null;
  if((job.controls===null)!==(job.controlBindings===null))return null;
  let controls=null;
  if(job.controls!==null){
    controls=validControls(job.controls,job.paths);
    if(!controls||!exact(job.controlBindings,['primaryDevelopmentSha256','fullBasketDevelopmentSha256'])||
       !hash(job.controlBindings.primaryDevelopmentSha256)||
       !hash(job.controlBindings.fullBasketDevelopmentSha256)||
       job.controlBindings.primaryDevelopmentSha256!==job.paths[0]?.payloadSha256||
       job.controlBindings.fullBasketDevelopmentSha256!==job.paths[15]?.payloadSha256)return null;
  }
  const result=validResult(job.result,job,controls);
  if(job.result!==null&&(!result||job.state==='completed'&&result.completedPaths!==44))return null;
  if(job.result===null&&job.state==='completed')return null;
  if(!binding)return null;
  return {controls,result,binding};
}

export function canonicalHistoricalExportPayload(envelope){
  return canonicalWithoutPayload(envelope);
}

export async function validateArenaHistoricalExport(envelope,digestBytes,resultSnapshot=null){
  try{
    if(!exact(envelope,ENVELOPE_KEYS)||envelope.schema!==HISTORICAL_EXPORT_SCHEMA||
       envelope.purpose!==HISTORICAL_EXPORT_PURPOSE||!exact(envelope.provenance,PROVENANCE_KEYS)||
       envelope.provenance.source!=='CALLER_SUPPLIED_INSPECT_B1'||
       envelope.provenance.assertionStatus!=='UNVERIFIED'||
       envelope.provenance.sourceAuthenticity!=='NOT_ESTABLISHED'||
       typeof envelope.provenance.syntheticFixture!=='boolean'||!hash(envelope.payloadSha256)||
       !boundedOuter(envelope))return null;
    const {controls,result,binding}=validJob(envelope.job)||{};
    if(!binding)return null;
    if(result&&envelope.provenance.syntheticFixture!==result.evidence.syntheticFixture)return null;
    const payloadBytes=utf8(canonicalWithoutPayload(envelope));
    const fullEnvelopeBytes=utf8(canonical(envelope));
    if(fullEnvelopeBytes.length>MAX_HISTORICAL_EXPORT_BYTES)return null;
    const idsBytes=utf8(canonical(envelope.job.pathIds));
    const computationBytes=utf8(canonical(envelope.job.computationPathIds));
    const resultIdentity=envelope.job.result===null?null:result.identity;
    const inputIdentity=resultIdentity===null?null:Object.fromEntries(
      Object.entries(resultIdentity).filter(([key])=>key!=='inputSha256'));
    const executionIdentity=result===null?null:{
      protocolId:binding.protocolId,protocolSha256:binding.protocolSha256,
      implementationId:binding.implementationId,implementationSha256:binding.implementationSha256,
      inputSha256:envelope.job.dataSha256,pathIds:envelope.job.pathIds
    };
    const resultBytes=envelope.job.result===null?null:
      resultSnapshot??utf8(envelope.job.result);
    if(resultBytes!==null){
      const decoded=new TextDecoder('utf-8',{fatal:true}).decode(resultBytes);
      if(decoded!==envelope.job.result)return null;
    }
    const hashes=await Promise.all([
      digestBytes(utf8(envelope.job.trialKey)),
      resultBytes===null?null:digestBytes(resultBytes),
      digestBytes(payloadBytes),
      digestBytes(idsBytes),
      digestBytes(computationBytes),
      inputIdentity===null?null:digestBytes(utf8(canonical(inputIdentity))),
      executionIdentity===null?null:digestBytes(utf8(canonical(executionIdentity)))
    ]);
    if(envelope.job.trialId!==hashes[0]||
       (resultBytes!==null&&envelope.job.resultSha256!==hashes[1])||
       envelope.payloadSha256!==hashes[2]||
       binding.pathIdsSha256!==hashes[3]||
       binding.computationPathIdsSha256!==hashes[4]||
       resultBytes!==null&&(envelope.job.dataSha256!==hashes[5]||result.executionId!==hashes[6]))return null;
    return {
      status:'PRESENT_UNVERIFIED',
      message:'Producer-Export vorhanden · Herkunft und caller assertions nicht bestätigt.',
      provenance:envelope.provenance,
      job:envelope.job,
      result
    };
  }catch{return null;}
}

export async function parseArenaHistoricalExport(input,digestBytes=async bytes=>{
  const subtle=globalThis.crypto?.subtle;
  if(!subtle)throw Error('SHA-256 unavailable');
  return [...new Uint8Array(await subtle.digest('SHA-256',bytes))]
    .map(value=>value.toString(16).padStart(2,'0')).join('');
}){
  try{
    if(!(input instanceof Uint8Array)||input.byteLength>MAX_HISTORICAL_EXPORT_BYTES||
       input[0]===0xef&&input[1]===0xbb&&input[2]===0xbf)return invalid();
    const text=new TextDecoder('utf-8',{fatal:true}).decode(input);
    const envelope=parseStrictJson(text,{maxBytes:MAX_HISTORICAL_EXPORT_BYTES,maxDepth:12,
      maxNodes:100_000,layer:'outer'});
    if(!envelope)return invalid();
    return await validateArenaHistoricalExport(envelope,digestBytes)||invalid();
  }catch{return invalid();}
}
