// Credential-free transport diagnostic only. Never sends a PostgreSQL startup
// packet, authentication response, or SQL. Importing this module does no I/O.
import net from 'node:net';
import tls from 'node:tls';
import {performance} from 'node:perf_hooks';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const HOST = 'ep-purple-dew-b9mbuikp.c-7.eu-central-1.aws.neon.tech';
const PORT = 5432;
const DEADLINE_MS = 5000;
const SSL_REQUEST = Buffer.from([0, 0, 0, 8, 4, 210, 22, 47]);

// No connection-string, host, credentials, timeout, or TLS-policy overrides.
export function probePostgresTls() {
  const started = performance.now();
  return new Promise((resolveResult) => {
    let socket, secureSocket, finished = false;
    const finish = (success, tlsProtocol = null) => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      secureSocket?.destroy();
      socket?.destroy();
      resolveResult({success, tlsProtocol,
        elapsedMs: Math.max(0, Math.round(performance.now() - started))});
    };
    // Total wall-clock deadline covers DNS, TCP, SSLRequest, and TLS handshake.
    const deadline = setTimeout(() => finish(false), DEADLINE_MS);
    try {
      socket = net.connect({host: HOST, port: PORT});
      socket.on('error', () => finish(false));
      socket.on('close', () => finish(false));
      socket.on('end', () => finish(false));
      socket.once('connect', () => {
        if (finished) return;
        try { socket.write(SSL_REQUEST); } catch { finish(false); }
      });
      socket.once('data', (response) => {
        if (finished) return;
        // PostgreSQL must return exactly one byte: S (accept TLS). Reject N,
        // errors and any unexpected plaintext; never downgrade to plaintext.
        if (response.length !== 1 || response[0] !== 0x53) return finish(false);
        socket.pause();
        try {
          secureSocket = tls.connect({socket, servername: HOST,
            rejectUnauthorized: true, minVersion: 'TLSv1.2',
            checkServerIdentity: tls.checkServerIdentity});
          secureSocket.on('error', () => finish(false));
          secureSocket.on('close', () => finish(false));
          secureSocket.on('end', () => finish(false));
          secureSocket.once('secureConnect', () => {
            if (finished) return;
            try {
              const protocol = secureSocket.getProtocol();
              const identityError = tls.checkServerIdentity(HOST, secureSocket.getPeerCertificate());
              const verified = secureSocket.authorized === true && !identityError &&
                ['TLSv1.2', 'TLSv1.3'].includes(protocol);
              finish(verified, verified ? protocol : null);
            } catch { finish(false); }
          });
          secureSocket.resume();
        } catch { finish(false); }
      });
    } catch { finish(false); }
  });
}

const isMain = process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  if (process.argv.length !== 3 || process.argv[2] !== '--probe') {
    process.stderr.write('Use --probe to run the fixed credential-free TLS diagnostic.\n');
    process.exitCode = 2;
  } else {
    // A native DNS lookup can outlive socket.destroy(). Explicit CLI exit is
    // required; the fallback also bounds a stalled stdout flush.
    setTimeout(() => process.exit(1), DEADLINE_MS + 500);
    const result = await probePostgresTls();
    process.stdout.write(JSON.stringify(result) + '\n', () => process.exit(result.success ? 0 : 1));
  }
}
