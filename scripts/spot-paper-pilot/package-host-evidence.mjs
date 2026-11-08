#!/usr/bin/env node
import {createHash} from "node:crypto";
import {constants} from "node:fs";
import {
  lstat, open, readdir, realpath, unlink
} from "node:fs/promises";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {performance} from "node:perf_hooks";

const UTF8 = new TextDecoder("utf-8", {fatal: true});
export const EVIDENCE_PACKAGE_LIMITS = Object.freeze({
  maxResponseFiles: 960,
  maxResponseBytes: 64 * 1024 * 1024,
  maxResponseFileBytes: 256 * 1024,
  maxJournalBytes: 8 * 1024 * 1024,
  maxMetadataBytes: 1024 * 1024,
  maxTotalBytes: 73 * 1024 * 1024,
  maxFiles: 1024,
  maxDirectories: 256,
  maxDepth: 8,
  maxArchiveBytes: 80 * 1024 * 1024,
  maxManifestBytes: 1024 * 1024,
  maxOperationMs: 60_000
});

const BLOCK_BYTES = 512;
const READ_BYTES = 64 * 1024;
const ZERO_BLOCK = Buffer.alloc(BLOCK_BYTES);
const MAX_INPUT_BYTES = EVIDENCE_PACKAGE_LIMITS.maxTotalBytes;
const {O_NOFOLLOW = 0, O_NONBLOCK = 0, O_DIRECTORY = 0} = constants;

function packageError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function active(context) {
  if (!Number.isFinite(context.monotonicNow()) ||
      context.monotonicNow() >= context.deadlineAt) {
    throw packageError("PACKAGE_DEADLINE_EXCEEDED");
  }
}

function within(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) &&
    relative !== ".." && !path.isAbsolute(relative));
}

function validateRelativePath(value) {
  if (typeof value !== "string" || !value || value.startsWith("/") ||
      value.includes("\\") || value.includes("\0") || /[\u0000-\u001f\u007f]/.test(value)) {
    throw packageError("UNSAFE_EVIDENCE_PATH");
  }
  const segments = value.split("/");
  if (segments.some(segment => !segment || segment === "." || segment === ".." ||
      Buffer.byteLength(segment, "utf8") > 100)) {
    throw packageError("UNSAFE_EVIDENCE_PATH");
  }
  if (/^[A-Za-z]:/.test(segments[0])) throw packageError("UNSAFE_EVIDENCE_PATH");
  const nameLength = Buffer.byteLength(segments.at(-1), "utf8");
  const prefixLength = Buffer.byteLength(segments.slice(0, -1).join("/"), "utf8");
  if (nameLength > 100 || prefixLength > 155) {
    throw packageError("UNSUPPORTED_EVIDENCE_PATH_LENGTH");
  }
  return segments;
}

function metadata(info) {
  return {
    dev: String(info.dev),
    ino: String(info.ino),
    mode: String(info.mode),
    uid: String(info.uid),
    gid: String(info.gid),
    nlink: String(info.nlink),
    size: String(info.size),
    mtimeNs: String(info.mtimeNs),
    ctimeNs: String(info.ctimeNs)
  };
}

function sameMetadata(left, right) {
  return Object.keys(left).every(key => left[key] === right[key]);
}

async function assertNoSymlinkDirectory(directory, io, context) {
  if (!path.isAbsolute(directory) || path.resolve(directory) !== directory) {
    throw packageError("ABSOLUTE_NORMALIZED_PATH_REQUIRED");
  }
  let current = path.parse(directory).root;
  const segments = directory.slice(current.length).split(path.sep).filter(Boolean);
  for (const segment of segments) {
    active(context);
    current = path.join(current, segment);
    const info = await (io.lstat ?? lstat)(current, {bigint: true});
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw packageError("PATH_ANCESTRY_NOT_REAL_DIRECTORY");
    }
  }
  const actual = await (io.realpath ?? realpath)(directory);
  if (actual !== directory) throw packageError("PATH_NOT_CANONICAL");
}

function category(relativePath, type, size) {
  if (type !== "file") return "directory";
  const parts = relativePath.split("/");
  if (parts.includes("responses")) {
    if (size > EVIDENCE_PACKAGE_LIMITS.maxResponseFileBytes) {
      throw packageError("RESPONSE_FILE_SIZE_LIMIT");
    }
    return "response";
  }
  if (parts.at(-1) === "journal.json") {
    if (size > EVIDENCE_PACKAGE_LIMITS.maxJournalBytes) {
      throw packageError("JOURNAL_SIZE_LIMIT");
    }
    return "journal";
  }
  return "metadata";
}

