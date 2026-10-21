import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {canonicalJson, sha256} from './engine.mjs';
import {ASSETS, INPUT} from './validate.mjs';
import {
  HISTORICAL_RUN_PROFILE, deriveHistoricalProfile, historicalProfileSha256,
  verifyHistoricalSourcePins
} from './historical-profile.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const OUTPUT_PATH = path.join(ROOT, 'docs/research/d2-candidate/admission-candidate.json');
const HASH = /^[a-f0-9]{64}$/;
const D1_PATH_PREFIX = 'research/acquisitions/kraken-usd-daily-20261018/normalized';
const D1_SOURCE_COMMIT = '1c7b6dccd886f57e866c7d359c091b1e72a193ea';
const ACCEPTED_D1_VERIFICATION_SHA256 =
  '223548051320d00866666d87b1b543243fecf9d1a5ca647be2d7a09d0b1f0f05';
const ACCEPTED_D1_MANIFEST_DRAFT_SHA256 =
  '37fecaa0d003c9ec862fb57b3b312c0289c1dd370607ade99bac584d357f81a9';
const METADATA_FILES = Object.freeze({
  d1Verification: 'docs/research/d1-20261019/verification.json',
  d1Readme: 'docs/research/d1-20261019/README.md',
  d1VerifierArchive: 'docs/research/d1-20261019/executed-verifier.mjs.txt',
  inactiveProfileJson: 'scripts/research-supervisor/historical_run_profile.json',
  pathBridgeManifest: 'scripts/research-supervisor/b1_bridge_manifest.json',
  protocolJson: 'research/protocols/b1-7-20261018/protocol.json',
  candidateBuilder: 'scripts/research/b1-7/prepare-d2-candidate.mjs'
});
const SOURCE_FILES = Object.freeze({
  engine: 'scripts/research/b1-7/engine.mjs',
  validator: 'scripts/research/b1-7/validate.mjs',
  loader: 'scripts/research/b1-7/captured-input.mjs',
  protocol: 'research/protocols/b1-7-20261018/protocol.json',
  bridge: 'scripts/research-supervisor/b1_bridge_manifest.json',
  admission: 'scripts/research/b1-7/historical-admission.mjs',
  profile: 'scripts/research/b1-7/historical-profile.mjs',
  adapter: 'scripts/research-supervisor/historical_adapter.mjs',
  adapterRuntime: 'scripts/research-supervisor/b1_adapter.mjs',
  supervisor: 'scripts/research-supervisor/supervisor.py',
  journal: 'scripts/research-supervisor/journal.py'
});
const ACCEPTED_RECEIPTS = Object.freeze({
  sourceAndProfile: {
    sourceAcceptanceComment: 6255139258,
    profileAcceptanceComment: 6275925635,
    profileMergeComment: 6275930095,
    profileMergeCommit: '6bcaa74b35a7c093e67f144a03f82a6d77cdf9be'
  },
  d1: {
    issue: 895,
    authorizationComment: 6271123620,
    technicalClosureComment: 6272425721,
    evidenceMergeCommit: 'fe3646378c419493e7581ac9692eb1cf68bb7422'
  },
  acceptedReadinessSource: {
    pullRequest: 919,
    sourceAcceptedHead: '569a636e9311485cbbcd420cd9119b8e3f711026',
    sourceAcceptanceComment: 6299005779,
    integratedSourceSnapshotHead: '7990bbf328edd7eb4975d1f389241cbe873aa1a3',
    integrationReceiptComment: 6299137712,
    laterScopeExpansionComment: 6323534494,
    laterScopeReview: 'PENDING'
  }
});

function fail(code) {
  throw new Error(code);
}

function exactObject(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) &&
    canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}

function digest(value) {
  return typeof value === 'string' && HASH.test(value);
}

