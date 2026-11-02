import {constants as fsConstants} from "node:fs";
import * as fsPromises from "node:fs/promises";
import path from "node:path";
import {pathToFileURL} from "node:url";

export const TARGET = "/var/data/meridian-paper";
export const REQUIRED_UID = 0;
export const REQUIRED_GID = 1000;
export const RUNTIME_UID = 1000;
export const RUNTIME_GID = 1000;
export const EXPECTED_MODE = 0o2775;
export const PROTECTED_MODE = 0o3775;

const PATH_COMPONENTS = ["/", "/var", "/var/data", TARGET];
const IDENTITY_KEYS = ["dev", "ino", "uid", "gid"];

function failure(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function modeOf(info) {
  return info.mode & 0o7777;
}

function sameIdentity(left, right) {
  return IDENTITY_KEYS.every(key => left[key] === right[key]) &&
    modeOf(left) === modeOf(right);
}

function isSafeDirectory(info) {
  return info.isDirectory() && !info.isSymbolicLink();
}

export function parseMountInfo(mountInfo) {
  const matches = [];
  for (const line of mountInfo.split(/\r?\n/)) {
    const separator = line.indexOf(" - ");
    if (separator < 0) continue;
    const fields = line.slice(0, separator).split(" ");
    if (fields.length < 5) continue;
    const mountPoint = fields[4].replace(/\\(040|011|012|134)/g, (_, code) => ({
      "040": " ",
      "011": "\t",
      "012": "\n",
      "134": "\\"
    })[code]);
    if (mountPoint === TARGET) matches.push(mountPoint);
  }
  return matches.length === 1;
}

async function validatePath(fsOps) {
  for (const component of PATH_COMPONENTS) {
    const info = await fsOps.lstat(component);
    const unsafeAncestor = component !== TARGET &&
      (info.uid !== 0 || (modeOf(info) & 0o022) !== 0);
    if (!isSafeDirectory(info) || unsafeAncestor) {
      throw failure("VOLUME_PROTECTION_PATH_UNSAFE");
    }
  }
  if (await fsOps.realpath(TARGET) !== TARGET) {
    throw failure("VOLUME_PROTECTION_PATH_UNSAFE");
  }
}

async function protectMount(fsOps, {verifyOnly = false} = {}) {
  let handle;
  let mutationAttempted = false;
  let result;
  let closeFailed = false;

  try {
    await validatePath(fsOps);
    const mountInfo = await fsOps.readFile("/proc/self/mountinfo", "utf8");
    if (!parseMountInfo(mountInfo)) throw failure("VOLUME_PROTECTION_MOUNTPOINT_MISMATCH");

    const flags = fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW;
    handle = await fsOps.open(TARGET, flags);
    const descriptorBefore = await handle.stat();
    const pathBefore = await fsOps.lstat(TARGET);

    if (!isSafeDirectory(descriptorBefore) || !isSafeDirectory(pathBefore) ||
        !sameIdentity(descriptorBefore, pathBefore)) {
      throw failure("VOLUME_PROTECTION_PATH_IDENTITY_MISMATCH");
    }
    if (descriptorBefore.uid !== REQUIRED_UID || descriptorBefore.gid !== REQUIRED_GID) {
      throw failure("VOLUME_PROTECTION_OWNER_MISMATCH");
    }

    const initialMode = modeOf(descriptorBefore);
    if (initialMode === PROTECTED_MODE) {
      result = {
        status: "ALREADY_PROTECTED",
        failureCode: null,
        volume: {uid: REQUIRED_UID, gid: REQUIRED_GID, mode: `0${PROTECTED_MODE.toString(8)}`}
      };
    } else {
      if (initialMode !== EXPECTED_MODE) throw failure("VOLUME_PROTECTION_MODE_MISMATCH");
      if (verifyOnly) throw failure("VOLUME_PROTECTION_MODE_MISMATCH");
      mutationAttempted = true;
      await handle.chmod(PROTECTED_MODE);

      const descriptorAfter = await handle.stat();
      const pathAfter = await fsOps.lstat(TARGET);
      if (!isSafeDirectory(descriptorAfter) || !isSafeDirectory(pathAfter) ||
          !sameIdentity(descriptorAfter, pathAfter) ||
          descriptorAfter.uid !== REQUIRED_UID || descriptorAfter.gid !== REQUIRED_GID ||
          modeOf(descriptorAfter) !== PROTECTED_MODE || modeOf(pathAfter) !== PROTECTED_MODE) {
        throw failure("VOLUME_PROTECTION_READBACK_UNKNOWN");
      }
      result = {
        status: "PROTECTION_APPLIED",
        failureCode: null,
        volume: {uid: REQUIRED_UID, gid: REQUIRED_GID, mode: `0${PROTECTED_MODE.toString(8)}`}
      };
    }
  } catch (error) {
    result = {
      status: mutationAttempted ? "UNKNOWN" : "BLOCKED",
      failureCode: mutationAttempted
        ? "VOLUME_PROTECTION_READBACK_UNKNOWN"
        : (error?.code?.startsWith("VOLUME_PROTECTION_")
          ? error.code
          : "VOLUME_PROTECTION_PREFLIGHT_FAILED")
    };
  } finally {
    if (handle) {
      try {
        await handle.close();
      } catch {
        closeFailed = true;
      }
    }
  }

  if (closeFailed) {
    return {
      result: {status: "UNKNOWN", failureCode: "VOLUME_PROTECTION_DESCRIPTOR_CLOSE_UNKNOWN"},
      mustExit: true
    };
  }
  return {result, mustExit: false};
}

function verifyDroppedCredentials(credentials) {
  const groups = credentials.getgroups();
  const groupsCleared = groups.length === 0 ||
    (groups.length === 1 && groups[0] === RUNTIME_GID);
  return credentials.getuid() === RUNTIME_UID &&
    credentials.geteuid() === RUNTIME_UID &&
    credentials.getgid() === RUNTIME_GID &&
    credentials.getegid() === RUNTIME_GID &&
    groupsCleared;
}

async function dropPrivileges(credentials, exitImmediately) {
  try {
    credentials.setgroups([]);
    credentials.setgid(RUNTIME_GID);
    credentials.setuid(RUNTIME_UID);
    if (!verifyDroppedCredentials(credentials)) throw failure("PRIVILEGE_DROP_FAILED");
  } catch {
    exitImmediately(1);
    throw failure("PRIVILEGE_DROP_FAILED");
  }
}

export async function runOneShot({
  mode = "DISABLED",
  fsOps = fsPromises,
  credentials = process,
  exitImmediately = code => process.exit(code)
} = {}) {
  let result;
  let mustExit = false;

  try {
    if (mode === "REPAIR" || mode === "VERIFY") {
      const realUid = credentials.getuid();
      const effectiveUid = credentials.geteuid();
      if (realUid !== 0 || effectiveUid !== 0) {
        result = {status: "BLOCKED", failureCode: "VOLUME_PROTECTION_ROOT_REQUIRED"};
      } else {
        const outcome = await protectMount(fsOps, {verifyOnly: mode === "VERIFY"});
        result = outcome.result;
        mustExit = outcome.mustExit;
      }
    } else if (mode === "DISABLED") {
      result = {status: "DISABLED", failureCode: null};
    } else {
      result = {status: "BLOCKED", failureCode: "VOLUME_PROTECTION_ARGUMENTS_INVALID"};
    }
  } catch {
    result = {status: "UNKNOWN", failureCode: "VOLUME_PROTECTION_PREFLIGHT_FAILED"};
  }

  await dropPrivileges(credentials, exitImmediately);
  if (mustExit) {
    exitImmediately(1);
    throw failure("VOLUME_PROTECTION_DESCRIPTOR_CLOSE_UNKNOWN");
  }
  return {
    ...result,
    credentials: {
      uid: credentials.getuid(),
      gid: credentials.getgid(),
      supplementaryGroupCount: credentials.getgroups().filter(
        gid => gid !== credentials.getegid()
      ).length
    }
  };
}

function parseArguments(args) {
  const allowed = new Set(["--repair", "--verify", "--keepalive"]);
  if (args.some(argument => !allowed.has(argument)) ||
      args.filter(argument => argument === "--repair").length > 1 ||
      args.filter(argument => argument === "--verify").length > 1 ||
      (args.includes("--repair") && args.includes("--verify")) ||
      args.filter(argument => argument === "--keepalive").length > 1) {
    return {mode: "INVALID", keepalive: false};
  }
  return {
    mode: args.includes("--repair")
      ? "REPAIR"
      : args.includes("--verify") ? "VERIFY" : "DISABLED",
    keepalive: args.includes("--keepalive")
  };
}

export async function main(args = process.argv.slice(2), {
  write = text => process.stdout.write(text),
  keepalive = () => setInterval(() => {}, 60_000),
  fsOps = fsPromises,
  credentials = process,
  exitImmediately = code => process.exit(code)
} = {}) {
  const parsed = parseArguments(args);
  const result = await runOneShot({
    mode: parsed.mode,
    fsOps,
    credentials,
    exitImmediately
  });
  write(`${JSON.stringify(result)}\n`);
  if (parsed.keepalive) keepalive();
  return result.status === "PROTECTION_APPLIED" ||
    result.status === "ALREADY_PROTECTED" ||
    result.status === "DISABLED" ? 0 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then(code => {
    process.exitCode = code;
  }).catch(() => {
    process.exit(1);
  });
}
