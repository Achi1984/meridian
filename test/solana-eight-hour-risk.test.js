import assert from 'node:assert/strict';
import {test} from 'node:test';
import {accountRows} from '../v11/solana-eight-hour.js';

function comparison(fields) {
  const account = {cashUsdc:1007, equityUsdc:null, realizedUsdc:7, closedTrades:3,
    openPositions:[{}], ...fields};
  return accountRows({startedAt:1, endsAt:28801, updatedAt:180,
    accounts:{A:account,B:account,C:account}})[0];
}

test('retains losses and exact zero after removing the highest earning mint', () => {
  for (const net of [-3,0,2]) {
    const row = comparison({realizedWithoutBestMintUsdc:net,sampledMaxDrawdownUsdc:0});
    assert.equal(row.withoutBest,net);
    assert.equal(row.drawdown,0);
    assert.equal(row.equity,null);
  }
});

test('distinguishes single-mint and legacy reports from zero', () => {
  assert.equal(comparison({realizedWithoutBestMintUsdc:null}).withoutBest,null);
  assert.equal(comparison({}).withoutBest,undefined);
  assert.equal(comparison({}).drawdown,undefined);
});

test('rejects invalid reported risk values', () => {
  assert.throws(()=>comparison({realizedWithoutBestMintUsdc:'7'}));
  assert.throws(()=>comparison({sampledMaxDrawdownUsdc:-1}));
});

test('refresh loads the run checkpoint and keeps it across a failed or older refresh', async () => {
  const {mountEightHourComparison} = await import('../v11/solana-eight-hour.js');
  const nodes = [];
  const add = (parent, tag, textContent) => {
    const node = {tag, textContent, children:[], setAttribute(){}, addEventListener(event, callback){this[event]=callback;},
      replaceChildren(){this.children=[]; this.textContent='';}};
    parent.children.push(node);
    nodes.push(node);
    return node;
  };
  const contents = node => [node, ...node.children.flatMap(contents)];
  const account = {cashUsdc:980, equityUsdc:null, realizedUsdc:0, closedTrades:0,
    openPositions:[{}], missingExitQuotes:2};
  const snapshot = {runId:45185444796, startedAt:1795440944, endsAt:1795469744,
    updatedAt:1795447068, accounts:{A:account,B:account,C:account}};
  const newSnapshot = {runId:45210142704, startedAt:1795449172, endsAt:1795477972, updatedAt:1795449172,
    accounts:Object.fromEntries(Object.entries({A:'trailing',B:'standard',C:'fixed'})
      .map(([name,policy])=>[name,{...account,policy}]))};
  let response = { ...newSnapshot, runId:45433341029, accounts:{...newSnapshot.accounts,
    D:{...account,policy:'staged'}, E:{...account,policy:'failedRecovery'},
    F:{...account,policy:'smallPoolFixed',realizedWithoutBestMintUsdc:2}}};
  let jobs = [];
  const read = async url => {
    if (url.includes('/workflows/')) return {workflow_runs:[{id:45433341029, status:'queued'}]};
    if (url.endsWith('/jobs')) return {jobs};
    return response;
  };
  const refresh = mountEightHourComparison({children:[]},add,read,String);
  await refresh();
  const status = nodes.find(node=>node.textContent === 'Achtstundenlauf · wartet');
  assert.ok(status);
  jobs = [{name:'first', status:'in_progress'}];
  await refresh();
  assert.equal(status.textContent,'Erste vier Stunden · läuft');
  const newReport = nodes.find(node=>node.tag==='div');
  assert.ok(contents(newReport).some(node=>node.textContent.includes('Nachlaufender Gewinnausstieg')));
  assert.equal(contents(newReport).filter(node=>node.scope==='row').length,6);
  assert.ok(contents(newReport).some(node=>node.textContent.includes('Ohne besten Token · 2')));
  response = snapshot;
  await refresh();
  assert.ok(contents(newReport).some(node=>node.textContent.includes('Nachlaufender Gewinnausstieg')));
  const select = nodes.find(node=>node.tag==='select');
  select.value = String(snapshot.runId);
  select.change();
  await refresh();
  const report = nodes.filter(node=>node.tag==='div').at(-1);
  assert.ok(contents(report).some(node=>node.textContent.includes('Soforteinstieg')));
  assert.equal(contents(report).filter(node=>node.scope==='row').length,3);
  assert.ok(!contents(report).some(node=>node.textContent.includes('Positionsgröße')));
  const detail = nodes.filter(node=>node.tag==='details').at(-1);
  assert.ok(!detail.open);
  assert.ok(contents(detail).some(node=>node.textContent.includes('Positionsgröße · 2')));
  assert.ok(contents(detail).some(node=>node.textContent==='Kontowert A gegenüber B · Bewertung offen'));
  response = {...snapshot, updatedAt:snapshot.updatedAt+1, accounts:{
    A:{...account,equityUsdc:990}, B:{...account,equityUsdc:1000}, C:{...account,equityUsdc:1025}}};
  await refresh();
  assert.ok(contents(detail).some(node=>node.textContent==='Kontowert A gegenüber B · -10'));
  assert.ok(contents(detail).some(node=>node.textContent==='Kontowert C gegenüber B · 25'));
  const original = [...report.children];
  response = { ...snapshot, runId:1 };
  await refresh();
  assert.deepEqual(report.children,original);
  response = { ...snapshot, updatedAt:snapshot.updatedAt-1 };
  await refresh();
  assert.deepEqual(report.children,original);
});

test('requires cash and equity to agree when no position is open', () => {
  for (const equityUsdc of [null, 1200]) {
    assert.throws(() => comparison({openPositions:[], cashUsdc:1000, equityUsdc}));
  }
  assert.equal(comparison({openPositions:[], cashUsdc:1000, equityUsdc:1000}).equity,1000);
});
