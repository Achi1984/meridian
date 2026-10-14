import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const SCHEMA = 'MERIDIAN_STRATEGY_RECEIPT_MANIFEST_V1';
const MAX_ARTIFACTS = 64;
const MAX_MEMBERS = 256;
const MAX_MANIFEST_BYTES = 128 * 1024;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const KINDS = new Set([
  'development-source',
  'development-result',
  'holdout-source',
  'holdout-result',
  'prospective-source',
  'prospective-snapshot'
]);

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => object(value)
  && Object.keys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));
const positiveInteger = value => Number.isSafeInteger(value) && value > 0;

function safeRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512
    || value.includes('\0') || value.includes('\\') || value.startsWith('/')
    || /^[a-zA-Z]:/.test(value)) return false;
  const segments = value.split('/');
  return segments.every(segment => segment.length > 0 && segment !== '.' && segment !== '..')
    && path.posix.normalize(value) === value;
}

function rejectDuplicateObjectKeys(text) {
  let index = 0;
  const whitespace = () => {
    while (/\s/.test(text[index] ?? '')) index++;
  };
  const stringEnd = () => {
    const start = index++;
    while (index < text.length) {
      if (text[index] === '\\') index += 2;
      else if (text[index++] === '"') return index;
    }
    throw new Error('unterminated JSON string');
  };
  const value = () => {
    whitespace();
    if (text[index] === '"') {
      stringEnd();
      return;
    }
    if (text[index] === '{') {
      index++;
      whitespace();
      const keys = new Set();
      if (text[index] === '}') {
        index++;
        return;
      }
      while (index < text.length) {
        whitespace();
        const start = index;
        const end = stringEnd();
        const key = JSON.parse(text.slice(start, end));
        if (keys.has(key)) throw new Error(`duplicate manifest key: ${key}`);
        keys.add(key);
        whitespace();
        index++;
        value();
        whitespace();
        if (text[index] === '}') {
          index++;
          return;
        }
        index++;
      }
      throw new Error('unterminated JSON object');
    }
    if (text[index] === '[') {
      index++;
      whitespace();
      if (text[index] === ']') {
        index++;
        return;
      }
      while (index < text.length) {
        value();
        whitespace();
        if (text[index] === ']') {
          index++;
          return;
        }
        index++;
      }
      throw new Error('unterminated JSON array');
    }
    while (index < text.length && !/[\s,[\]{}]/.test(text[index])) index++;
  };
  value();
  whitespace();
  if (index !== text.length) throw new Error('unexpected trailing JSON content');
}

