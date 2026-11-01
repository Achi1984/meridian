import {readFile} from "node:fs/promises";

const fixtureRoot = new URL("../memecoin-paper-provider-evidence/", import.meta.url);
const files = Object.freeze({
  getAccountInfo: "get-account-info.json",
  getTokenLargestAccounts: "get-largest-accounts.json",
  getTokenSupply: "get-token-supply.json"
});

async function loadFixture(file) {
  return JSON.parse(await readFile(new URL(file, fixtureRoot), "utf8"));
}

export async function createSyntheticProviderFetch(identity, {mismatchPair = false} = {}) {
  const [dexPair, accountInfo, largestAccounts, tokenSupply] = await Promise.all([
    loadFixture("dex-pair.json"),
    loadFixture(files.getAccountInfo),
    loadFixture(files.getTokenLargestAccounts),
    loadFixture(files.getTokenSupply)
  ]);
  const fixtures = {getAccountInfo: accountInfo, getTokenLargestAccounts: largestAccounts,
    getTokenSupply: tokenSupply};
  let calls = 0;
  const fetch = async (url, init) => {
    calls += 1;
    let payload;
    if (url.startsWith("https://api.dexscreener.com/")) {
      payload = structuredClone(dexPair);
      payload.pairs[0].baseToken.address = mismatchPair ? "EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE" : identity.mint;
      payload.pairs[0].pairAddress = identity.pool;
      payload.pairs[0].quoteToken.address = identity.quote;
    } else {
      const request = JSON.parse(init.body);
      const fixture = fixtures[request.method];
      if (!fixture) throw new Error(`unexpected synthetic RPC method: ${request.method}`);
      payload = structuredClone(fixture);
      payload.id = request.id;
    }
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {"content-type": "application/json"}
    });
  };
  return {fetch, get calls() { return calls; }};
}
