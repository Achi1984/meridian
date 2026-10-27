import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {
  HISTORICAL_EXPORT_V2_PURPOSE,HISTORICAL_EXPORT_V2_SCHEMA,MAX_HISTORICAL_EXPORT_V2_BYTES,
  MAX_HISTORICAL_RESULT_V2_BYTES,canonicalHistoricalExportV2Payload,
  parseArenaHistoricalExportV2,parseHistoricalExportV2Input
} from '../../../v11/arena-historical-export-v2.js';

const digestBytes=async bytes=>createHash('sha256').update(bytes).digest('hex');
const owns=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const typedArrayPrototype=Object.getPrototypeOf(Uint8Array.prototype);
const typedArrayBuffer=Object.getOwnPropertyDescriptor(typedArrayPrototype,'buffer').get;
const typedArrayByteOffset=Object.getOwnPropertyDescriptor(typedArrayPrototype,'byteOffset').get;
const typedArrayLength=Object.getOwnPropertyDescriptor(typedArrayPrototype,'length').get;
const typedArrayName=Object.getOwnPropertyDescriptor(typedArrayPrototype,Symbol.toStringTag).get;
const arrayBufferByteLength=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength').get;
const uint8Array=Uint8Array;
const uint8ArraySet=Uint8Array.prototype.set;
const EXPORT_ERRORS=new Set([
  'EXPORT_ARGUMENTS_INVALID','EXPORT_INPUT_LIMIT','EXPORT_INPUT_INVALID','EXPORT_IO_FAILED'
]);

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

function copyJson(value,depth=0,budget={nodes:0}){
  if(depth>12||++budget.nodes>100_000)throw new TypeError('EXPORT_INPUT_INVALID');
  if(value===null||typeof value==='boolean')return value;
  if(typeof value==='string'){
    if(!scalarString(value)||Buffer.byteLength(value,'utf8')>MAX_HISTORICAL_RESULT_V2_BYTES)
      throw new TypeError('EXPORT_INPUT_INVALID');
    return value;
  }
  if(typeof value==='number'){
    if(!Number.isSafeInteger(value)||value<0||Object.is(value,-0))
      throw new TypeError('EXPORT_INPUT_INVALID');
    return value;
  }
  if(Array.isArray(value)){
    if(Object.getPrototypeOf(value)!==Array.prototype||value.length>1000)
      throw new TypeError('EXPORT_INPUT_INVALID');
    const result=[];
    for(let index=0;index<value.length;index++){
      const descriptor=Object.getOwnPropertyDescriptor(value,String(index));
      if(!descriptor||!owns(descriptor,'value'))throw new TypeError('EXPORT_INPUT_INVALID');
      result.push(copyJson(descriptor.value,depth+1,budget));
    }
    if(Reflect.ownKeys(value).some(key=>key!=='length'&&
       (typeof key!=='string'||!/^(0|[1-9]\d*)$/.test(key)||Number(key)>=value.length)))
      throw new TypeError('EXPORT_INPUT_INVALID');
    return result;
  }
  if(!value||Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)
    throw new TypeError('EXPORT_INPUT_INVALID');
  const keys=Reflect.ownKeys(value);
  if(keys.some(key=>typeof key!=='string'))throw new TypeError('EXPORT_INPUT_INVALID');
  const result=Object.create(null);
  for(const key of keys){
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    if(!descriptor.enumerable||!owns(descriptor,'value')||!scalarString(key)||
       Buffer.byteLength(key,'utf8')>4096)throw new TypeError('EXPORT_INPUT_INVALID');
    result[key]=copyJson(descriptor.value,depth+1,budget);
  }
  return result;
}

function snapshotBytes(value,limit,code){
  if(value===null)return null;
  let buffer,offset,length;
  try{
    if(Reflect.apply(typedArrayName,value,[])!=='Uint8Array'||
       Object.getPrototypeOf(value)!==Uint8Array.prototype)throw new TypeError(code);
    buffer=Reflect.apply(typedArrayBuffer,value,[]);
    Reflect.apply(arrayBufferByteLength,buffer,[]);
    offset=Reflect.apply(typedArrayByteOffset,value,[]);
    length=Reflect.apply(typedArrayLength,value,[]);
    if(length>limit)throw new TypeError('EXPORT_INPUT_LIMIT');
    if(Reflect.ownKeys(value).some(key=>key==='buffer'||typeof key!=='string'||
       !/^(0|[1-9]\d*)$/.test(key)))throw new TypeError(code);
  }catch(error){
    if(error?.message===code||error?.message==='EXPORT_INPUT_LIMIT')throw error;
    throw new TypeError(code);
  }
  try{
    const source=new uint8Array(buffer,offset,length),snapshot=new uint8Array(length);
    Reflect.apply(uint8ArraySet,snapshot,[source]);
    new TextDecoder('utf-8',{fatal:true}).decode(snapshot);
    return snapshot;
  }catch{throw new TypeError(code);}
}

function exactInput(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||
     Object.getPrototypeOf(input)!==Object.prototype&&Object.getPrototypeOf(input)!==null)
    throw new TypeError('EXPORT_INPUT_INVALID');
  const keys=Reflect.ownKeys(input);
  if(keys.length!==4||keys.some(key=>!['observation','resultBytes','summaryBytes','generatedFixture'].includes(key))||
     keys.some(key=>{
       const descriptor=Object.getOwnPropertyDescriptor(input,key);
       return typeof key!=='string'||!descriptor.enumerable||!owns(descriptor,'value');
     }))throw new TypeError('EXPORT_INPUT_INVALID');
}

