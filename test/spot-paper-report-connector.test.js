import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createSpotPaperReportConnector} from '../v11/spot-paper-report-connector.js';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}

for (const mode of ['read', 'cancel']) {
  for (const stop of ['timeout', 'dispose']) {
    test(`spot-paper connector holds its reservation through stalled ${mode} after ${stop}`, async () => {
      const readStarted = deferred();
      const cancelStarted = deferred();
      const readSettlement = deferred();
      const cancelSettlement = deferred();
      let transports = 0;
      const connector = createSpotPaperReportConnector({
        enabled: true,
        timeoutMs: 20,
        transport: async () => {
          transports++;
          return {
            status: 200,
            ok: true,
            headers: {get: name => name === 'content-type' ? 'application/json' : null},
            body: {
              getReader: () => ({
                read() {
                  readStarted.resolve();
                  return mode === 'read' ? readSettlement.promise : Promise.resolve({done: true});
                },
                cancel() {
                  cancelStarted.resolve();
                  return cancelSettlement.promise;
                },
                releaseLock() {}
              })
            }
          };
        }
      });

      const pending = connector.read();
      await readStarted.promise;
      if (mode === 'cancel') await cancelStarted.promise;
      if (stop === 'dispose') connector.dispose();
      const result = await pending;
      assert.equal(result.status, stop === 'dispose' ? 'DISPOSED' : 'TIMEOUT');
      assert.equal(result.report, null);
      assert.equal(connector.isBusy(), true);
      if (stop === 'timeout') assert.equal((await connector.read()).status, 'BUSY');
      else assert.equal((await connector.read()).status, 'DISPOSED');
      assert.equal(transports, 1, 'a pending body pipeline cannot start a second transport');

      if (mode === 'read') readSettlement.resolve({done: true});
      cancelSettlement.resolve();
      for (let attempt = 0; attempt < 20 && connector.isBusy(); attempt++) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      assert.equal(connector.isBusy(), false, 'late body/cancellation settlement releases the slot');
      assert.equal(transports, 1);
      assert.equal(result.report, null, 'late settlement never changes the already returned result');
    });
  }
}
