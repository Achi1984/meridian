// Plain snapshot/argument records only. This is not a sandbox for hostile JS proxies.
export function isOfflineDataRecord(value) {
  if(value===null||typeof value!=='object'||Array.isArray(value)||
    ![Object.prototype,null].includes(Object.getPrototypeOf(value))) return false;
  return Reflect.ownKeys(value).every(key=>{
    if(typeof key!=='string') return false;
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    return Boolean(descriptor?.enumerable&&Object.hasOwn(descriptor,'value'));
  });
}

/** Dense ordinary JSON arrays; inspect descriptors without invoking index getters. */
export function isOfflineDataArray(value) {
  if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype) return false;
  const length=Object.getOwnPropertyDescriptor(value,'length');
  if(!length||!Object.hasOwn(length,'value')||!Number.isSafeInteger(length.value)||length.value<0) return false;
  const keys=Reflect.ownKeys(value);
  // Comparing own-key count also rejects huge sparse arrays without walking holes.
  if(keys.length!==length.value+1) return false;
  return keys.every(key=>{
    if(key==='length') return true;
    if(typeof key!=='string'||!/^(?:0|[1-9][0-9]*)$/.test(key)||Number(key)>=length.value) return false;
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    return Boolean(descriptor?.enumerable&&Object.hasOwn(descriptor,'value'));
  });
}