export async function exportHistoricalResultV2(input={}){
  exactInput(input);
  if(typeof input.generatedFixture!=='boolean'||!input.observation||
     typeof input.observation!=='object'||Array.isArray(input.observation))
    throw new TypeError('EXPORT_INPUT_INVALID');
  const observation=copyJson(input.observation);
  if(!Object.hasOwn(observation,'result'))throw new TypeError('EXPORT_INPUT_INVALID');
  const resultBytes=snapshotBytes(input.resultBytes,MAX_HISTORICAL_RESULT_V2_BYTES,'EXPORT_INPUT_INVALID');
  const summaryBytes=snapshotBytes(input.summaryBytes,MAX_HISTORICAL_RESULT_V2_BYTES,'EXPORT_INPUT_INVALID');
  let summary=null;
  if(observation.result===null){
    if(resultBytes!==null||summaryBytes!==null||observation.resultSha256!==null||
       observation.summarySha256!==null)throw new TypeError('EXPORT_INPUT_INVALID');
  }else{
    if(typeof observation.result!=='string'||!resultBytes||!summaryBytes)
      throw new TypeError('EXPORT_INPUT_INVALID');
    const resultText=new TextDecoder('utf-8',{fatal:true}).decode(resultBytes);
    const summaryText=new TextDecoder('utf-8',{fatal:true}).decode(summaryBytes);
    if(resultText!==observation.result||
       await digestBytes(resultBytes)!==observation.resultSha256||
       await digestBytes(summaryBytes)!==observation.summarySha256)
      throw new TypeError('EXPORT_INPUT_INVALID');
    observation.result=resultText;
    observation.summarySha256=await digestBytes(summaryBytes);
    summary=summaryText;
  }
  const envelope=Object.assign(Object.create(null),{
    schema:HISTORICAL_EXPORT_V2_SCHEMA,
    purpose:HISTORICAL_EXPORT_V2_PURPOSE,
    provenance:{
      source:'CALLER_SUPPLIED_INSPECT_B1',assertionStatus:'UNVERIFIED',
      sourceAuthenticity:'NOT_ESTABLISHED',assertedDatasetClass:'HISTORICAL',
      generatedFixture:input.generatedFixture
    },
    job:observation,
    summary,
    payloadSha256:'0'.repeat(64)
  });
  envelope.payloadSha256=await digestBytes(
    Buffer.from(canonicalHistoricalExportV2Payload(envelope),'ascii'));
  const encoded=Buffer.from(JSON.stringify(envelope));
  const parsed=await parseArenaHistoricalExportV2(encoded,digestBytes);
  if(encoded.byteLength>MAX_HISTORICAL_EXPORT_V2_BYTES||parsed.status!=='PRESENT_UNVERIFIED')
    throw new TypeError('EXPORT_INPUT_INVALID');
  return envelope;
}

function decodeBase64(value){
  if(value===null)return null;
  if(typeof value!=='string'||value.length>Math.ceil(MAX_HISTORICAL_RESULT_V2_BYTES*4/3)+4||
     value.length%4!==0||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
    throw new TypeError('EXPORT_INPUT_INVALID');
  const bytes=Buffer.from(value,'base64');
  if(bytes.length>MAX_HISTORICAL_RESULT_V2_BYTES||bytes.toString('base64')!==value)
    throw new TypeError('EXPORT_INPUT_INVALID');
  return new Uint8Array(bytes);
}

async function readStdinBounded(){
  const chunks=[];
  let total=0;
  for await(const chunk of process.stdin){
    total+=chunk.byteLength;
    if(total>MAX_HISTORICAL_EXPORT_V2_BYTES)throw new Error('EXPORT_INPUT_LIMIT');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks,total);
}

async function runCli(){
  if(process.argv.length!==2)throw new Error('EXPORT_ARGUMENTS_INVALID');
  const inputBytes=await readStdinBounded();
  let text;
  try{text=new TextDecoder('utf-8',{fatal:true}).decode(inputBytes);}
  catch{throw new Error('EXPORT_INPUT_INVALID');}
  const input=parseHistoricalExportV2Input(text);
  if(!input||Object.keys(input).length!==4||
     !['observation','resultBytesBase64','summaryBytesBase64','generatedFixture']
       .every(key=>Object.hasOwn(input,key)))throw new Error('EXPORT_INPUT_INVALID');
  const envelope=await exportHistoricalResultV2({
    observation:input.observation,
    resultBytes:decodeBase64(input.resultBytesBase64),
    summaryBytes:decodeBase64(input.summaryBytesBase64),
    generatedFixture:input.generatedFixture
  });
  const output=Buffer.from(JSON.stringify(envelope));
  if(output.byteLength>MAX_HISTORICAL_EXPORT_V2_BYTES)throw new Error('EXPORT_INPUT_LIMIT');
  process.stdout.write(output);
}

const invokedPath=process.argv[1]?pathToFileURL(path.resolve(process.argv[1])).href:null;
if(invokedPath===import.meta.url){
  runCli().catch(error=>{
    const code=EXPORT_ERRORS.has(error?.message)?error.message:'EXPORT_IO_FAILED';
    process.stderr.write(`ERROR ${code}\n`);
    process.exitCode=1;
  });
}
