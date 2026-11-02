import {decodeMintSafetyEvidence} from "./decode.mjs";

const RPC_URL = "https://api.mainnet-beta.solana.com";
const DECIMAL_INTEGER = /^(0|[1-9]\d{0,39})$/;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validTime(value) {
  return Number.isSafeInteger(value) && value >= 0 && Number.isFinite(new Date(value).getTime());
}

function requestMint(outcome, kind, identity) {
  const request = outcome?.request;
  if (!isRecord(request) || request.provider !== "rpc" || request.kind !== kind ||
      request.method !== "POST" || request.url !== RPC_URL || !Number.isSafeInteger(request.id) ||
      typeof request.body !== "string" || request.body.length > 512 ||
      request.requested?.chainId !== identity.chainId ||
      request.requested?.mint !== identity.mint ||
      request.requested?.pool !== identity.pool ||
      request.requested?.quote !== identity.quote) {
    return null;
  }
  try {
    const body = JSON.parse(request.body);
    if (body.jsonrpc !== "2.0" || body.id !== request.id || body.method !== kind ||
        !Array.isArray(body.params) || body.params[0] !== identity.mint ||
        body.params[1]?.commitment !== "finalized" ||
        (kind === "getAccountInfo" && body.params[1]?.encoding !== "base64")) {
      return null;
    }
  } catch {
    return null;
  }
  return identity.mint;
}

function unavailableFacts(reason) {
  const fact = () => ({state: "UNKNOWN", value: null, reason});
  return {
    mintAuthorityRevoked: fact(),
    freezeAuthorityRevoked: fact(),
    tokenExtensions: fact(),
    tokenDecimals: fact()
  };
}

function decodeInput(identity, accountInfo, requestedMint) {
  const result = accountInfo?.value?.result;
  return decodeMintSafetyEvidence({
    chainId: identity?.chainId,
    expectedMint: identity?.mint,
    requestedMint,
    accountPubkey: requestedMint,
    observedAt: accountInfo?.receivedAt,
    rpcResult: result
  });
}

function unboundResult(decoded, reasonCodes) {
  const reasons = [...new Set(reasonCodes)];
  const reason = reasons.join("; ") || "MINT_SAFETY_SOURCE_BINDING_UNAVAILABLE";
  return {
    status: "UNBOUND",
    reasonCodes: reasons,
    decoded,
    facts: unavailableFacts(reason),
    authorizationEligible: false,
    hardGateEligible: false
  };
}