export function parseReceiptManifest(manifestText) {
  if (typeof manifestText !== 'string' || Buffer.byteLength(manifestText, 'utf8') > MAX_MANIFEST_BYTES) {
    throw new Error('manifest must be a UTF-8 string no larger than 128 KiB');
  }
  const parsed = JSON.parse(manifestText);
  rejectDuplicateObjectKeys(manifestText);
  if (!exactKeys(parsed, ['schemaVersion', 'maxTotalBytes', 'artifacts'])
    || parsed.schemaVersion !== SCHEMA
    || !Number.isSafeInteger(parsed.maxTotalBytes)
    || parsed.maxTotalBytes < 1
    || parsed.maxTotalBytes > MAX_TOTAL_BYTES
    || !Array.isArray(parsed.artifacts)
    || parsed.artifacts.length === 0
    || parsed.artifacts.length > MAX_ARTIFACTS) {
    throw new Error('manifest header does not match the supported schema');
  }

  const artifactIds = new Set();
  const expectedFiles = [];
  const inputPaths = new Set();
  let maximumBytes = 0;
  let memberCount = 0;
  const addFile = (file, context, expectedName) => {
    const keys = expectedName
      ? ['name', 'path', 'sha256', 'sizeBytes', 'maxBytes']
      : ['path', 'sha256', 'sizeBytes', 'maxBytes'];
    if (!exactKeys(file, keys)
      || (expectedName && !safeRelativePath(file.name))
      || !safeRelativePath(file.path)
      || !SHA256.test(file.sha256)
      || !Number.isSafeInteger(file.sizeBytes)
      || file.sizeBytes < 0
      || !Number.isSafeInteger(file.maxBytes)
      || file.maxBytes < file.sizeBytes
      || file.maxBytes > MAX_FILE_BYTES) {
      throw new Error(`${context} is malformed or exceeds declared size limits`);
    }
    if (inputPaths.has(file.path)) throw new Error(`duplicate expected input path: ${file.path}`);
    inputPaths.add(file.path);
    maximumBytes += file.maxBytes;
    if (maximumBytes > parsed.maxTotalBytes) throw new Error('input size limits exceed maxTotalBytes');
    expectedFiles.push({
      path: file.path,
      sha256: file.sha256,
      sizeBytes: file.sizeBytes,
      maxBytes: file.maxBytes,
      role: context
    });
  };

  for (const [index, artifact] of parsed.artifacts.entries()) {
    const label = `artifact[${index}]`;
    if (!exactKeys(artifact, ['artifactId', 'runId', 'runCommitSha', 'name', 'kind', 'zip', 'members'])
      || !positiveInteger(artifact.artifactId)
      || artifactIds.has(artifact.artifactId)
      || !positiveInteger(artifact.runId)
      || typeof artifact.runCommitSha !== 'string'
      || !COMMIT.test(artifact.runCommitSha)
      || typeof artifact.name !== 'string'
      || artifact.name.trim().length === 0
      || !KINDS.has(artifact.kind)
      || !exactKeys(artifact.zip, ['path', 'sha256', 'sizeBytes', 'maxBytes'])
      || !Array.isArray(artifact.members)
      || artifact.members.length === 0) {
      throw new Error(`${label} is malformed or ambiguous`);
    }
    artifactIds.add(artifact.artifactId);
    addFile(artifact.zip, `${artifact.kind}:archive`);
    const memberNames = new Set();
    for (const [memberIndex, member] of artifact.members.entries()) {
      memberCount++;
      if (memberCount > MAX_MEMBERS) throw new Error('manifest has too many payload members');
      if (!exactKeys(member, ['name', 'path', 'sha256', 'sizeBytes', 'maxBytes'])
        || memberNames.has(member.name)) {
        throw new Error(`${label}.members[${memberIndex}] is malformed or duplicated`);
      }
      memberNames.add(member.name);
      addFile(member, `${artifact.kind}:payload`, true);
    }
  }
  return {manifest: parsed, expectedFiles};
}

