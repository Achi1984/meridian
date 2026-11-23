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