function validateProfile(profile, sourceByteHashes) {
  if (!profile || profile.status !== 'NOT_FROZEN' || profile.inputManifest !== null ||
      profile.approvalReceipt !== null || profile.sourceCommit !== D1_SOURCE_COMMIT) {
    fail('HISTORICAL_PROFILE_NOT_INACTIVE');
  }
  if (!exactObject(profile.sourceFiles, Object.keys(SOURCE_FILES)) ||
      Object.entries(SOURCE_FILES).some(([name, relative]) => profile.sourceFiles[name] !== relative)) {
    fail('HISTORICAL_SOURCE_FILE_PIN_MISMATCH');
  }
  const sourceNames = Object.keys(SOURCE_FILES);
  if (!exactObject(profile.sourceSha256, sourceNames) ||
      !exactObject(sourceByteHashes, sourceNames) ||
      sourceNames.some(name => !digest(profile.sourceSha256[name]) ||
        sourceByteHashes[name] !== profile.sourceSha256[name])) {
    fail('HISTORICAL_SOURCE_HASH_MISMATCH');
  }
  if (profile.runProfileSha256 !== historicalProfileSha256(profile) ||
      profile.sourceIdentitySha256 !== sha256(canonicalJson(profile.sourceSha256)) ||
      profile.protocolId !== 'MERIDIAN-B1-7-PROTOCOL-R3-20261018' ||
      profile.protocolSha256 !== profile.sourceSha256.protocol ||
      profile.implementationId !== 'MERIDIAN-B1-7-ENGINE-R3' ||
      profile.implementationSha256 !== 'ab73261f01b27b8655ffea7979fec03eb1a9bea667b6fc4cda8d77b75c4f3e06' ||
      canonicalJson(profile.assets) !== canonicalJson(ASSETS) ||
      canonicalJson(profile.expectedWholeFileSha256) !== canonicalJson(INPUT.normalizedHashes)) {
    fail('HISTORICAL_PROFILE_PIN_MISMATCH');
  }
}

function validateVerification(verification, profile, metadataFileHashes) {
  if (!verification || verification.operation !== 'MERIDIAN-D1-WORK-20261019-01' ||
      verification.status !== 'VERIFIED_DRAFT_NOT_ADMITTED' ||
      verification.manifestState !== 'NOT_FROZEN' ||
      verification.sourceAuthenticity !== 'NOT_ESTABLISHED' ||
      verification.sourceCommit !== D1_SOURCE_COMMIT ||
      verification.sourceCommit !== profile.sourceCommit) {
    fail('D1_VERIFICATION_STATUS_INVALID');
  }
  if (!Array.isArray(verification.files) || verification.files.length !== ASSETS.length ||
      !exactObject(verification.manifestDraft, ['sourceCommit', 'files', 'selectedSeriesSha256']) ||
      !exactObject(verification.manifestDraft.files, ASSETS) ||
      !exactObject(verification.manifestDraft.selectedSeriesSha256, ASSETS) ||
      verification.manifestDraft.sourceCommit !== verification.sourceCommit ||
      canonicalJson(verification.manifestDraft.files) !== canonicalJson(profile.expectedWholeFileSha256)) {
    fail('D1_MANIFEST_SHAPE_INVALID');
  }
  const selectedSeriesSha256 = {};
  for (let index = 0; index < ASSETS.length; index++) {
    const asset = ASSETS[index];
    const file = verification.files[index];
    if (!exactObject(file, [
      'asset', 'path', 'bytes', 'expectedSha256', 'actualSha256', 'totalRows',
      'selectedRows', 'selectedSeriesSha256'
    ]) || file.asset !== asset ||
        file.path !== `${D1_PATH_PREFIX}/${asset}_1440_utc_normalized.csv` ||
        !Number.isSafeInteger(file.bytes) || file.bytes <= 0 ||
        !Number.isSafeInteger(file.totalRows) || file.totalRows < file.selectedRows ||
        file.selectedRows !== profile.rowsPerAsset ||
        !digest(file.expectedSha256) || !digest(file.actualSha256) ||
        file.expectedSha256 !== profile.expectedWholeFileSha256[asset] ||
        file.actualSha256 !== file.expectedSha256 ||
        !digest(file.selectedSeriesSha256) ||
        file.selectedSeriesSha256 !== verification.manifestDraft.selectedSeriesSha256[asset]) {
      fail('D1_SOURCE_FILE_PIN_MISMATCH');
    }
    selectedSeriesSha256[asset] = file.selectedSeriesSha256;
  }
  if (!exactObject(verification.validation, ['ok', 'errors']) ||
      verification.validation.ok !== true || !Array.isArray(verification.validation.errors) ||
      verification.validation.errors.length !== 0 ||
      !verification.evidence || verification.evidence.strategyExecuted !== false ||
      verification.evidence.returnsComputed !== false || verification.evidence.admitted !== false ||
      verification.evidence.sourceMain !== '6f720373af5439af70c54e6cb2f1c17abaf8b877' ||
      verification.evidence.executedVerifierSha256 !== metadataFileHashes.d1VerifierArchive ||
      verification.evidence.validatorSha256 !== profile.sourceSha256.validator ||
      verification.evidence.selectedRowTotal !== ASSETS.length * profile.rowsPerAsset ||
      verification.evidence.firstSelectedTimestamp !== profile.firstTimestamp ||
      verification.evidence.lastSelectedTimestamp !== profile.lastTimestamp ||
      canonicalJson(selectedSeriesSha256) !==
        canonicalJson(verification.manifestDraft.selectedSeriesSha256)) {
    fail('D1_VERIFICATION_EVIDENCE_INVALID');
  }
}