export function bridgeMintSafetyEvidence({
  identity,
  accountInfo,
  supply,
  sampledAt,
  maxAcquisitionDurationMs
}) {
  const accountMint = requestMint(accountInfo, "getAccountInfo", identity ?? {});
  const supplyMint = requestMint(supply, "getTokenSupply", identity ?? {});
  const decoded = decodeInput(identity ?? {}, accountInfo, accountMint);
  const reasons = [];

  if (!accountMint) reasons.push("GET_ACCOUNT_INFO_REQUEST_NOT_BOUND_TO_CANDIDATE");
  if (!supplyMint) reasons.push("GET_TOKEN_SUPPLY_REQUEST_NOT_BOUND_TO_CANDIDATE");
  if (!accountInfo?.value?.result || !supply?.value?.result) {
    reasons.push("MINT_ACCOUNT_OR_TOKEN_SUPPLY_RESPONSE_MISSING");
  }
  if (!Number.isSafeInteger(maxAcquisitionDurationMs) || maxAcquisitionDurationMs < 0 ||
      !validTime(sampledAt) || !validTime(accountInfo?.receivedAt) || !validTime(supply?.receivedAt) ||
      sampledAt < accountInfo?.receivedAt || sampledAt < supply?.receivedAt ||
      sampledAt - accountInfo?.receivedAt > maxAcquisitionDurationMs ||
      sampledAt - supply?.receivedAt > maxAcquisitionDurationMs ||
      Math.abs(accountInfo?.receivedAt - supply?.receivedAt) > maxAcquisitionDurationMs) {
    reasons.push("MINT_SAFETY_RECEIPT_TIME_OUTSIDE_ACQUISITION_WINDOW");
  }
  if (!Number.isSafeInteger(accountInfo?.slot) || accountInfo.slot < 0 ||
      !Number.isSafeInteger(supply?.slot) || supply.slot < 0 ||
      accountInfo?.value?.result?.context?.slot !== accountInfo?.slot ||
      supply?.value?.result?.context?.slot !== supply?.slot) {
    reasons.push("MINT_SAFETY_RPC_SLOT_INVALID");
  } else if (accountInfo.slot !== supply.slot) {
    reasons.push("MINT_ACCOUNT_AND_TOKEN_SUPPLY_SLOT_MISMATCH");
  }
  if (decoded.status !== "DECODED_UNVERIFIED") {
    reasons.push(...decoded.reasonCodes);
  }

  const supplyValue = supply?.value?.result?.value;
  const supplyAmount = supplyValue?.amount;
  const supplyDecimals = supplyValue?.decimals;
  const decodedMint = decoded.mint;
  let amountMismatch = false;
  let decimalsMismatch = false;
  if (!isRecord(supplyValue) || typeof supplyAmount !== "string" ||
      !DECIMAL_INTEGER.test(supplyAmount) || !Number.isInteger(supplyDecimals) ||
      supplyDecimals < 0 || supplyDecimals > 18) {
    reasons.push("TOKEN_SUPPLY_VALUE_INVALID");
  } else if (decoded.status === "DECODED_UNVERIFIED") {
    amountMismatch = BigInt(supplyAmount).toString() !== decodedMint.supplyAtoms;
    decimalsMismatch = supplyDecimals !== decodedMint.decimals;
    if (amountMismatch) reasons.push("TOKEN_SUPPLY_AMOUNT_MISMATCH");
    if (decimalsMismatch) reasons.push("TOKEN_SUPPLY_DECIMALS_MISMATCH");
  }

  if (reasons.length > 0) {
    const result = unboundResult(decoded, reasons);
    if (amountMismatch || decimalsMismatch) {
      result.facts.tokenDecimals = {
        state: "UNKNOWN",
        value: null,
        reason: [...(amountMismatch ? ["TOKEN_SUPPLY_AMOUNT_MISMATCH"] : []),
          ...(decimalsMismatch ? ["TOKEN_SUPPLY_DECIMALS_MISMATCH"] : [])].join("; ")
      };
    }
    return result;
  }

  const restrictions = decoded.extensions.restrictions;
  const fact = value => ({state: "FILTER_USABLE", value, reason: null});
  return {
    status: "SOURCE_BOUND",
    reasonCodes: [],
    decoded,
    sourceBinding: {
      chainId: identity.chainId,
      mint: identity.mint,
      ownerProgram: decoded.binding.ownerProgram,
      slot: decoded.binding.slot,
      observedAt: decoded.binding.observedAt,
      supplySlot: supply.slot,
      supplyObservedAt: supply.receivedAt,
      supplyAmountAtoms: supplyAmount,
      supplyDecimals
    },
    facts: {
      mintAuthorityRevoked: fact(decoded.authorities.mint.revoked),
      freezeAuthorityRevoked: fact(decoded.authorities.freeze.revoked),
      tokenExtensions: fact({
        transferFee: restrictions.transferFeeConfig.configuredNonzeroFee === true,
        transferHook: restrictions.transferHook.hookProgramConfigured === true,
        defaultFrozen: restrictions.defaultAccountState.newAccountsDefaultFrozen === true,
        permanentDelegate: restrictions.permanentDelegate.delegateState === "PRESENT"
      }),
      tokenDecimals: fact(supplyDecimals)
    },
    authorizationEligible: false,
    hardGateEligible: false
  };
}
