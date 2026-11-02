import {
  LAUNCH_HISTORY_SOURCE_VERSION
} from "./launch-history-source.mjs";

export const LAUNCH_HISTORY_CLASSIFIER_VERSION = "solana-spl-token-attribution-v1";
export const LAUNCH_HISTORY_RISK_PREDICATE_VERSION = "solana-launch-risk-observation-v1";
export const CLASSIC_SPL_TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MAX_TRANSACTIONS = 10_000;
const MAX_INSTRUCTIONS = 50_000;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function supportedInstruction(instruction, names) {
  return isRecord(instruction) &&
    instruction.programId === CLASSIC_SPL_TOKEN_PROGRAM_ID &&
    isRecord(instruction.parsed) &&
    names.includes(instruction.parsed.type) &&
    isRecord(instruction.parsed.info);
}

function instructionsFor(transaction) {
  const outer = transaction.transaction?.message?.instructions;
  const innerGroups = transaction.meta?.innerInstructions;
  if (!Array.isArray(outer)) return [];
  const instructions = [...outer];
  if (Array.isArray(innerGroups)) {
    for (const group of innerGroups) {
      if (Array.isArray(group?.instructions)) instructions.push(...group.instructions);
    }
  }
  return instructions;
}

function validKey(value) {
  return typeof value === "string" && BASE58.test(value);
}

function sourceCoverage(history, mint) {
  const subject = history.declaredSubjects.find(item => item.address === mint);
  return {
    sourceComplete: history.coverage.complete === true,
    subjectDeclared: Boolean(subject),
    subjectEvidenceId: subject?.evidenceId ?? null,
    interval: history.slotInterval,
    scope: "declared-subjects-and-inclusive-slot-interval-only"
  };
}