function validateProtocol(protocol, profile) {
  if (!protocol || protocol.protocolId !== profile.protocolId ||
      protocol.identity?.sourceCommit !== profile.sourceCommit ||
      protocol.authority?.executionAuthorized !== false ||
      protocol.authority?.paperAuthorized !== false ||
      protocol.authority?.liveAuthorized !== false ||
      protocol.pathManifest?.pathCount !== 44 ||
      protocol.budget?.processes !== 1 ||
      protocol.budget?.paths !== profile.limits.paths ||
      protocol.budget?.perPathSeconds !== profile.limits.pathSeconds ||
      protocol.budget?.totalMinutes * 60 !== profile.limits.batchSeconds ||
      protocol.budget?.outputBytes !== profile.limits.outputBytes ||
      protocol.budget?.automaticRetry !== profile.automaticRetry ||
      protocol.budget?.adaptiveTrials !== profile.adaptiveTuning ||
      !protocol.screen || !protocol.costAssumptions) {
    fail('PROTOCOL_METADATA_INVALID');
  }
}

export function buildD2Candidate({
  verification,
  protocol,
  profile = HISTORICAL_RUN_PROFILE,
  sourceByteHashes,
  metadataFileHashes
}) {
  validateProfile(profile, sourceByteHashes);
  if (!exactObject(metadataFileHashes, Object.keys(METADATA_FILES)) ||
      Object.values(metadataFileHashes).some(value => !digest(value))) {
    fail('METADATA_FILE_IDENTITY_INVALID');
  }
  validateVerification(verification, profile, metadataFileHashes);
  validateProtocol(protocol, profile);

  const manifestDraft = JSON.parse(JSON.stringify(verification.manifestDraft));
  const populatedUnfrozenProfile = deriveHistoricalProfile(manifestDraft);
  if (populatedUnfrozenProfile.status !== 'NOT_FROZEN' ||
      populatedUnfrozenProfile.approvalReceipt !== null ||
      populatedUnfrozenProfile.pathIds?.length !== 44 ||
      new Set(populatedUnfrozenProfile.pathIds).size !== 44 ||
      populatedUnfrozenProfile.computationOrder?.length !== 44 ||
      populatedUnfrozenProfile.pathDescriptors?.length !== 44 ||
      populatedUnfrozenProfile.pathDescriptors.some(descriptor =>
        !Array.isArray(descriptor) || descriptor.length !== 4 ||
        descriptor.some(value => typeof value !== 'string')) ||
      populatedUnfrozenProfile.computationOrder.some(index =>
        !Number.isSafeInteger(index) || index < 0 || index >= 44) ||
      new Set(populatedUnfrozenProfile.computationOrder).size !== 44) {
    fail('DERIVED_PROFILE_IDENTITY_INVALID');
  }

  const frozenProposal = {
    ...populatedUnfrozenProfile,
    status: 'FROZEN_FOR_D2',
    inputManifest: manifestDraft,
    approvalReceipt: null
  };
  frozenProposal.runProfileSha256 = historicalProfileSha256(frozenProposal);

  const pathManifest = populatedUnfrozenProfile.pathDescriptors.map(
    ([kind, variantId, scenarioId, segmentId], index) => ({
      kind,
      variantId,
      scenarioId,
      segmentId,
      pathId: populatedUnfrozenProfile.pathIds[index]
    })
  );
  const orderedComputationPaths = populatedUnfrozenProfile.computationOrder.map(
    (pathIndex, index) => ({ordinal: index + 1, ...pathManifest[pathIndex]})
  );
  const pathDescriptorsAndIds = pathManifest.map((path, index) => ({
    ordinal: index + 1,
    ...path
  }));
  if (pathManifest.length !== 44 || orderedComputationPaths.length !== 44 ||
      orderedComputationPaths.some((path, index) => path.ordinal !== index + 1) ||
      sha256(canonicalJson(pathManifest)) !==
        populatedUnfrozenProfile.manifestSha256 ||
      sha256(canonicalJson(orderedComputationPaths)) !==
        populatedUnfrozenProfile.computationOrderSha256) {
    fail('DERIVED_PATH_MANIFEST_INVALID');
  }

  const metadataSources = Object.fromEntries(
    Object.entries(METADATA_FILES).map(([name, relative]) => [
      name, {path: relative, sha256: metadataFileHashes[name]}
    ])
  );
  return {
    schema: 'MERIDIAN_D2_ADMISSION_CANDIDATE_R1',
    classification: 'PROPOSAL_ONLY',
    decision: 'DEFER',
    executionAuthorized: false,
    approvalReceipt: null,
    authority: {
      strategyPnlAuthorized: false,
      discoveryAuthorized: false,
      validationAuthorized: false,
      holdoutAuthorized: false,
      paperAuthorized: false,
      liveAuthorized: false
    },
    runtimeUse: 'OUTSIDE_RUNTIME_ADMISSION_AND_DISCOVERY_PATHS',
    evidenceState: {
      dataAdmission: 'NOT_READY',
      screen: 'NOT_RUN',
      sourceAuthenticity: 'NOT_ESTABLISHED',
      executionContext: 'NOT_VERIFIED',
      journal: 'NOT_VERIFIED',
      trialLedger: 'UNKNOWN',
      trialLedgerCompleteness: 'NOT_VERIFIED'
    },
    acceptedReceipts: ACCEPTED_RECEIPTS,
    metadataSources: {
      d1Operation: verification.operation,
      d1DataSourceCommit: verification.sourceCommit,
      d1ObservedMainCommit: verification.evidence.sourceMain,
      files: metadataSources
    },
    source: {
      sourceCommit: populatedUnfrozenProfile.sourceCommit,
      sourceFiles: populatedUnfrozenProfile.sourceFiles,
      sourceSha256: populatedUnfrozenProfile.sourceSha256,
      sourceIdentitySha256: populatedUnfrozenProfile.sourceIdentitySha256
    },
    protocol: {
      id: populatedUnfrozenProfile.protocolId,
      sha256: populatedUnfrozenProfile.protocolSha256
    },
    implementation: {
      id: populatedUnfrozenProfile.implementationId,
      sha256: populatedUnfrozenProfile.implementationSha256
    },
    input: {
      manifestDraft,
      inputManifestSha256: populatedUnfrozenProfile.inputManifestSha256,
      inputSha256: populatedUnfrozenProfile.inputSha256
    },
    paths: {
      descriptorsAndIds: pathDescriptorsAndIds,
      computationOrder: populatedUnfrozenProfile.computationOrder,
      orderedComputationPaths,
      manifestSha256: populatedUnfrozenProfile.manifestSha256,
      computationOrderSha256: populatedUnfrozenProfile.computationOrderSha256
    },
    profileDigests: {
      inactiveNotFrozenProfileSha256: HISTORICAL_RUN_PROFILE.runProfileSha256,
      populatedUnfrozenCandidateSha256: populatedUnfrozenProfile.runProfileSha256,
      proposedFrozenCandidateSha256: frozenProposal.runProfileSha256
    },
    limits: {
      trials: populatedUnfrozenProfile.trials,
      paths: populatedUnfrozenProfile.limits.paths,
      processes: 1,
      batchSeconds: populatedUnfrozenProfile.limits.batchSeconds,
      pathSeconds: populatedUnfrozenProfile.limits.pathSeconds,
      outputBytes: populatedUnfrozenProfile.limits.outputBytes,
      attemptsPerPath: populatedUnfrozenProfile.limits.attemptsPerPath,
      automaticRetry: populatedUnfrozenProfile.automaticRetry,
      adaptiveTuning: populatedUnfrozenProfile.adaptiveTuning
    },
    costs: {
      perSideBasisPoints: populatedUnfrozenProfile.costPerSideBasisPoints,
      delayDays: populatedUnfrozenProfile.delayDays,
      assumptions: protocol.costAssumptions
    },
    screenReference: {
      path: 'research/protocols/b1-7-20261018/EXECUTION_REQUEST.md#proposed-bounded-run',
      protocolPath: 'research/protocols/b1-7-20261018/protocol.json#screen',
      protocolSha256: populatedUnfrozenProfile.protocolSha256,
      screen: protocol.screen,
      status: 'NOT_RUN'
    },
    researchOnlyException: {
      stopPolicy: populatedUnfrozenProfile.stopPolicy,
      classification: 'RESEARCH_ONLY',
      finiteTradeStop: 'NONE',
      finiteTradeCrv: 'UNDEFINED_NO_FINITE_STOP',
      promotionEligible: false
    }
  };
}

