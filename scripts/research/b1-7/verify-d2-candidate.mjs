import {createHash} from 'node:crypto';

export const D2_VERIFIER_BOUNDS = Object.freeze({
  inputBytes: 65536,
  jsonDepth: 16,
  containerItems: 64,
  totalValues: 4096,
  stringCharacters: 4096,
  findings: 16
});

const HASH = /^[a-f0-9]{64}$/;
const TYPED_ARRAY_BYTE_LENGTH_GETTER =
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength').get;
const SOURCE_COMMIT = '1c7b6dccd886f57e866c7d359c091b1e72a193ea';
const PROTOCOL_ID = 'MERIDIAN-B1-7-PROTOCOL-R3-20261018';
const PROTOCOL_SHA256 = 'a78e1ae8c71c8f85baee5b51f5691643fc29136f636f19465c61f553afe09185';
const IMPLEMENTATION_ID = 'MERIDIAN-B1-7-ENGINE-R3';
const IMPLEMENTATION_SHA256 = 'ab73261f01b27b8655ffea7979fec03eb1a9bea667b6fc4cda8d77b75c4f3e06';
const INPUT_MANIFEST_SHA256 = '37fecaa0d003c9ec862fb57b3b312c0289c1dd370607ade99bac584d357f81a9';
const INPUT_SHA256 = '24c992c39d5c722464b19483ad4b0f1e55c8a434b6a1ac137a8dd10438398a7b';
const SOURCE_IDENTITY_SHA256 = '3e3973847b2b37cffa11b2df1be0b832d3227692857ff4bb2631ca5ff48ad773';
const PATHS_MANIFEST_SHA256 = '5303d2b5ddc3d40de984504435ecc73d4b4734aa6bd423fb64833913f5526442';
const COMPUTATION_ORDER_SHA256 = '5339191d01d68a09ae10b9e8aa75194e5beb16d358f27fd5eb6a1f7c94757265';
const COST_ASSUMPTIONS_SHA256 = '11d1014790c255db8cc0cd73c4a74f78b6fd9c08aadd4ac03e2910f538acb4eb';
const SCREEN_SHA256 = '7e5b695a7756ebc402c3ee5c85f082f7b3314ce7edabb29507c94d0cf1bbd51f';

