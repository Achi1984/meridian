// Small in-process serializer for read-modify-write state transitions.
export function createSerialQueue(){
  let tail=Promise.resolve();
  return task=>{
    if(typeof task!=='function')return Promise.reject(new TypeError('task must be a function'));
    const run=tail.then(task,task);
    tail=run.catch(()=>{});
    return run;
  };
}

export function createSingleFlight(){
  let active=null;
  return task=>{
    if(active)return active;
    if(typeof task!=='function')return Promise.reject(new TypeError('task must be a function'));
    active=Promise.resolve().then(task).finally(()=>{active=null;});
    return active;
  };
}
