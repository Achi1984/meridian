# Paper export TLS host (source-only)

`scripts/memecoin-paper-export-host.mjs` is a standalone, default-disabled TLS
bootstrap for the existing private export handler. It does not start a listener
when imported, register a gateway route, or change the `Dockerfile.paper`
entrypoint. The existing Paper image continues to run
`scripts/memecoin-paper/pilot-online.mjs`; this host must be started as a
separate, explicitly authorized process.
It consumes the frozen HTTPS adapter dependency at commit
`a1eaf7b7c916eacf925dc5f9d25e88fe94862a9f`.

The host starts only when `PAPER_EXPORT_HOST_ENABLED=true` and every required
setting validates. The required settings are:

- `PAPER_EXPORT_HOST_ORIGIN`: one canonical `https://` origin, with no path,
  credentials, query, or fragment;
- `PAPER_EXPORT_HOST_LISTEN_HOST` and `PAPER_EXPORT_HOST_PORT`: an explicit IP
  address and port matching the origin;
- `PAPER_EXPORT_HOST_TLS_CERT_FILE` and `PAPER_EXPORT_HOST_TLS_KEY_FILE`:
  private file references, not PEM content;
- `PAPER_EXPORT_HOST_WRITE_AUTH_FILE` and
  `PAPER_EXPORT_HOST_READ_AUTH_FILE`: distinct private file references for
  nonempty, independent authorization scopes;
- `PAPER_EXPORT_HOST_MOUNT_ROOT=/var/data/meridian-paper` and
  `PAPER_EXPORT_HOST_STORAGE_ROOT`: a direct child storage directory. Mount
  ancestry must be real, trusted directories. The storage child must be
  runtime-owned and private with exact mode `0700` or `02700`; Linux inherits
  the protected mount's setgid bit and group when creating a child, yielding
  `02700` while retaining no group/world access. TLS and authorization files
  must be regular, runtime-owned files with no group/world permissions.

The authorizers compare each request against its corresponding file-backed
authorization value. File contents, PEM data, authorization values, and export
bytes are never written to logs or accepted as command-line arguments. Missing,
invalid, or ambiguous configuration fails closed without listening. There are
no retries or background sync. SIGINT/SIGTERM initiate a bounded graceful
shutdown.

The handler retains the frozen transfer limits and immutable byte semantics. It
requires the exact configured Host and fixed private routes and rejects
plaintext sockets; forwarded-protocol headers cannot satisfy the TLS check.
Listener exposure is not a deployment decision.

Before any separate host activation, the operator must establish that TLS
arrives intact at Node, or is verifiably re-encrypted to Node with the matching
certificate and Host value, and that the operator can reach that private
endpoint. Northflank's actual TLS/ingress topology has not been verified. A
private endpoint may require a separate owner choice. This source does not claim
production registration, DNS/firewall changes, credentials, or deployment.

Focused checks:

```sh
node --test test/memecoin-paper-export-host.test.js test/memecoin-paper-image.test.js
node --check scripts/memecoin-paper-export-host.mjs
node scripts/secret-check.mjs
```
