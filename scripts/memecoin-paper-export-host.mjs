import {timingSafeEqual} from "node:crypto";
import {constants} from "node:fs";
import {mkdir, open, lstat} from "node:fs/promises";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {createPrivateReceiverHandler} from "./memecoin-paper-run-export-https/https.mjs";
import {createFileReceiver} from "./memecoin-paper-run-export-transfer/index.mjs";

export const PAPER_EXPORT_MOUNT_ROOT = "/var/data/meridian-paper";
const MAX_SECRET_FILE_BYTES = 16 * 1024;
const MAX_SHUTDOWN_MS = 5_000;

function absolutePath(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value) || path.normalize(value) !== value) {
    throw new TypeError(`${label} must be a normalized absolute path`);
  }
  return value;
}

function normalizeOrigin(value) {
  if (typeof value !== "string" || value.length > 255) {
    throw new TypeError("private origin must be a fixed HTTPS origin");
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("private origin must be a fixed HTTPS origin");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" ||
      url.search || url.hash || url.origin !== value) {
    throw new TypeError("private origin must be a canonical fixed HTTPS origin");
  }
  return url;
}

function parsePort(value) {
  if (typeof value !== "string" || !/^[1-9]\d{0,4}$/.test(value)) {
    throw new TypeError("listener port must be an explicit TCP port");
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port > 65_535) {
    throw new TypeError("listener port must be an explicit TCP port");
  }
  return port;
}

function requiredString(env, name) {
  const value = env[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`missing ${name}`);
  }
  return value;
}

export function paperExportHostConfigFromEnvironment(env = process.env) {
  const enabled = env.PAPER_EXPORT_HOST_ENABLED;
  if (enabled === undefined || enabled === "false") return {enabled: false};
  if (enabled !== "true") throw new TypeError("PAPER_EXPORT_HOST_ENABLED must be true or false");

  const privateOrigin = normalizeOrigin(requiredString(env, "PAPER_EXPORT_HOST_ORIGIN"));
  const listenHost = requiredString(env, "PAPER_EXPORT_HOST_LISTEN_HOST");
  if (net.isIP(listenHost) === 0) throw new TypeError("listener host must be an IP address");
  const port = parsePort(requiredString(env, "PAPER_EXPORT_HOST_PORT"));
  if (Number(privateOrigin.port) !== port) {
    throw new TypeError("origin port must match the listener port");
  }

  const mountRoot = absolutePath(requiredString(env, "PAPER_EXPORT_HOST_MOUNT_ROOT"), "mount root");
  if (mountRoot !== PAPER_EXPORT_MOUNT_ROOT) {
    throw new TypeError("mount root must be /var/data/meridian-paper");
  }
  const storageRoot = absolutePath(requiredString(env, "PAPER_EXPORT_HOST_STORAGE_ROOT"), "storage root");
  if (path.dirname(storageRoot) !== mountRoot) {
    throw new TypeError("storage root must be a direct child of the configured mount root");
  }

  return {
    enabled: true,
    privateOrigin: privateOrigin.origin,
    listenHost,
    port,
    mountRoot,
    storageRoot,
    certificateFile: absolutePath(
      requiredString(env, "PAPER_EXPORT_HOST_TLS_CERT_FILE"), "certificate file"
    ),
    privateKeyFile: absolutePath(
      requiredString(env, "PAPER_EXPORT_HOST_TLS_KEY_FILE"), "private key file"
    ),
    writeAuthorizationFile: absolutePath(
      requiredString(env, "PAPER_EXPORT_HOST_WRITE_AUTH_FILE"), "write authorization file"
    ),
    readAuthorizationFile: absolutePath(
      requiredString(env, "PAPER_EXPORT_HOST_READ_AUTH_FILE"), "read authorization file"
    )
  };
}

async function readPrivateFile(filename, label, maximum) {
  const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0 ||
        stat.size < 1 || stat.size > maximum) {
      throw new TypeError(`${label} file has unsafe ownership, permissions, or size`);
    }
    const bytes = await handle.readFile();
    if (bytes.byteLength > maximum) throw new RangeError(`${label} file exceeds its byte limit`);
    return bytes;
  } finally {
    await handle.close();
  }
}

async function readAuthorizationFile(filename, label) {
  const bytes = await readPrivateFile(filename, label, 4096);
  const value = new TextDecoder("utf-8", {fatal: true}).decode(bytes);
  if (!value || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError(`${label} file must contain one nonempty authorization value`);
  }
  return Buffer.from(value);
}

function tokenMatches(expected, value) {
  if (typeof value !== "string") return false;
  const actual = Buffer.from(value);
  return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected);
}