function readAllowedFile(relativePath) {
  const allowed = new Set([
    ...Object.values(METADATA_FILES),
    ...Object.values(SOURCE_FILES)
  ]);
  if (!allowed.has(relativePath)) fail('METADATA_READ_PATH_NOT_ALLOWLISTED');
  const absolutePath = path.resolve(ROOT, relativePath);
  if (!absolutePath.startsWith(`${ROOT}${path.sep}`)) fail('METADATA_READ_PATH_NOT_ALLOWLISTED');
  return readFileSync(absolutePath);
}

function buildFromRepository() {
  const metadataBytes = Object.fromEntries(Object.entries(METADATA_FILES)
    .map(([name, relative]) => [name, readAllowedFile(relative)]));
  const metadataFileHashes = Object.fromEntries(Object.entries(metadataBytes)
    .map(([name, bytes]) => [name, sha256(bytes)]));
  if (metadataFileHashes.d1Verification !== ACCEPTED_D1_VERIFICATION_SHA256) {
    fail('D1_VERIFICATION_FILE_PIN_MISMATCH');
  }
  const verification = JSON.parse(metadataBytes.d1Verification.toString('utf8'));
  if (sha256(canonicalJson(verification.manifestDraft)) !== ACCEPTED_D1_MANIFEST_DRAFT_SHA256) {
    fail('D1_MANIFEST_DRAFT_PIN_MISMATCH');
  }
  const profilePathPinsValid = canonicalJson(HISTORICAL_RUN_PROFILE.sourceFiles) ===
    canonicalJson(SOURCE_FILES);
  if (!profilePathPinsValid) fail('HISTORICAL_SOURCE_FILE_PIN_MISMATCH');
  const pinnedSources = verifyHistoricalSourcePins(HISTORICAL_RUN_PROFILE);
  if (!pinnedSources.ok) fail('HISTORICAL_SOURCE_PIN_MISMATCH');

  return buildD2Candidate({
    verification,
    protocol: JSON.parse(metadataBytes.protocolJson.toString('utf8')),
    sourceByteHashes: HISTORICAL_RUN_PROFILE.sourceSha256,
    metadataFileHashes
  });
}

function runCli() {
  if (process.argv.length !== 2) fail('CLI_TAKES_NO_ARGUMENTS');
  const candidate = buildFromRepository();
  const bytes = `${JSON.stringify(candidate, null, 2)}\n`;
  writeFileSync(OUTPUT_PATH, bytes, {encoding: 'utf8'});
  console.log(`WROTE ${path.relative(ROOT, OUTPUT_PATH)} sha256=${sha256(bytes)}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  try {
    runCli();
  } catch (error) {
    console.error(`D2_CANDIDATE_BUILD_FAILED ${error.message}`);
    process.exitCode = 1;
  }
}