const TOP_KEYS = [
  'schema', 'classification', 'decision', 'executionAuthorized', 'approvalReceipt',
  'authority', 'runtimeUse', 'evidenceState', 'acceptedReceipts', 'metadataSources',
  'source', 'protocol', 'implementation', 'input', 'paths', 'profileDigests',
  'limits', 'costs', 'screenReference', 'researchOnlyException'
];
const ASSETS = ['XBTUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD', 'LINKUSD', 'AVAXUSD', 'SUIUSD'];
const EXPECTED_FILES = {
  XBTUSD: 'f2e94a03fbe61f37295b2249d5c3a4d324d13fcfb5d5b41f2ed4d7dfe2183bb9',
  ETHUSD: 'fbb7915af33d3c32db1cf368a171ed633090406c39da38aae90ac0d3876754bb',
  SOLUSD: 'caff8ea08d3548b2d8c704cc17a940754a70e23f60e44716324c464929bc18ca',
  XRPUSD: 'bd006dfcbf052fb516e2d5e5a97d0570cf093e577c3c83752f2f3b7310fc52a7',
  LINKUSD: '82682634f645ab5ca1dac4065cc0d490d343ea24b61463bcc2b6406894785518',
  AVAXUSD: 'a4350bf73b44a45770bb173541133e4a04e847a07d74231ad6b5bbd7d6d06887',
  SUIUSD: '0b35eb5598a336d8d4485b15adc2a4b4a716c967ff700eff3802386c31beda79'
};
const EXPECTED_SERIES = {
  XBTUSD: 'bffbce1ff996b4348264554f7213e7d88f3f6e756be735e21b6ee3df499bfaf8',
  ETHUSD: '99a5fb8ce0358615b222dbbc8cd298ffa03d7fc4deaf1862bbcdf2e9beeab0ef',
  SOLUSD: '37b76aee67428b996db199fa5911c3c839418a02ca5d0ed78fb10466c6c962de',
  XRPUSD: '80fa4021997d9c1b80cb5c0714e246988f53ae89acae46ce67e6bbb580714925',
  LINKUSD: '82ca47fb3622a80bbcb70fb40610eb4aedf8a6151bc5cf74a66250c72a10ac05',
  AVAXUSD: '2374eb666defc74c9036d019251e1dcbde78f99b94c85453627d54d70b1d91c2',
  SUIUSD: '03077fda4966b0699afde51118ecedc8d2f31ffe3088c23fd918c29fc20e4ba2'
};
const SOURCE_FILES = {
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
};
const SOURCE_HASHES = {
  engine: '64df8c6fe5a587397b312447d310cb285f552da5b686a11b3a1d0f9441b9bb8f',
  validator: '2052c0fae0082622f48a18abb4a6dacc0ffa679fb5da01df5779b398f5a578fc',
  loader: '93d05a81625fed4e7f56f889a1b3b2950ac98191f183dff99f5c7f44a276f02d',
  protocol: PROTOCOL_SHA256,
  bridge: '0a90728308f65fdcc387c3c7130c0792eaa18e921d193ac8ba61a3f428577921',
  admission: 'eb3bef19553a299c27023bc4558157b75267fa99adf23661e5efb5730b905f04',
  profile: '1df24e3372acb900ead091aef55f6f6fc2288a81bcf769e7587fb36e12aaad17',
  adapter: '79bef665862be2a1751d201c6303c571344c42cdc7fe76897c66ff74561c5c5f',
  adapterRuntime: '2d912e011e441abee4c884236a8a4c09791b502151f470e7388cd2333b1ee165',
  supervisor: '6eb664e328bb105063d9a3eabf06b0b5c54140620141d3ee9db00744f246385c',
  journal: '83c1d37557afff72adfc08dbd2a0036db3fb7c45a895a679b7015c3f23cc055e'
};
const METADATA_FILES = {
  d1Verification: ['docs/research/d1-20261019/verification.json', '223548051320d00866666d87b1b543243fecf9d1a5ca647be2d7a09d0b1f0f05'],
  d1Readme: ['docs/research/d1-20261019/README.md', 'fc9a8639ae307a21b8c6dc9ef39e2a4fabc0be50f9c17e447f97e874bb41fd05'],
  d1VerifierArchive: ['docs/research/d1-20261019/executed-verifier.mjs.txt', '30e2b8bf80d93f2bb76b70a0afc28092180b729b1b0bd4ccf203359d28b6c156'],
  inactiveProfileJson: ['scripts/research-supervisor/historical_run_profile.json', '37414b5a7f595a9b2fd51784425b7b24a237a7186afa707beb37d9baa279c391'],
  pathBridgeManifest: ['scripts/research-supervisor/b1_bridge_manifest.json', '0a90728308f65fdcc387c3c7130c0792eaa18e921d193ac8ba61a3f428577921'],
  protocolJson: ['research/protocols/b1-7-20261018/protocol.json', PROTOCOL_SHA256],
  candidateBuilder: ['scripts/research/b1-7/prepare-d2-candidate.mjs', 'ed599c66a68325849ee83dc8e9b25c95b43ab5649e7a336fd48cfb4377fc4549']
};
const RECEIPTS = {
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
};
const SCENARIOS = ['base-15bp', 'stress-30bp', 'stress-30bp-delay-1d'];
const SEGMENTS = ['development', 'diagnostic'];
const VARIANTS = [
  ['CANDIDATE', 'primary-n30-f25'],
  ['CANDIDATE', 'neighbour-n20-f25'],
  ['CANDIDATE', 'neighbour-n45-f25'],
  ['CANDIDATE', 'neighbour-n30-f20'],
  ['CANDIDATE', 'neighbour-n30-f35'],
  ['FULL_BASKET', 'full-basket-weekly']
];
const DESCRIPTORS = [
  ...VARIANTS.flatMap(([kind, variantId]) =>
    SCENARIOS.flatMap(scenarioId =>
      SEGMENTS.map(segmentId => [kind, variantId, scenarioId, segmentId]))),
  ...['frozen-mean-exposure', 'frozen-risk-exposure'].flatMap(variantId =>
    SCENARIOS.map(scenarioId => ['FIXED_CONTROL', variantId, scenarioId, 'diagnostic'])),
  ...['development', 'diagnostic'].map(segmentId =>
    ['CASH', 'cash-zero', 'scenario-independent', segmentId])
];
const COMPUTATION_ORDER = [
  0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 42,
  1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31, 33, 35, 36, 37,
  38, 39, 40, 41, 43
];
const PATH_PROFILE_DIGESTS = {
  inactiveNotFrozenProfileSha256: '160b73ff9c380b1231d0a1e4a88566493408f978857a3b13d71826852a413fc8',
  populatedUnfrozenCandidateSha256: 'dce7dbdaeef3482029111059e75322c7e88048fef655ffbc93240f4f64f9c14e',
  proposedFrozenCandidateSha256: '96112200e075745dbe692e42099970607325caf8b7a75b6dcf2fe427db8fe74e'
};
const LIMITS = {
  trials: 1, paths: 44, processes: 1, batchSeconds: 1800, pathSeconds: 60,
  outputBytes: 1048576, attemptsPerPath: 1, automaticRetry: false, adaptiveTuning: false
};
const ROOT_EXPECTATIONS = {
  schema: 'MERIDIAN_D2_ADMISSION_CANDIDATE_R1',
  classification: 'PROPOSAL_ONLY',
  decision: 'DEFER',
  executionAuthorized: false,
  approvalReceipt: null,
  runtimeUse: 'OUTSIDE_RUNTIME_ADMISSION_AND_DISCOVERY_PATHS',
  metadataSources: {
    d1Operation: 'MERIDIAN-D1-WORK-20261019-01',
    d1DataSourceCommit: SOURCE_COMMIT,
    d1ObservedMainCommit: '6f720373af5439af70c54e6cb2f1c17abaf8b877'
  },
  sourceCommit: SOURCE_COMMIT
};

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key =>
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function reject(code, path = '$') {
  const error = new Error(code);
  error.code = code;
  error.path = path;
  throw error;
}

