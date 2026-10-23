import {createHash} from 'node:crypto';
import {
  HISTORICAL_EXPORT_PURPOSE,HISTORICAL_EXPORT_SCHEMA,canonicalHistoricalExportPayload,
  validateArenaHistoricalExport
} from '../../../v11/arena-historical-export.js';

const digestBytes = async bytes => createHash('sha256').update(bytes).digest('hex');
const owns = (value,key) => Object.prototype.hasOwnProperty.call(value,key);
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedArrayBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype,'buffer').get;
const typedArrayByteOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype,'byteOffset').get;
const typedArrayLength = Object.getOwnPropertyDescriptor(typedArrayPrototype,'length').get;
const typedArrayName = Object.getOwnPropertyDescriptor(typedArrayPrototype,Symbol.toStringTag).get;
const arrayBufferByteLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength').get;
const uint8Array = Uint8Array;
const uint8ArraySet = Uint8Array.prototype.set;

function copyJson(value,depth=0,budget={nodes:0}){
  if(depth>12||++budget.nodes>100_000)throw new TypeError('OBSERVATION_LIMIT');
  if(value===null||typeof value==='boolean')return value;
  if(typeof value==='string'){
    if(!scalarString(value)||Buffer.byteLength(value,'utf8')>1024*1024)throw new TypeError('OBSERVATION_STRING');
    return value;
  }
  if(typeof value==='number'){
    if(!Number.isSafeInteger(value)||value<0||Object.is(value,-0))throw new TypeError('OBSERVATION_NUMBER');
    return value;
  }
  if(Array.isArray(value)){
    if(Object.getPrototypeOf(value)!==Array.prototype||value.length>1000)throw new TypeError('OBSERVATION_ARRAY');
    const result=[];
    for(let index=0;index<value.length;index++){
      const descriptor=Object.getOwnPropertyDescriptor(value,String(index));
      if(!descriptor||!owns(descriptor,'value'))throw new TypeError('OBSERVATION_ACCESSOR');
      result.push(copyJson(descriptor.value,depth+1,budget));
    }
    if(Reflect.ownKeys(value).some(key=>key!=='length'&&
      (typeof key!=='string'||!/^(0|[1-9]\d*)$/.test(key)||Number(key)>=value.length)))
      throw new TypeError('OBSERVATION_ARRAY');
    return result;
  }
  if(!value||Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)
    throw new TypeError('OBSERVATION_OBJECT');
  const keys=Reflect.ownKeys(value);
  if(keys.some(key=>typeof key!=='string'))throw new TypeError('OBSERVATION_SYMBOL');
  const result=Object.create(null);
  for(const key of keys){
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    if(!descriptor.enumerable||!owns(descriptor,'value')||!scalarString(key)||
       Buffer.byteLength(key,'utf8')>4096)throw new TypeError('OBSERVATION_ACCESSOR');
    result[key]=copyJson(descriptor.value,depth+1,budget);
  }
  return result;
}

function scalarString(value){
  for(let index=0;index<value.length;index++){
    const code=value.charCodeAt(index);
    if(code>=0xd800&&code<=0xdbff){
      const next=value.charCodeAt(index+1);
      if(!(next>=0xdc00&&next<=0xdfff))return false;
      index++;
    }else if(code>=0xdc00&&code<=0xdfff)return false;
  }
  return true;
}

function privateResultSnapshot(resultBytes,result){
  if(result===null){
    if(resultBytes!==null)throw new TypeError('RESULT_BYTES_MISMATCH');
    return null;
  }
  let sourceBuffer,byteOffset,byteLength;
  try{
    if(Reflect.apply(typedArrayName,resultBytes,[])!=='Uint8Array'||
       Object.getPrototypeOf(resultBytes)!==Uint8Array.prototype||
       Reflect.ownKeys(resultBytes).some(key=>key==='buffer'||typeof key==='symbol'||
         !/^(0|[1-9]\d*)$/.test(key)))
      throw new TypeError('RESULT_BYTES_TYPE');
    sourceBuffer=Reflect.apply(typedArrayBuffer,resultBytes,[]);
    Reflect.apply(arrayBufferByteLength,sourceBuffer,[]);
    byteOffset=Reflect.apply(typedArrayByteOffset,resultBytes,[]);
    byteLength=Reflect.apply(typedArrayLength,resultBytes,[]);
    if(byteLength>1024*1024)throw new TypeError('RESULT_BYTES_LIMIT');
  }catch(error){
    if(error?.message==='RESULT_BYTES_TYPE'||error?.message==='RESULT_BYTES_LIMIT')throw error;
    throw new TypeError('RESULT_BYTES_TYPE');
  }
  let snapshot,source;
  try{
    source=new uint8Array(sourceBuffer,byteOffset,byteLength);
    snapshot=new uint8Array(byteLength);
    Reflect.apply(uint8ArraySet,snapshot,[source]);
  }catch{throw new TypeError('RESULT_BYTES_DETACHED');}
  let decoded;
  try{decoded=new TextDecoder('utf-8',{fatal:true}).decode(snapshot);}
  catch{throw new TypeError('RESULT_BYTES_INVALID_UTF8');}
  if(decoded!==result)throw new TypeError('RESULT_BYTES_MISMATCH');
  return snapshot;
}

export async function exportHistoricalResult(input={}){
  if(!input||typeof input!=='object'||Array.isArray(input)||
     Object.getPrototypeOf(input)!==Object.prototype&&Object.getPrototypeOf(input)!==null)
    throw new TypeError('EXPORT_INPUT_INVALID');
  const inputKeys=Reflect.ownKeys(input);
  if(inputKeys.length!==3||inputKeys.some(key=>!['observation','resultBytes','syntheticFixture'].includes(key))||
     inputKeys.some(key=>{
       const descriptor=Object.getOwnPropertyDescriptor(input,key);
       return typeof key!=='string'||!descriptor.enumerable||!owns(descriptor,'value');
     }))throw new TypeError('EXPORT_INPUT_INVALID');
  const observation=input.observation;
  const resultBytes=input.resultBytes;
  const syntheticFixture=input.syntheticFixture;
  if(!observation||typeof observation!=='object'||Array.isArray(observation)||
     typeof syntheticFixture!=='boolean')throw new TypeError('EXPORT_INPUT_INVALID');
  const resultDescriptor=Object.getOwnPropertyDescriptor(observation,'result');
  if(!resultDescriptor||!owns(resultDescriptor,'value'))throw new TypeError('OBSERVATION_RESULT');
  const snapshot=privateResultSnapshot(resultBytes,resultDescriptor.value);
  const job=copyJson(observation);
  const envelope=Object.assign(Object.create(null),{
    schema:HISTORICAL_EXPORT_SCHEMA,
    purpose:HISTORICAL_EXPORT_PURPOSE,
    provenance:{
      source:'CALLER_SUPPLIED_INSPECT_B1',
      assertionStatus:'UNVERIFIED',
      sourceAuthenticity:'NOT_ESTABLISHED',
      syntheticFixture
    },
    job,
    payloadSha256:'0'.repeat(64)
  });
  envelope.payloadSha256=await digestBytes(
    Buffer.from(canonicalHistoricalExportPayload(envelope),'ascii'));
  const projection=await validateArenaHistoricalExport(envelope,digestBytes,snapshot);
  if(!projection)throw new TypeError('INSPECT_OBSERVATION_INVALID');
  return envelope;
}