async function scanTree(root, context, io) {
  const rootInfo = await (io.lstat ?? lstat)(root, {bigint: true});
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    throw packageError("INVALID_EVIDENCE_ROOT");
  }
  const entries = [];
  const totals = {files: 0, directories: 0, totalBytes: 0, responseBytes: 0,
    responseFiles: 0, journalBytes: 0, metadataBytes: 0};
  const visit = async (directory, prefix, depth) => {
    active(context);
    const names = await (io.readdir ?? readdir)(directory, {encoding: "buffer"});
    names.sort(Buffer.compare);
    for (const rawName of names) {
      active(context);
      let name;
      try {
        name = UTF8.decode(rawName);
      } catch {
        throw packageError("UNSUPPORTED_EVIDENCE_PATH_ENCODING");
      }
      if (!Buffer.from(name, "utf8").equals(rawName)) {
        throw packageError("UNSUPPORTED_EVIDENCE_PATH_ENCODING");
      }
      const relativePath = prefix ? `${prefix}/${name}` : name;
      const segments = validateRelativePath(relativePath);
      const fullPath = path.join(directory, name);
      const info = await (io.lstat ?? lstat)(fullPath, {bigint: true});
      if (info.isSymbolicLink()) throw packageError("SYMLINK_IN_EVIDENCE_TREE");
      if (info.isDirectory()) {
        if (depth + 1 > EVIDENCE_PACKAGE_LIMITS.maxDepth) {
          throw packageError("EVIDENCE_DEPTH_LIMIT");
        }
        entries.push({path: relativePath, type: "directory", info: metadata(info)});
        totals.directories += 1;
        if (totals.directories > EVIDENCE_PACKAGE_LIMITS.maxDirectories) {
          throw packageError("EVIDENCE_DIRECTORY_COUNT_LIMIT");
        }
        await visit(fullPath, relativePath, depth + 1);
        continue;
      }
      if (!info.isFile()) throw packageError("SPECIAL_FILE_IN_EVIDENCE_TREE");
      const size = Number(info.size);
      if (!Number.isSafeInteger(size) || size < 0 ||
          size > EVIDENCE_PACKAGE_LIMITS.maxTotalBytes) {
        throw packageError("EVIDENCE_FILE_SIZE_LIMIT");
      }
      const entry = {path: relativePath, type: "file", size, info: metadata(info)};
      entry.category = category(relativePath, "file", size);
      entries.push(entry);
      totals.files += 1;
      totals.totalBytes += size;
      if (entry.category === "response") {
        totals.responseFiles += 1;
        totals.responseBytes += size;
      } else if (entry.category === "journal") {
        totals.journalBytes += size;
      } else {
        totals.metadataBytes += size;
      }
      if (totals.files > EVIDENCE_PACKAGE_LIMITS.maxFiles) {
        throw packageError("EVIDENCE_FILE_COUNT_LIMIT");
      }
      if (totals.responseFiles > EVIDENCE_PACKAGE_LIMITS.maxResponseFiles) {
        throw packageError("RESPONSE_FILE_COUNT_LIMIT");
      }
      if (totals.responseBytes > EVIDENCE_PACKAGE_LIMITS.maxResponseBytes) {
        throw packageError("RESPONSE_BYTES_LIMIT");
      }
      if (totals.metadataBytes > EVIDENCE_PACKAGE_LIMITS.maxMetadataBytes) {
        throw packageError("EVIDENCE_METADATA_BYTES_LIMIT");
      }
      if (totals.totalBytes > EVIDENCE_PACKAGE_LIMITS.maxTotalBytes ||
          totals.journalBytes > EVIDENCE_PACKAGE_LIMITS.maxJournalBytes) {
        throw packageError("EVIDENCE_TOTAL_BYTES_LIMIT");
      }
      if (segments.length > EVIDENCE_PACKAGE_LIMITS.maxDepth) {
        throw packageError("EVIDENCE_DEPTH_LIMIT");
      }
    }
  };
  await visit(root, "", 0);
  entries.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return {entries, rootInfo: metadata(rootInfo), totals};
}

function sameTree(left, right) {
  return sameMetadata(left.rootInfo, right.rootInfo) &&
    left.entries.length === right.entries.length &&
    left.entries.every((entry, index) => entry.path === right.entries[index].path &&
      entry.type === right.entries[index].type &&
      sameMetadata(entry.info, right.entries[index].info));
}

