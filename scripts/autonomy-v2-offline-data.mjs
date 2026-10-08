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
