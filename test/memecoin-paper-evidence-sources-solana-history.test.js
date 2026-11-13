import test from "node:test";
import assert from "node:assert/strict";
import {collectSolanaSwapHistory,SOLANA_HISTORY_SCHEMA,SOLANA_RPC_ORIGIN} from "../scripts/memecoin-paper/evidence-sources/solana-history.mjs";

const mint="So11111111111111111111111111111111111111112";
const pool="Pool11111111111111111111111111111111111111111";
const vault="Vault1111111111111111111111111111111111111111";
const user="User11111111111111111111111111111111111111111";

function response(id,result){return {jsonrpc:"2.0",id,result};}
function transportFixture(t,tx={}) {
  let calls=0;
  t.calls=()=>calls;
  return async request => {
    calls++;
    assert.equal(request.url,SOLANA_RPC_ORIGIN);
    assert.equal(request.method,"POST");
    const body=JSON.parse(request.body);
    if(body.method==="getSignaturesForAddress") return {url:SOLANA_RPC_ORIGIN,text:async()=>JSON.stringify(response(body.id,[{signature:"sig1",slot:10,err:null}]))};
    return {url:SOLANA_RPC_ORIGIN,text:async()=>JSON.stringify(response(body.id,{slot:10,blockTime:1_700_000_000,transaction:{message:{accountKeys:[{pubkey:pool}] }},meta:{err:null,logMessages:["Program log: raydium swap"],preTokenBalances:[{accountIndex:0,mint,owner:vault,uiTokenAmount:{amount:"100",decimals:6}},{accountIndex:1,mint,owner:user,uiTokenAmount:{amount:"0",decimals:6}}],postTokenBalances:[{accountIndex:0,mint,owner:vault,uiTokenAmount:{amount:"90",decimals:6}},{accountIndex:1,mint,owner:user,uiTokenAmount:{amount:"10",decimals:6}}]},...tx}))};
  };
}
test("disabled by default and never accesses network",async()=>{let called=false; const r=await collectSolanaSwapHistory({transport:()=>{called=true}}); assert.equal(r.status,"DISABLED"); assert.equal(called,false);});
test("decodes bounded Raydium swap evidence with provenance and no execution authority",async t=>{const r=await collectSolanaSwapHistory({enabled:true,mint,pool,selectedMintVault:vault,launchWindow:{from:1_600_000_000,to:1_800_000_000},transport:transportFixture(t),clock:()=>1_700_000_001}); assert.equal(r.status,"COLLECTED"); assert.equal(r.schemaVersion,SOLANA_HISTORY_SCHEMA); assert.equal(r.observations.length,1); assert.equal(r.observations[0].direction,"BUY"); assert.equal(r.observations[0].baseAmountRaw,"10"); assert.equal(r.executionAuthorized,false); assert.equal(r.sourceAuthentication,"NOT_ESTABLISHED");});
test("returns UNKNOWN for malformed, redirected or cancelled sources",async t=>{const bad=async req=>({url:"https://evil.invalid",text:async()=>JSON.stringify(response(1,[]))}); assert.equal((await collectSolanaSwapHistory({enabled:true,mint,pool,launchWindow:{from:0,to:2_000_000_000},transport:bad})).status,"UNKNOWN"); const controller=new AbortController(); controller.abort(); assert.equal((await collectSolanaSwapHistory({enabled:true,mint,pool,launchWindow:{from:0,to:2_000_000_000},signal:controller.signal,transport:transportFixture(t)})).status,"UNKNOWN");});
test("unsupported swaps remain excluded without claiming completeness",async t=>{const r=await collectSolanaSwapHistory({enabled:true,mint,pool,selectedMintVault:vault,launchWindow:{from:1_600_000_000,to:1_800_000_000},transport:transportFixture(t,{meta:{logMessages:["unknown program"]}})}); assert.equal(r.status,"COLLECTED"); assert.equal(r.evidence.complete,false);});