async function readFileSnapshot(root, entry, context, io) {
  active(context);
  const filename = path.join(root, ...entry.path.split("/"));
  const handle = await (io.open ?? open)(filename,
    constants.O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
  try {
    const first = await handle.stat({bigint: true});
    if (!first.isFile() || !sameMetadata(entry.info, metadata(first))) {
      throw packageError("EVIDENCE_CHANGED_DURING_PACKAGE");
    }
    const limit = entry.category === "response" ?
      EVIDENCE_PACKAGE_LIMITS.maxResponseFileBytes :
      entry.category === "journal" ? EVIDENCE_PACKAGE_LIMITS.maxJournalBytes :
        EVIDENCE_PACKAGE_LIMITS.maxMetadataBytes;
    const chunks = [];
    let length = 0;
    const hash = createHash("sha256");
    for (;;) {
      active(context);
      const buffer = Buffer.alloc(Math.min(READ_BYTES, limit - length + 1));
      const {bytesRead} = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
      if (length > limit || length > MAX_INPUT_BYTES) {
        throw packageError("EVIDENCE_FILE_GREW_DURING_PACKAGE");
      }
      const chunk = buffer.subarray(0, bytesRead);
      chunks.push(chunk);
      hash.update(chunk);
    }
    const last = await handle.stat({bigint: true});
    if (length !== entry.size || !sameMetadata(entry.info, metadata(last))) {
      throw packageError("EVIDENCE_CHANGED_DURING_PACKAGE");
    }
    return {bytes: Buffer.concat(chunks, length), sha256: hash.digest("hex")};
  } finally {
    await handle.close();
  }
}

function writeText(buffer, value, offset, length) {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length > length) throw packageError("UNSUPPORTED_EVIDENCE_PATH_LENGTH");
  bytes.copy(buffer, offset);
}

function writeOctal(buffer, offset, length, value) {
  if (!Number.isSafeInteger(value) || value < 0) throw packageError("INVALID_TAR_NUMBER");
  const octal = value.toString(8).padStart(length - 1, "0");
  if (octal.length >= length) throw packageError("INVALID_TAR_NUMBER");
  buffer.write(`${octal}\0`, offset, length, "ascii");
}

function tarHeader(relativePath, type, size) {
  const segments = relativePath.split("/");
  const name = segments.pop();
  const prefix = segments.join("/");
  if (Buffer.byteLength(name, "utf8") > 100 ||
      Buffer.byteLength(prefix, "utf8") > 155) {
    throw packageError("UNSUPPORTED_EVIDENCE_PATH_LENGTH");
  }
  const header = Buffer.alloc(BLOCK_BYTES);
  writeText(header, name, 0, 100);
  writeOctal(header, 100, 8, type === "directory" ? 0o700 : 0o600);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, type === "file" ? size : 0);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header[156] = type === "directory" ? 0x35 : 0x30;
  writeText(header, "ustar\0", 257, 6);
  writeText(header, "00", 263, 2);
  if (prefix) writeText(header, prefix, 345, 155);
  let checksum = 0;
  for (const byte of header) checksum += byte;
  const checksumText = checksum.toString(8).padStart(6, "0");
  header.write(`${checksumText}\0 `, 148, 8, "ascii");
  return header;
}

function padLength(size) {
  return (BLOCK_BYTES - (size % BLOCK_BYTES)) % BLOCK_BYTES;
}

function buildTar(entries, fileBytes) {
  const chunks = [];
  let length = 0;
  const add = chunk => {
    length += chunk.byteLength;
    if (length > EVIDENCE_PACKAGE_LIMITS.maxArchiveBytes) {
      throw packageError("ARCHIVE_SIZE_LIMIT");
    }
    chunks.push(chunk);
  };
  for (const entry of entries) {
    const bytes = entry.type === "file" ? fileBytes.get(entry.path) : null;
    add(tarHeader(entry.path, entry.type, bytes?.byteLength ?? 0));
    if (bytes) {
      add(bytes);
      if (padLength(bytes.byteLength)) add(Buffer.alloc(padLength(bytes.byteLength)));
    }
  }
  add(ZERO_BLOCK);
  add(ZERO_BLOCK);
  return Buffer.concat(chunks, length);
}

function readText(buffer, start, length) {
  const bytes = buffer.subarray(start, start + length);
  const end = bytes.indexOf(0);
  return bytes.subarray(0, end < 0 ? bytes.length : end).toString("utf8");
}

function readOctal(buffer, start, length) {
  const value = readText(buffer, start, length).trim();
  if (!/^[0-7]+$/.test(value)) throw packageError("INVALID_TAR_HEADER");
  const number = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(number)) throw packageError("INVALID_TAR_HEADER");
  return number;
}