async function validateStorageRoot(mountRoot, storageRoot) {
  const uid = process.getuid();
  const root = path.parse(mountRoot).root;
  const components = mountRoot.slice(root.length).split(path.sep).filter(Boolean);
  let current = root;
  for (let index = 0; index <= components.length; index += 1) {
    if (index > 0) current = path.join(current, components[index - 1]);
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink() ||
        (stat.uid !== 0 && stat.uid !== uid)) {
      throw new TypeError("mount ancestry must be trusted directories owned by root or the runtime UID");
    }
    const writableByOthers = (stat.mode & 0o022) !== 0;
    const isMountRoot = current === mountRoot;
    const safeStickyAncestor = !isMountRoot && stat.uid === 0 &&
      (stat.mode & 0o1000) !== 0;
    if (writableByOthers && !safeStickyAncestor) {
      throw new TypeError("mount ancestry is group- or world-writable");
    }
  }

  const mountStat = await lstat(mountRoot);
  if ((mountStat.mode & 0o022) !== 0) {
    throw new TypeError("mount root is group- or world-writable");
  }
  try {
    await mkdir(storageRoot, {mode: 0o700});
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const storageStat = await lstat(storageRoot);
  if (!storageStat.isDirectory() || storageStat.isSymbolicLink() ||
      storageStat.uid !== uid || (storageStat.mode & 0o077) !== 0) {
    throw new TypeError("storage root must be a runtime-owned private directory");
  }
}

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    const onError = error => {
      server.removeListener("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

export async function createPaperExportServer(config) {
  if (!config || config.enabled !== true) throw new TypeError("explicit host enable is required");
  if (typeof process.getuid !== "function" || process.getuid() === 0) {
    throw new TypeError("Paper export host requires a nonroot runtime");
  }
  const originUrl = normalizeOrigin(config.privateOrigin);
  if (typeof config.listenHost !== "string" || net.isIP(config.listenHost) === 0 ||
      !Number.isSafeInteger(config.port) || config.port < 1 || config.port > 65_535 ||
      Number(originUrl.port) !== config.port ||
      absolutePath(config.mountRoot, "mount root") !== config.mountRoot ||
      absolutePath(config.storageRoot, "storage root") !== config.storageRoot ||
      absolutePath(config.certificateFile, "certificate file") !== config.certificateFile ||
      absolutePath(config.privateKeyFile, "private key file") !== config.privateKeyFile ||
      absolutePath(config.writeAuthorizationFile, "write authorization file") !==
        config.writeAuthorizationFile ||
      absolutePath(config.readAuthorizationFile, "read authorization file") !==
        config.readAuthorizationFile ||
      path.dirname(config.storageRoot) !== config.mountRoot) {
    throw new TypeError("invalid private Paper host configuration");
  }
  await validateStorageRoot(config.mountRoot, config.storageRoot);

  const [certificate, privateKey, writeToken, readToken] = await Promise.all([
    readPrivateFile(config.certificateFile, "TLS certificate", MAX_SECRET_FILE_BYTES),
    readPrivateFile(config.privateKeyFile, "TLS private key", MAX_SECRET_FILE_BYTES),
    readAuthorizationFile(config.writeAuthorizationFile, "write authorization"),
    readAuthorizationFile(config.readAuthorizationFile, "read authorization")
  ]);
  if (writeToken.byteLength === readToken.byteLength &&
      timingSafeEqual(writeToken, readToken)) {
    throw new TypeError("read and write authorization scopes must differ");
  }

  const receiver = createFileReceiver({
    directory: config.storageRoot,
    privateOrigin: originUrl.origin,
    authorizeWrite: value => tokenMatches(writeToken, value),
    authorizeRead: value => tokenMatches(readToken, value)
  });
  const handler = createPrivateReceiverHandler({
    receiver,
    privateOrigin: originUrl.origin,
    timeoutMs: 15_000
  });
  const server = https.createServer({
    cert: certificate,
    key: privateKey,
    maxHeaderSize: 8 * 1024,
    headersTimeout: 10_000,
    requestTimeout: 20_000,
    keepAliveTimeout: 5_000
  }, handler);
  server.on("clientError", (_error, socket) => socket.destroy());
  return server;
}

export async function closePaperExportServer(server, timeoutMs = MAX_SHUTDOWN_MS) {
  if (!server?.listening) return;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_SHUTDOWN_MS) {
    throw new RangeError("shutdown timeout is outside its bound");
  }
  let timeout;
  const closed = new Promise(resolve => {
    server.close(() => resolve());
    server.closeIdleConnections?.();
  });
  const forced = new Promise(resolve => {
    timeout = setTimeout(() => {
      server.closeAllConnections?.();
      resolve();
    }, timeoutMs);
  });
  await Promise.race([closed, forced]);
  clearTimeout(timeout);
}

function writeResult(stdout, value) {
  stdout.write(`${JSON.stringify(value)}\n`);
}

export async function runPaperExportHost(config, {
  stdout = process.stdout,
  signalSource = process
} = {}) {
  let server;
  try {
    server = await createPaperExportServer(config);
    await listen(server, config.listenHost, config.port);
  } catch {
    if (server) await closePaperExportServer(server);
    writeResult(stdout, {status: "BLOCKED", code: "HOST_NOT_STARTED", listenerStarted: false});
    return 2;
  }
  writeResult(stdout, {status: "LISTENING", tls: true});
  return new Promise(resolve => {
    let stopping = false;
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      signalSource.removeListener("SIGINT", stop);
      signalSource.removeListener("SIGTERM", stop);
      await closePaperExportServer(server);
      resolve(0);
    };
    signalSource.once("SIGINT", stop);
    signalSource.once("SIGTERM", stop);
  });
}

export async function main({env = process.env, stdout = process.stdout, signalSource = process} = {}) {
  let config;
  try {
    config = paperExportHostConfigFromEnvironment(env);
  } catch {
    writeResult(stdout, {status: "BLOCKED", code: "HOST_CONFIGURATION_INVALID", listenerStarted: false});
    return 2;
  }
  if (!config.enabled) {
    writeResult(stdout, {status: "DISABLED", listenerStarted: false});
    return 0;
  }
  return runPaperExportHost(config, {stdout, signalSource});
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