function decodeAndParse(bytes) {
  let text;
  try {
    text = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes);
  } catch {
    reject('INVALID_UTF8');
  }
  let index = 0;
  let values = 0;
  const whitespace = () => {
    while (text[index] === ' ' || text[index] === '\n' ||
        text[index] === '\r' || text[index] === '\t') index++;
  };
  const parseString = path => {
    const start = index++;
    while (index < text.length) {
      const code = text.charCodeAt(index);
      if (code === 0x22) {
        index++;
        const raw = text.slice(start, index);
        let value;
        try {
          value = JSON.parse(raw);
        } catch {
          reject('MALFORMED_JSON', path);
        }
        if (value.length > D2_VERIFIER_BOUNDS.stringCharacters) {
          reject('STRING_LIMIT_EXCEEDED', path);
        }
        for (let offset = 0; offset < value.length; offset++) {
          const unit = value.charCodeAt(offset);
          if (unit >= 0xd800 && unit <= 0xdbff) {
            const low = value.charCodeAt(offset + 1);
            if (!(low >= 0xdc00 && low <= 0xdfff)) reject('INVALID_UNICODE', path);
            offset++;
          } else if (unit >= 0xdc00 && unit <= 0xdfff) {
            reject('INVALID_UNICODE', path);
          }
        }
        return value;
      }
      if (code < 0x20) reject('MALFORMED_JSON', path);
      if (code === 0x5c) {
        index++;
        if (index >= text.length) reject('MALFORMED_JSON', path);
        const escape = text[index++];
        if (escape === 'u') {
          if (!/^[a-fA-F0-9]{4}$/.test(text.slice(index, index + 4))) {
            reject('MALFORMED_JSON', path);
          }
          index += 4;
        } else if (!'"\\/bfnrt'.includes(escape)) {
          reject('MALFORMED_JSON', path);
        }
      } else {
        index++;
      }
    }
    reject('MALFORMED_JSON', path);
  };
  const parseValue = (depth, path) => {
    if (depth > D2_VERIFIER_BOUNDS.jsonDepth) reject('DEPTH_LIMIT_EXCEEDED', path);
    if (++values > D2_VERIFIER_BOUNDS.totalValues) reject('VALUE_LIMIT_EXCEEDED', path);
    whitespace();
    const token = text[index];
    if (token === '{') {
      index++;
      const result = Object.create(null);
      whitespace();
      if (text[index] === '}') {
        index++;
        return result;
      }
      let count = 0;
      while (true) {
        whitespace();
        if (text[index] !== '"') reject('MALFORMED_JSON', path);
        const key = parseString(path);
        const childPath = `${path}.${key}`;
        if (Object.hasOwn(result, key)) reject('DUPLICATE_KEY', childPath);
        if (++count > D2_VERIFIER_BOUNDS.containerItems) {
          reject('CONTAINER_LIMIT_EXCEEDED', path);
        }
        whitespace();
        if (text[index++] !== ':') reject('MALFORMED_JSON', childPath);
        result[key] = parseValue(depth + 1, childPath);
        whitespace();
        if (text[index] === '}') {
          index++;
          return result;
        }
        if (text[index++] !== ',') reject('MALFORMED_JSON', path);
      }
    }
    if (token === '[') {
      index++;
      const result = [];
      whitespace();
      if (text[index] === ']') {
        index++;
        return result;
      }
      while (true) {
        if (result.length >= D2_VERIFIER_BOUNDS.containerItems) {
          reject('CONTAINER_LIMIT_EXCEEDED', path);
        }
        result.push(parseValue(depth + 1, `${path}[${result.length}]`));
        whitespace();
        if (text[index] === ']') {
          index++;
          return result;
        }
        if (text[index++] !== ',') reject('MALFORMED_JSON', path);
      }
    }
    if (token === '"') return parseString(path);
    if (token === 't' && text.slice(index, index + 4) === 'true') {
      index += 4;
      return true;
    }
    if (token === 'f' && text.slice(index, index + 5) === 'false') {
      index += 5;
      return false;
    }
    if (token === 'n' && text.slice(index, index + 4) === 'null') {
      index += 4;
      return null;
    }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(index));
    if (number) {
      index += number[0].length;
      const parsed = Number(number[0]);
      if (!Number.isFinite(parsed)) reject('INVALID_NUMBER', path);
      return parsed;
    }
    reject('MALFORMED_JSON', path);
  };
  const value = parseValue(0, '$');
  whitespace();
  if (index !== text.length) reject('MALFORMED_JSON');
  return value;
}