function verifyTarRoundTrip(tarBytes, entries, fileBytes) {
  const expected = new Map(entries.map(entry => [entry.path, entry]));
  const seen = new Set();
  let offset = 0;
  while (offset + BLOCK_BYTES <= tarBytes.byteLength) {
    const header = tarBytes.subarray(offset, offset + BLOCK_BYTES);
    if (header.equals(ZERO_BLOCK)) {
      if (!tarBytes.subarray(offset).equals(Buffer.alloc(tarBytes.byteLength - offset)) ||
          tarBytes.byteLength - offset !== BLOCK_BYTES * 2) {
        throw packageError("INVALID_TAR_END");
      }
      if (seen.size !== expected.size) throw packageError("ARCHIVE_ROUND_TRIP_MISMATCH");
      return true;
    }
    const expectedChecksum = readOctal(header, 148, 8);
    const checksumHeader = Buffer.from(header);
    checksumHeader.fill(0x20, 148, 156);
    const actualChecksum = checksumHeader.reduce((sum, byte) => sum + byte, 0);
    if (expectedChecksum !== actualChecksum) throw packageError("INVALID_TAR_CHECKSUM");
    const name = readText(header, 0, 100);
    const prefix = readText(header, 345, 155);
    const relativePath = prefix ? `${prefix}/${name}` : name;
    validateRelativePath(relativePath);
    const type = header[156] === 0x35 ? "directory" :
      header[156] === 0x30 || header[156] === 0 ? "file" : null;
    const entry = expected.get(relativePath);
    if (!entry || entry.type !== type || seen.has(relativePath)) {
      throw packageError("ARCHIVE_ROUND_TRIP_MISMATCH");
    }
    seen.add(relativePath);
    const size = readOctal(header, 124, 12);
    if (type === "directory") {
      if (size !== 0) throw packageError("INVALID_TAR_DIRECTORY");
      offset += BLOCK_BYTES;
      continue;
    }
    const bytesStart = offset + BLOCK_BYTES;
    const bytesEnd = bytesStart + size;
    if (size !== entry.size || bytesEnd > tarBytes.byteLength) {
      throw packageError("ARCHIVE_ROUND_TRIP_MISMATCH");
    }
    const sourceBytes = fileBytes.get(relativePath);
    if (!sourceBytes || !tarBytes.subarray(bytesStart, bytesEnd).equals(sourceBytes)) {
      throw packageError("ARCHIVE_ROUND_TRIP_MISMATCH");
    }
    offset = bytesEnd + padLength(size);
  }
  throw packageError("INVALID_TAR_END");
}

async function outputLocation(filename, evidenceRoot, io, context) {
  if (!path.isAbsolute(filename) || path.resolve(filename) !== filename) {
    throw packageError("ABSOLUTE_NORMALIZED_OUTPUT_REQUIRED");
  }
  const parent = path.dirname(filename);
  await assertNoSymlinkDirectory(parent, io, context);
  const parentReal = await (io.realpath ?? realpath)(parent);
  const finalPath = path.join(parentReal, path.basename(filename));
  if (within(evidenceRoot, finalPath)) {
    throw packageError("OUTPUT_MUST_BE_OUTSIDE_EVIDENCE");
  }
  return finalPath;
}

