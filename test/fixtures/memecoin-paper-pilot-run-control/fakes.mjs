export function createFakeRuntime(startAt = 1_000) {
  let now = startAt;
  let nextTimerId = 0;
  const timers = new Map();
  const scheduler = {
    setTimeout(callback, delay) {
      const id = ++nextTimerId;
      timers.set(id, {callback, at: now + delay});
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    }
  };
  return {
    clock: () => now,
    scheduler,
    setNow(value) {
      now = value;
    },
    pendingTimers() {
      return timers.size;
    },
    async advance(milliseconds) {
      now += milliseconds;
      while (true) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= now)
          .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0];
        if (!due) break;
        timers.delete(due[0]);
        due[1].callback();
        await flushMicrotasks();
      }
      await flushMicrotasks();
    }
  };
}

export async function flushMicrotasks(turns = 30) {
  for (let index = 0; index < turns; index += 1) await Promise.resolve();
}

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return {promise, resolve, reject};
}

export function createTrackedSignal() {
  const listeners = new Set();
  return {
    aborted: false,
    addEventListener(type, listener) {
      if (type === "abort") listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === "abort") listeners.delete(listener);
    },
    abort() {
      if (this.aborted) return;
      this.aborted = true;
      for (const listener of [...listeners]) listener({type: "abort"});
      listeners.clear();
    },
    listenerCount() {
      return listeners.size;
    }
  };
}

export function createFakeCallbacks(overrides = {}) {
  const calls = [];
  let acquisitionIndex = 0;
  let checkpointSequence = 0;
  const callbacks = {
    acquire(input) {
      calls.push({name: "acquire", input});
      const cycle = acquisitionIndex++;
      return {
        evidenceSource: input.evidenceSource,
        events: [{synthetic: true, id: `event-${cycle}`}],
        requestsUsed: 1,
        done: false
      };
    },
    step(input) {
      calls.push({name: "step", input});
      return {unresolvedPositions: [{source: "synthetic callback evidence", eventId: input.event.id}]};
    },
    checkpoint(input) {
      calls.push({name: "checkpoint", input});
      checkpointSequence = Math.max(checkpointSequence, input.cycleIndex + 1);
      return {
        status: "ACKNOWLEDGED",
        sequence: checkpointSequence,
        hash: checkpointSequence.toString(16).padStart(64, "0")
      };
    },
    report(input) {
      calls.push({name: "report", input});
    }
  };
  for (const name of Object.keys(overrides)) {
    const original = callbacks[name];
    callbacks[name] = input => {
      calls.push({name, input});
      const result = overrides[name](input, {calls, original});
      const labelAcquisition = value => name === "acquire" && value && typeof value === "object" &&
        !Object.hasOwn(value, "evidenceSource")
        ? {...value, evidenceSource: input.evidenceSource}
        : value;
      if (result && typeof result.then === "function") return result.then(labelAcquisition);
      return labelAcquisition(result);
    };
  }
  return {callbacks, calls};
}