export function classifyLaunchHistory({history, mint}) {
  if (!isRecord(history) || history.sourceVersion !== LAUNCH_HISTORY_SOURCE_VERSION ||
      !Array.isArray(history.declaredSubjects) || !Array.isArray(history.transactions) ||
      !isRecord(history.coverage) ||
      !Number.isSafeInteger(history.slotInterval?.startInclusive) ||
      !Number.isSafeInteger(history.slotInterval?.endInclusive) ||
      history.slotInterval.startInclusive < 0 ||
      history.slotInterval.endInclusive < history.slotInterval.startInclusive ||
      !validKey(mint)) {
    throw new TypeError("a valid launch history receipt and mint are required");
  }
  if (history.transactions.length > MAX_TRANSACTIONS) {
    throw new TypeError("transaction set exceeds the classifier work limit");
  }
  const coverage = sourceCoverage(history, mint);
  const transactions = history.transactions.filter(item =>
    item?.status === "SUCCESS" &&
    Number.isSafeInteger(item.slot) &&
    item.slot >= history.slotInterval.startInclusive &&
    item.slot <= history.slotInterval.endInclusive);
  const instructionsByTransaction = [];
  let instructionCount = 0;
  for (const transaction of transactions) {
    const instructions = instructionsFor(transaction);
    instructionCount += instructions.length;
    if (instructionCount > MAX_INSTRUCTIONS) {
      throw new TypeError("instruction set exceeds the classifier work limit");
    }
    instructionsByTransaction.push({transaction, instructions});
  }

  const initialized = [];
  const mintTo = [];
  for (const {transaction, instructions} of instructionsByTransaction) {
    const owners = new Map();
    for (const instruction of instructions) {
      if (supportedInstruction(instruction,
        ["initializeAccount", "initializeAccount2", "initializeAccount3"])) {
        const info = instruction.parsed.info;
        if (info.mint === mint && validKey(info.account) && validKey(info.owner)) {
          owners.set(info.account, info.owner);
        }
      }
    }
    for (const instruction of instructions) {
      if (supportedInstruction(instruction, ["initializeMint", "initializeMint2"])) {
        const info = instruction.parsed.info;
        if (info.mint === mint && validKey(info.mintAuthority)) {
          initialized.push({
            mint,
            mintAuthority: info.mintAuthority,
            decimals: Number.isSafeInteger(info.decimals) ? info.decimals : null,
            freezeAuthority: validKey(info.freezeAuthority) ? info.freezeAuthority : null,
            signature: transaction.signature,
            slot: transaction.slot
          });
        }
      }
      if (supportedInstruction(instruction, ["mintTo", "mintToChecked"])) {
        const info = instruction.parsed.info;
        const amount = info.tokenAmount?.amount ?? info.amount;
        if (info.mint === mint && validKey(info.account) &&
            typeof amount === "string" && /^(?:0|[1-9]\d{0,39})$/.test(amount)) {
          mintTo.push({
            mint,
            tokenAccount: info.account,
            tokenAccountOwner: owners.get(info.account) ?? null,
            amountAtoms: amount,
            mintAuthority: validKey(info.authority) ? info.authority : null,
            signature: transaction.signature,
            slot: transaction.slot
          });
        }
      }
    }
  }
  initialized.sort((left, right) => left.slot - right.slot ||
    left.signature.localeCompare(right.signature));
  mintTo.sort((left, right) => left.slot - right.slot ||
    left.signature.localeCompare(right.signature));

  const authorityKeys = [...new Set(initialized.map(item => item.mintAuthority))];
  const creatorOfRecord = authorityKeys.length === 1
    ? {
      status: "OBSERVED",
      mint,
      authorityAtInitialization: authorityKeys[0],
      instruction: "initializeMint-or-initializeMint2",
      programId: CLASSIC_SPL_TOKEN_PROGRAM_ID,
      evidenceTxids: [...new Set(initialized.map(item => item.signature))],
      semantics: "initial mint authority only; not a developer roster or beneficial-owner claim"
    }
    : {
      status: "UNKNOWN",
      reason: authorityKeys.length > 1
        ? "conflicting supported mint-initialization observations"
        : "no supported mint-initialization observation in the declared evidence"
    };

  const verifiedRelations = [];
  if (creatorOfRecord.status === "OBSERVED") {
    verifiedRelations.push({
      from: mint,
      relation: "INITIAL_MINT_AUTHORITY",
      to: creatorOfRecord.authorityAtInitialization,
      evidenceTxids: creatorOfRecord.evidenceTxids,
      basis: "classic SPL Token initializeMint instruction facts"
    });
  }
  for (const item of mintTo) {
    verifiedRelations.push({
      from: mint,
      relation: "MINTED_TO_TOKEN_ACCOUNT",
      to: item.tokenAccount,
      amountAtoms: item.amountAtoms,
      evidenceTxids: [item.signature],
      basis: "classic SPL Token mintTo instruction facts"
    });
    if (item.tokenAccountOwner) {
      verifiedRelations.push({
        from: item.tokenAccount,
        relation: "TOKEN_ACCOUNT_OWNER_AT_INITIALIZATION",
        to: item.tokenAccountOwner,
        evidenceTxids: [item.signature],
        basis: "classic SPL Token initializeAccount instruction facts"
      });
    }
  }

  const slotGroups = new Map();
  for (const item of mintTo) {
    const group = slotGroups.get(item.slot) ?? [];
    group.push(item.signature);
    slotGroups.set(item.slot, group);
  }
  const launchObservations = [...slotGroups.entries()]
    .sort(([left], [right]) => left - right)
    .map(([slot, txids]) => ({
      slot,
      transactionIds: [...new Set(txids)].sort(),
      observation: "multiple-or-single mint-to transactions observed at this slot",
      bundleClassification: "UNKNOWN",
      uncertainty: "same-slot observation does not establish one Jito bundle or common control"
    }));

  const riskFindings = creatorOfRecord.status === "OBSERVED" &&
    creatorOfRecord.authorityAtInitialization !== null
    ? [{
      findingId: "INITIAL_MINT_AUTHORITY_SET",
      status: "POSITIVE_FACT",
      predicateVersion: LAUNCH_HISTORY_RISK_PREDICATE_VERSION,
      subject: mint,
      attributedAddress: creatorOfRecord.authorityAtInitialization,
      evidenceTxids: creatorOfRecord.evidenceTxids,
      uncertainty: [
        "records the initialization authority only, not current authority state",
        "does not establish who controls the address or imply intent to rug",
        "history completeness is limited to declared subjects and the declared slot interval"
      ]
    }]
    : [];

  return {
    classifierVersion: LAUNCH_HISTORY_CLASSIFIER_VERSION,
    riskPredicateVersion: LAUNCH_HISTORY_RISK_PREDICATE_VERSION,
    supportedProgram: {
      name: "Solana classic SPL Token Program",
      programId: CLASSIC_SPL_TOKEN_PROGRAM_ID,
      instructionSemantics: "officially documented initializeMint and mintTo instruction facts"
    },
    identity: {chainId: "solana", mint},
    coverage,
    creatorOfRecord,
    initialMintToObservations: {
      status: mintTo.length ? "OBSERVED_FACTS_NOT_COMPLETE_SET" : "UNKNOWN",
      recipients: mintTo,
      completeSet: false,
      reason: "initial-recipient scope/window is unapproved; observations are not a complete recipient census"
    },
    verifiedRelations,
    inferredCommonControl: {
      status: "UNKNOWN",
      relations: [],
      reason: "no common-control inference is made from co-occurrence, shared slots, or pool creation"
    },
    launchObservations,
    bundleMetric: {
      status: "UNKNOWN",
      value: null,
      reason: "same-slot transaction observations are not a Jito bundle classifier"
    },
    riskFindings,
    priorRugFinding: {
      status: "UNKNOWN",
      value: null,
      reason: "no reviewed developer scope, complete history interval, or rug predicate is approved"
    },
    priceDropFinding: {
      status: "NOT_EVALUATED",
      value: null,
      reason: "price changes are outside the transaction facts available to this classifier"
    },
    completenessDecision: coverage.sourceComplete
      ? "COMPLETE_ONLY_FOR_DECLARED_SUBJECTS_AND_SLOT_INTERVAL"
      : "INCOMPLETE_HISTORY_CANNOT_SUPPORT_A_CLEAN_NEGATIVE"
  };
}