async function syncDirectory(directory) {
  const handle = await open(directory, constants.O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeExclusive(filename, bytes, context, io) {
  active(context);
  let handle;
  try {
    handle = await (io.open ?? open)(filename,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | O_NOFOLLOW, 0o600);
    active(context);
    await handle.writeFile(bytes);
    active(context);
    await handle.sync();
    await handle.close();
  } catch (error) {
    if (handle) {
      try {
        await handle.close();
      } catch {}
      try {
        await (io.unlink ?? unlink)(filename);
      } catch {}
    }
    throw error;
  }
}

export async function packageHostEvidence({
  evidenceDir, archivePath, manifestPath, timeoutMs = 60_000, io = {},
  monotonicNow = () => performance.now()
} = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 ||
      timeoutMs > EVIDENCE_PACKAGE_LIMITS.maxOperationMs) {
    throw packageError("INVALID_OPERATION_BOUND");
  }
  const context = {monotonicNow, deadlineAt: monotonicNow() + timeoutMs};
  if (typeof evidenceDir !== "string" || !path.isAbsolute(evidenceDir) ||
      path.resolve(evidenceDir) !== evidenceDir) {
    throw packageError("ABSOLUTE_NORMALIZED_EVIDENCE_REQUIRED");
  }
  await assertNoSymlinkDirectory(evidenceDir, io, context);
  const evidenceRoot = await (io.realpath ?? realpath)(evidenceDir);
  if (evidenceRoot === path.parse(evidenceRoot).root) {
    throw packageError("INVALID_EVIDENCE_ROOT");
  }
  const archiveOutput = await outputLocation(archivePath, evidenceRoot, io, context);
  const manifestOutput = await outputLocation(manifestPath, evidenceRoot, io, context);
  if (archiveOutput === manifestOutput) throw packageError("OUTPUT_PATHS_MUST_DIFFER");

  const initial = await scanTree(evidenceRoot, context, io);
  const fileBytes = new Map();
  const manifestEntries = [];
  for (const entry of initial.entries) {
    active(context);
    if (entry.type !== "file") continue;
    const captured = await readFileSnapshot(evidenceRoot, entry, context, io);
    fileBytes.set(entry.path, captured.bytes);
    manifestEntries.push({
      path: entry.path, sizeBytes: entry.size, sha256: captured.sha256
    });
  }
  const final = await scanTree(evidenceRoot, context, io);
  if (!sameTree(initial, final)) {
    throw packageError("EVIDENCE_CHANGED_DURING_PACKAGE");
  }

  const archiveBytes = buildTar(initial.entries, fileBytes);
  if (!verifyTarRoundTrip(archiveBytes, initial.entries, fileBytes)) {
    throw packageError("ARCHIVE_ROUND_TRIP_MISMATCH");
  }
  const afterArchive = await scanTree(evidenceRoot, context, io);
  if (!sameTree(initial, afterArchive)) {
    throw packageError("EVIDENCE_CHANGED_DURING_PACKAGE");
  }
  const manifestBytes = Buffer.from(`${JSON.stringify({
    schemaVersion: "SPOT_PAPER_HOST_EVIDENCE_MANIFEST_V1",
    preservation: "BYTE_EXACT",
    entries: manifestEntries
  }, null, 2)}\n`);
  if (manifestBytes.byteLength > EVIDENCE_PACKAGE_LIMITS.maxManifestBytes) {
    throw packageError("MANIFEST_SIZE_LIMIT");
  }
  active(context);
  const created = [];
  try {
    await writeExclusive(archiveOutput, archiveBytes, context, io);
    created.push(archiveOutput);
    await writeExclusive(manifestOutput, manifestBytes, context, io);
    created.push(manifestOutput);
    await syncDirectory(path.dirname(archiveOutput));
    if (path.dirname(manifestOutput) !== path.dirname(archiveOutput)) {
      await syncDirectory(path.dirname(manifestOutput));
    }
  } catch (error) {
    for (const filename of created.reverse()) {
      try {
        await (io.unlink ?? unlink)(filename);
      } catch {}
    }
    throw error;
  }
  return {
    schemaVersion: "SPOT_PAPER_HOST_EVIDENCE_PACKAGE_V1",
    status: "PACKAGED_BYTES_ONLY",
    scope: "BYTE_PRESERVATION_ONLY",
    archivePath: archiveOutput,
    archiveBytes: archiveBytes.byteLength,
    archiveSha256: createHash("sha256").update(archiveBytes).digest("hex"),
    manifestPath: manifestOutput,
    manifestBytes: manifestBytes.byteLength,
    fileCount: initial.totals.files,
    directoryCount: initial.totals.directories,
    totalInputBytes: initial.totals.totalBytes,
    roundTripVerified: true,
    operationalReadiness: "NOT_ASSESSED"
  };
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  if (argv.length !== 3) {
    throw packageError(
      "USAGE: package-host-evidence.mjs <absolute-evidence-dir> <absolute-archive.tar> <absolute-manifest.json>");
  }
  const result = await packageHostEvidence({
    evidenceDir: argv[0],
    archivePath: argv[1],
    manifestPath: argv[2],
    ...dependencies
  });
  (dependencies.stdout ?? process.stdout).write(`${JSON.stringify(result)}\n`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    const reason = /^[A-Z0-9_]+$/.test(error.message ?? "") ?
      error.message : /^[A-Z0-9_]+$/.test(error.code ?? "") ?
        error.code : "HOST_EVIDENCE_PACKAGE_FAILED";
    process.stderr.write(`${JSON.stringify({
      schemaVersion: "SPOT_PAPER_HOST_EVIDENCE_PACKAGE_V1",
      status: "BLOCKED",
      reason,
      scope: "BYTE_PRESERVATION_ONLY",
      operationalReadiness: "NOT_ASSESSED"
    })}\n`);
    process.exitCode = 1;
  });
}