function exactKeys(value, keys, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    reject('OBJECT_REQUIRED', path);
  }
  const expected = new Set(keys);
  const actual = Object.keys(value).sort();
  const unexpected = actual.find(key => !expected.has(key));
  if (unexpected !== undefined) reject('UNKNOWN_FIELD', `${path}.${unexpected}`);
  const missing = keys.find(key => !Object.hasOwn(value, key));
  if (missing !== undefined) reject('MISSING_FIELD', `${path}.${missing}`);
}

function exactValue(actual, expected, code, path) {
  if (canonicalJson(actual) !== canonicalJson(expected)) reject(code, path);
}

function validateCandidate(candidate) {
  exactKeys(candidate, TOP_KEYS, '$');
  for (const [key, expected] of Object.entries(ROOT_EXPECTATIONS)) {
    if (key !== 'metadataSources' && key !== 'sourceCommit') {
      exactValue(candidate[key], expected, 'SCHEMA_VALUE_MISMATCH', `$.${key}`);
    }
  }
  exactKeys(candidate.authority, [
    'strategyPnlAuthorized', 'discoveryAuthorized', 'validationAuthorized',
    'holdoutAuthorized', 'paperAuthorized', 'liveAuthorized'
  ], '$.authority');
  for (const key of Object.keys(candidate.authority)) {
    if (candidate.authority[key] !== false) reject('AUTHORITY_ESCALATION', `$.authority.${key}`);
  }
  exactKeys(candidate.evidenceState, [
    'dataAdmission', 'screen', 'sourceAuthenticity', 'executionContext', 'journal',
    'trialLedger', 'trialLedgerCompleteness'
  ], '$.evidenceState');
  exactValue(candidate.evidenceState, {
    dataAdmission: 'NOT_READY',
    screen: 'NOT_RUN',
    sourceAuthenticity: 'NOT_ESTABLISHED',
    executionContext: 'NOT_VERIFIED',
    journal: 'NOT_VERIFIED',
    trialLedger: 'UNKNOWN',
    trialLedgerCompleteness: 'NOT_VERIFIED'
  }, 'EVIDENCE_STATE_MISMATCH', '$.evidenceState');

  exactKeys(candidate.acceptedReceipts, ['sourceAndProfile', 'd1', 'acceptedReadinessSource'],
    '$.acceptedReceipts');
  exactKeys(candidate.acceptedReceipts.sourceAndProfile, [
    'sourceAcceptanceComment', 'profileAcceptanceComment', 'profileMergeComment',
    'profileMergeCommit'
  ], '$.acceptedReceipts.sourceAndProfile');
  exactKeys(candidate.acceptedReceipts.d1, [
    'issue', 'authorizationComment', 'technicalClosureComment', 'evidenceMergeCommit'
  ], '$.acceptedReceipts.d1');
  exactKeys(candidate.acceptedReceipts.acceptedReadinessSource, [
    'pullRequest', 'sourceAcceptedHead', 'sourceAcceptanceComment',
    'integratedSourceSnapshotHead', 'integrationReceiptComment',
    'laterScopeExpansionComment', 'laterScopeReview'
  ], '$.acceptedReceipts.acceptedReadinessSource');
  exactValue(candidate.acceptedReceipts, RECEIPTS, 'RECEIPT_PIN_MISMATCH',
    '$.acceptedReceipts');

  exactKeys(candidate.metadataSources, [
    'd1Operation', 'd1DataSourceCommit', 'd1ObservedMainCommit', 'files'
  ], '$.metadataSources');
  exactValue(candidate.metadataSources.d1Operation, ROOT_EXPECTATIONS.metadataSources.d1Operation,
    'METADATA_SOURCE_MISMATCH', '$.metadataSources.d1Operation');
  exactValue(candidate.metadataSources.d1DataSourceCommit, SOURCE_COMMIT,
    'METADATA_SOURCE_MISMATCH', '$.metadataSources.d1DataSourceCommit');
  exactValue(candidate.metadataSources.d1ObservedMainCommit,
    ROOT_EXPECTATIONS.metadataSources.d1ObservedMainCommit, 'METADATA_SOURCE_MISMATCH',
    '$.metadataSources.d1ObservedMainCommit');
  exactKeys(candidate.metadataSources.files, Object.keys(METADATA_FILES), '$.metadataSources.files');
  for (const [name, [filePath, digest]] of Object.entries(METADATA_FILES)) {
    const source = candidate.metadataSources.files[name];
    exactKeys(source, ['path', 'sha256'], `$.metadataSources.files.${name}`);
    exactValue(source, {path: filePath, sha256: digest}, 'METADATA_FILE_PIN_MISMATCH',
      `$.metadataSources.files.${name}`);
  }

  exactKeys(candidate.source, [
    'sourceCommit', 'sourceFiles', 'sourceSha256', 'sourceIdentitySha256'
  ], '$.source');
  exactValue(candidate.source.sourceCommit, SOURCE_COMMIT, 'SOURCE_IDENTITY_MISMATCH',
    '$.source.sourceCommit');
  exactKeys(candidate.source.sourceFiles, Object.keys(SOURCE_FILES), '$.source.sourceFiles');
  exactKeys(candidate.source.sourceSha256, Object.keys(SOURCE_HASHES), '$.source.sourceSha256');
  exactValue(candidate.source.sourceFiles, SOURCE_FILES, 'SOURCE_FILE_PIN_MISMATCH',
    '$.source.sourceFiles');
  exactValue(candidate.source.sourceSha256, SOURCE_HASHES, 'SOURCE_HASH_PIN_MISMATCH',
    '$.source.sourceSha256');
  if (Object.values(candidate.source.sourceSha256).some(digest => !HASH.test(digest)) ||
      sha256(canonicalJson(candidate.source.sourceSha256)) !== SOURCE_IDENTITY_SHA256 ||
      candidate.source.sourceIdentitySha256 !== SOURCE_IDENTITY_SHA256) {
    reject('SOURCE_IDENTITY_MISMATCH', '$.source.sourceIdentitySha256');
  }

  exactKeys(candidate.protocol, ['id', 'sha256'], '$.protocol');
  exactValue(candidate.protocol, {id: PROTOCOL_ID, sha256: PROTOCOL_SHA256},
    'PROTOCOL_PIN_MISMATCH', '$.protocol');
  exactKeys(candidate.implementation, ['id', 'sha256'], '$.implementation');
  exactValue(candidate.implementation, {
    id: IMPLEMENTATION_ID, sha256: IMPLEMENTATION_SHA256
  }, 'IMPLEMENTATION_PIN_MISMATCH', '$.implementation');

  exactKeys(candidate.input, ['manifestDraft', 'inputManifestSha256', 'inputSha256'], '$.input');
  const manifest = candidate.input.manifestDraft;
  exactKeys(manifest, ['sourceCommit', 'files', 'selectedSeriesSha256'],
    '$.input.manifestDraft');
  exactValue(manifest.sourceCommit, SOURCE_COMMIT, 'INPUT_SOURCE_MISMATCH',
    '$.input.manifestDraft.sourceCommit');
  exactKeys(manifest.files, ASSETS, '$.input.manifestDraft.files');
  exactKeys(manifest.selectedSeriesSha256, ASSETS, '$.input.manifestDraft.selectedSeriesSha256');
  exactValue(manifest.files, EXPECTED_FILES, 'INPUT_FILE_PIN_MISMATCH',
    '$.input.manifestDraft.files');
  exactValue(manifest.selectedSeriesSha256, EXPECTED_SERIES, 'INPUT_SERIES_PIN_MISMATCH',
    '$.input.manifestDraft.selectedSeriesSha256');
  const inputManifestSha256 = sha256(canonicalJson(manifest));
  if (inputManifestSha256 !== INPUT_MANIFEST_SHA256 ||
      candidate.input.inputManifestSha256 !== inputManifestSha256) {
    reject('INPUT_MANIFEST_IDENTITY_MISMATCH', '$.input.inputManifestSha256');
  }
  const inputIdentity = {
    datasetKind: 'FROZEN_RESEARCH_INPUT',
    sourceCommit: manifest.sourceCommit,
    sourceProvenance: {normalizedFileSha256: manifest.files},
    canonicalSeriesSha256: manifest.selectedSeriesSha256
  };
  const inputSha256 = sha256(canonicalJson(inputIdentity));
  if (inputSha256 !== INPUT_SHA256 || candidate.input.inputSha256 !== inputSha256) {
    reject('INPUT_IDENTITY_MISMATCH', '$.input.inputSha256');
  }

  exactKeys(candidate.paths, [
    'descriptorsAndIds', 'computationOrder', 'orderedComputationPaths',
    'manifestSha256', 'computationOrderSha256'
  ], '$.paths');
  if (!Array.isArray(candidate.paths.descriptorsAndIds) ||
      candidate.paths.descriptorsAndIds.length !== 44 ||
      !Array.isArray(candidate.paths.computationOrder) ||
      candidate.paths.computationOrder.length !== 44 ||
      !Array.isArray(candidate.paths.orderedComputationPaths) ||
      candidate.paths.orderedComputationPaths.length !== 44) {
    reject('PATH_COUNT_MISMATCH', '$.paths');
  }
  const paths = candidate.paths.descriptorsAndIds;
  const pathIds = new Set();
  const manifestPaths = [];
  for (let index = 0; index < DESCRIPTORS.length; index++) {
    const [kind, variantId, scenarioId, segmentId] = DESCRIPTORS[index];
    const path = paths[index];
    const pathLabel = `$.paths.descriptorsAndIds[${index}]`;
    exactKeys(path, ['ordinal', 'kind', 'variantId', 'scenarioId', 'segmentId', 'pathId'],
      pathLabel);
    const identity = {
      protocolId: PROTOCOL_ID,
      protocolSha256: PROTOCOL_SHA256,
      implementationId: IMPLEMENTATION_ID,
      implementationSha256: IMPLEMENTATION_SHA256,
      inputSha256,
      canonicalSeriesSha256: manifest.selectedSeriesSha256,
      variantId,
      scenarioId,
      segmentId
    };
    const pathId = sha256(canonicalJson(identity));
    exactValue(path, {
      ordinal: index + 1, kind, variantId, scenarioId, segmentId, pathId
    }, 'PATH_IDENTITY_MISMATCH', pathLabel);
    if (pathIds.has(pathId)) reject('DUPLICATE_PATH_ID', `${pathLabel}.pathId`);
    pathIds.add(pathId);
    manifestPaths.push({kind, variantId, scenarioId, segmentId, pathId});
  }
  if (pathIds.size !== 44) reject('PATH_COUNT_MISMATCH', '$.paths.descriptorsAndIds');
  exactValue(candidate.paths.computationOrder, COMPUTATION_ORDER, 'PATH_ORDER_MISMATCH',
    '$.paths.computationOrder');
  const orderedPaths = COMPUTATION_ORDER.map((pathIndex, index) => ({
    ordinal: index + 1,
    ...manifestPaths[pathIndex]
  }));
  exactValue(candidate.paths.orderedComputationPaths, orderedPaths, 'PATH_ORDER_MISMATCH',
    '$.paths.orderedComputationPaths');
  if (sha256(canonicalJson(manifestPaths)) !== PATHS_MANIFEST_SHA256 ||
      candidate.paths.manifestSha256 !== PATHS_MANIFEST_SHA256) {
    reject('PATH_MANIFEST_IDENTITY_MISMATCH', '$.paths.manifestSha256');
  }
  if (sha256(canonicalJson(orderedPaths)) !== COMPUTATION_ORDER_SHA256 ||
      candidate.paths.computationOrderSha256 !== COMPUTATION_ORDER_SHA256) {
    reject('PATH_ORDER_IDENTITY_MISMATCH', '$.paths.computationOrderSha256');
  }

  exactKeys(candidate.profileDigests, Object.keys(PATH_PROFILE_DIGESTS), '$.profileDigests');
  exactValue(candidate.profileDigests, PATH_PROFILE_DIGESTS, 'PROFILE_DIGEST_PIN_MISMATCH',
    '$.profileDigests');
  exactKeys(candidate.limits, Object.keys(LIMITS), '$.limits');
  exactValue(candidate.limits, LIMITS, 'LIMITS_ESCALATION', '$.limits');

  exactKeys(candidate.costs, ['perSideBasisPoints', 'delayDays', 'assumptions'], '$.costs');
  exactValue(candidate.costs.perSideBasisPoints, [15, 30, 30], 'COSTS_PIN_MISMATCH',
    '$.costs.perSideBasisPoints');
  exactValue(candidate.costs.delayDays, [0, 0, 1], 'COSTS_PIN_MISMATCH',
    '$.costs.delayDays');
  exactKeys(candidate.costs.assumptions, ['base', 'stress', 'status'],
    '$.costs.assumptions');
  if (sha256(canonicalJson(candidate.costs.assumptions)) !== COST_ASSUMPTIONS_SHA256) {
    reject('COSTS_PIN_MISMATCH', '$.costs.assumptions');
  }

  exactKeys(candidate.screenReference, [
    'path', 'protocolPath', 'protocolSha256', 'screen', 'status'
  ], '$.screenReference');
  exactValue(candidate.screenReference.path,
    'research/protocols/b1-7-20261018/EXECUTION_REQUEST.md#proposed-bounded-run',
    'SCREEN_PIN_MISMATCH', '$.screenReference.path');
  exactValue(candidate.screenReference.protocolPath,
    'research/protocols/b1-7-20261018/protocol.json#screen',
    'SCREEN_PIN_MISMATCH', '$.screenReference.protocolPath');
  exactValue(candidate.screenReference.protocolSha256, PROTOCOL_SHA256,
    'SCREEN_PIN_MISMATCH', '$.screenReference.protocolSha256');
  exactValue(candidate.screenReference.status, 'NOT_RUN', 'SCREEN_AUTHORITY_MISMATCH',
    '$.screenReference.status');
  exactKeys(candidate.screenReference.screen, [
    'primary', 'comparisonSegment', 'neighbours', 'statuses',
    'syntheticFixtureStatus', 'interpretation'
  ], '$.screenReference.screen');
  if (sha256(canonicalJson(candidate.screenReference.screen)) !== SCREEN_SHA256) {
    reject('SCREEN_PIN_MISMATCH', '$.screenReference.screen');
  }

  exactKeys(candidate.researchOnlyException, [
    'stopPolicy', 'classification', 'finiteTradeStop', 'finiteTradeCrv', 'promotionEligible'
  ], '$.researchOnlyException');
  exactValue(candidate.researchOnlyException, {
    stopPolicy: 'NO_FINITE_TRADE_STOP',
    classification: 'RESEARCH_ONLY',
    finiteTradeStop: 'NONE',
    finiteTradeCrv: 'UNDEFINED_NO_FINITE_STOP',
    promotionEligible: false
  }, 'RESEARCH_AUTHORITY_MISMATCH', '$.researchOnlyException');
}