export function verifyReceiptManifest(manifestText, suppliedFiles) {
  let parsed;
  try {
    parsed = parseReceiptManifest(manifestText);
  } catch (error) {
    return {
      schemaVersion: SCHEMA,
      status: 'INVALID_MANIFEST',
      verified: false,
      scope: 'EXACT_SUPPLIED_BYTES_ONLY',
      zipMemberVerification: 'NOT_PERFORMED',
      errors: [error.message],
      files: []
    };
  }
  if (!Array.isArray(suppliedFiles)) suppliedFiles = [];

  const expectedPaths = new Set(parsed.expectedFiles.map(file => file.path));
  const suppliedByPath = new Map();
  const errors = [];
  for (const supplied of suppliedFiles) {
    if (!object(supplied) || typeof supplied.path !== 'string') {
      errors.push('supplied input must have a path');
      continue;
    }
    if (suppliedByPath.has(supplied.path)) {
      errors.push(`duplicate supplied input path: ${supplied.path}`);
      continue;
    }
    suppliedByPath.set(supplied.path, supplied);
    if (!expectedPaths.has(supplied.path)) errors.push(`extra supplied input: ${supplied.path}`);
  }

  const files = parsed.expectedFiles.map(expected => {
    const supplied = suppliedByPath.get(expected.path);
    if (!supplied || supplied.data === null || supplied.data === undefined) {
      if (supplied?.error) errors.push(`input rejected: ${expected.path}`);
      return {
        path: expected.path,
        role: expected.role,
        expectedSha256: expected.sha256,
        observedSha256: null,
        expectedSizeBytes: expected.sizeBytes,
        observedSizeBytes: null,
        status: supplied?.error ? 'REJECTED' : 'UNAVAILABLE',
        error: supplied?.error ?? 'input not supplied'
      };
    }
    if (supplied.error) {
      errors.push(`input rejected: ${expected.path}`);
      return {
        path: expected.path,
        role: expected.role,
        expectedSha256: expected.sha256,
        observedSha256: null,
        expectedSizeBytes: expected.sizeBytes,
        observedSizeBytes: null,
        status: 'REJECTED',
        error: String(supplied.error)
      };
    }
    if (!(Buffer.isBuffer(supplied.data) || supplied.data instanceof Uint8Array)) {
      errors.push(`input is not bytes: ${expected.path}`);
      return {
        path: expected.path,
        role: expected.role,
        expectedSha256: expected.sha256,
        observedSha256: null,
        expectedSizeBytes: expected.sizeBytes,
        observedSizeBytes: null,
        status: 'MISMATCH',
        error: 'input is not bytes'
      };
    }
    const data = Buffer.isBuffer(supplied.data)
      ? supplied.data
      : Buffer.from(supplied.data.buffer, supplied.data.byteOffset, supplied.data.byteLength);
    if (data.length > expected.maxBytes) {
      errors.push(`input exceeds maxBytes: ${expected.path}`);
      return {
        path: expected.path,
        role: expected.role,
        expectedSha256: expected.sha256,
        observedSha256: crypto.createHash('sha256').update(data).digest('hex'),
        expectedSizeBytes: expected.sizeBytes,
        observedSizeBytes: data.length,
        status: 'MISMATCH',
        error: 'input exceeds maxBytes'
      };
    }
    const observedSha256 = crypto.createHash('sha256').update(data).digest('hex');
    const matches = data.length === expected.sizeBytes && observedSha256 === expected.sha256;
    if (!matches) errors.push(`digest or size mismatch: ${expected.path}`);
    return {
      path: expected.path,
      role: expected.role,
      expectedSha256: expected.sha256,
      observedSha256,
      expectedSizeBytes: expected.sizeBytes,
      observedSizeBytes: data.length,
      status: matches ? 'VERIFIED' : 'MISMATCH'
    };
  });

  const hasUnavailable = files.some(file => file.status === 'UNAVAILABLE');
  const status = errors.length > 0 ? 'MISMATCH' : hasUnavailable ? 'UNAVAILABLE' : 'VERIFIED';
  return {
    schemaVersion: SCHEMA,
    status,
    verified: status === 'VERIFIED',
    scope: 'EXACT_SUPPLIED_BYTES_ONLY',
    zipMemberVerification: 'NOT_PERFORMED',
    expectedInputCount: parsed.expectedFiles.length,
    suppliedInputCount: suppliedByPath.size,
    errors,
    files
  };
}

export function readLocalFileWithoutSymlinks(filePath, maxBytes, maxTotalBytes = MAX_TOTAL_BYTES) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > MAX_FILE_BYTES) {
    const error = new Error('maxBytes is outside the supported limit');
    error.code = 'EINVAL';
    throw error;
  }
  if (!Number.isSafeInteger(maxTotalBytes) || maxTotalBytes < 0 || maxTotalBytes > MAX_TOTAL_BYTES) {
    const error = new Error('maxTotalBytes is outside the supported limit');
    error.code = 'EINVAL';
    throw error;
  }
  const absolutePath = path.resolve(filePath);
  const {root} = path.parse(absolutePath);
  const segments = absolutePath.slice(root.length).split(path.sep).filter(Boolean);
  let current = root;
  const components = [];
  let finalStat;
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      const error = new Error(`symbolic links are not accepted: ${current}`);
      error.code = 'ELOOP';
      throw error;
    }
    if (index < segments.length - 1 && !stat.isDirectory()) {
      const error = new Error(`input parent is not a directory: ${current}`);
      error.code = 'ENOTDIR';
      throw error;
    }
    components.push({path: current, dev: stat.dev, ino: stat.ino});
    if (index === segments.length - 1) finalStat = stat;
  }
  if (!finalStat?.isFile()) {
    const error = new Error(`input is not a regular file: ${absolutePath}`);
    error.code = 'EINVAL';
    throw error;
  }
  if (finalStat.size > maxBytes || finalStat.size > maxTotalBytes) {
    const error = new Error(`input exceeds a declared size limit: ${absolutePath}`);
    error.code = 'EFBIG';
    throw error;
  }
  const descriptor = fs.openSync(absolutePath,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.dev !== finalStat.dev || stat.ino !== finalStat.ino) {
      const error = new Error(`input changed while opening: ${absolutePath}`);
      error.code = 'ESTALE';
      throw error;
    }
    for (const component of components) {
      const currentStat = fs.lstatSync(component.path);
      if (currentStat.isSymbolicLink() || currentStat.dev !== component.dev || currentStat.ino !== component.ino) {
        const error = new Error(`input path changed while opening: ${component.path}`);
        error.code = 'ESTALE';
        throw error;
      }
    }
    if (stat.size > maxBytes || stat.size > maxTotalBytes) {
      const error = new Error(`input exceeds a declared size limit: ${absolutePath}`);
      error.code = 'EFBIG';
      throw error;
    }
    const output = Buffer.allocUnsafe(stat.size);
    let bytesRead = 0;
    while (bytesRead < output.length) {
      const count = fs.readSync(descriptor, output, bytesRead, output.length - bytesRead, null);
      if (count === 0) break;
      bytesRead += count;
    }
    if (bytesRead === stat.size) {
      const sentinel = Buffer.allocUnsafe(1);
      if (fs.readSync(descriptor, sentinel, 0, 1, null) > 0) {
        const error = new Error(`input grew while reading: ${absolutePath}`);
        error.code = 'EFBIG';
        throw error;
      }
    }
    if (bytesRead > maxBytes || bytesRead > maxTotalBytes) {
      const error = new Error(`input exceeds a declared size limit: ${absolutePath}`);
      error.code = 'EFBIG';
      throw error;
    }
    return output.subarray(0, bytesRead);
  } finally {
    fs.closeSync(descriptor);
  }
}

