import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { isValidSpotPaperPairedExpectedIdentity } from
  "../scripts/spot-paper-paired-report/evaluate.mjs";

const receiptRoot = "../docs/operations/receipts";
const identityName = "btc-eur-paired-diag-20261110-001";

test("diagnostic candidate exposes the unchanged, valid host identity", async t => {
  const wrapper = JSON.parse(await readFile(
    new URL(`${receiptRoot}/${identityName}.identity.json`, import.meta.url), "utf8"
  ));
  const expectedIdentity = JSON.parse(await readFile(
    new URL(`${receiptRoot}/${identityName}.expected-identity.json`, import.meta.url),
    "utf8"
  ));
  const dataRoot = await mkdtemp(join(tmpdir(), "paired-identity-validation-"));
  t.after(() => rm(dataRoot, {recursive: true, force: true}));

  const rawHostIdentity = JSON.parse(execFileSync(process.execPath, [
    "scripts/spot-paper-paired/host.mjs",
    "identity",
    "--data-root", dataRoot,
    "--run-id", "btc-eur-paired-diag-20261110-001",
    "--account-contract", "BTC_EUR_PAIRED_PAPER_EEA_SPOT_V2",
    "--model-pair", "BTC_EUR_CONFIRM2_VS_5M_TREND_AND_CASH_V1"
  ], {encoding: "utf8"}));

  assert.deepEqual(wrapper.identity, rawHostIdentity);
  assert.deepEqual(expectedIdentity, rawHostIdentity);
  assert.equal(isValidSpotPaperPairedExpectedIdentity(expectedIdentity), true);
  assert.equal(wrapper.preservedSelection.accountContractId,
    "BTC_EUR_PAIRED_PAPER_EEA_SPOT_V2");
  assert.deepEqual(await readdir(dataRoot), []);
});