function reportFailure(error, candidateSha256 = null) {
  return {
    ok: false,
    status: 'INVALID',
    candidateSha256,
    executionAuthorized: false,
    findings: [{
      code: error?.code ?? 'INVALID_CANDIDATE',
      path: error?.path ?? '$'
    }].slice(0, D2_VERIFIER_BOUNDS.findings)
  };
}

export function verifyD2Candidate(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    return reportFailure({code: 'INPUT_NOT_BYTES'});
  }
  let byteLength;
  try {
    byteLength = TYPED_ARRAY_BYTE_LENGTH_GETTER.call(bytes);
  } catch {
    return reportFailure({code: 'INPUT_NOT_BYTES'});
  }
  if (byteLength > D2_VERIFIER_BOUNDS.inputBytes) {
    return reportFailure({code: 'INPUT_SIZE_LIMIT_EXCEEDED'});
  }
  let candidateSha256;
  try {
    candidateSha256 = sha256(bytes);
  } catch {
    return reportFailure({code: 'INPUT_NOT_BYTES'});
  }
  try {
    const candidate = decodeAndParse(bytes);
    validateCandidate(candidate);
    return {
      ok: true,
      status: 'PROPOSAL_ONLY',
      candidateSha256,
      executionAuthorized: false,
      findings: []
    };
  } catch (error) {
    return reportFailure(error, candidateSha256);
  }
}