function parseArguments(args) {
  let manifestPath;
  const inputs = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--manifest' && manifestPath === undefined && args[index + 1]) {
      manifestPath = args[++index];
    } else if (args[index] === '--input' && args[index + 1]) {
      const pair = args[++index];
      const separator = pair.indexOf('=');
      if (separator <= 0 || separator === pair.length - 1) throw new Error('--input must be expected/path=local/path');
      inputs.push({path: pair.slice(0, separator), localPath: pair.slice(separator + 1)});
    } else {
      throw new Error(`unexpected or incomplete argument: ${args[index]}`);
    }
  }
  if (!manifestPath) throw new Error('--manifest is required');
  return {manifestPath, inputs};
}

function main() {
  let cli;
  try {
    cli = parseArguments(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
    return;
  }

  let manifestText;
  let parsed;
  try {
    manifestText = new TextDecoder('utf-8', {fatal: true})
      .decode(readLocalFileWithoutSymlinks(cli.manifestPath, MAX_MANIFEST_BYTES, MAX_MANIFEST_BYTES));
    parsed = parseReceiptManifest(manifestText);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      schemaVersion: SCHEMA,
      status: 'INVALID_MANIFEST',
      verified: false,
      scope: 'EXACT_SUPPLIED_BYTES_ONLY',
      zipMemberVerification: 'NOT_PERFORMED',
      errors: [error.message],
      files: []
    }, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }

  const limits = new Map(parsed.expectedFiles.map(file => [file.path, file.maxBytes]));
  const suppliedPaths = new Set();
  const localPaths = new Set();
  const preflightErrors = cli.inputs.map(input => {
    const localPath = path.resolve(input.localPath);
    if (!limits.has(input.path)) return 'extra input path';
    if (suppliedPaths.has(input.path)) return 'duplicate supplied input path';
    if (localPaths.has(localPath)) return 'duplicate local input identity';
    suppliedPaths.add(input.path);
    localPaths.add(localPath);
    return null;
  });
  const invalidInputs = preflightErrors.some(Boolean);
  let remainingBytes = parsed.manifest.maxTotalBytes;
  const suppliedFiles = cli.inputs.map((input, index) => {
    const maxBytes = limits.get(input.path);
    if (preflightErrors[index]) return {path: input.path, data: null, error: preflightErrors[index]};
    if (invalidInputs) return {path: input.path, data: null, error: 'input set failed preflight'};
    try {
      const data = readLocalFileWithoutSymlinks(input.localPath, maxBytes, remainingBytes);
      remainingBytes -= data.length;
      return {path: input.path, data};
    } catch (error) {
      return {path: input.path, data: null, error: error.code === 'ENOENT' ? undefined : error.code ?? error.message};
    }
  });
  const result = verifyReceiptManifest(manifestText, suppliedFiles);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.verified) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
