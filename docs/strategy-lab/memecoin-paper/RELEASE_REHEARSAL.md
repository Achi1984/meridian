# Final Paper release rehearsal receipt (Issue #1203)

## Scope
- Rehearsal source pin: `fc5b3d97f62b8a9098e53a99eaa9a03b7955e5aa` (`Add offline Paper provider warmup handoff (#1202)`).
- Rehearsal objective: build real Docker images and run three offline acceptance proofs in-container with `--network none`, runtime `UID:GID 1000:1000`, and fresh temporary volume roots.
- Boundary: no Northflank/provider/account credentials, no production mount, no live-host/HTTPS claim.

## Pinned source and build commands
```bash
REPO=/home/runner/work/meridian/meridian
PIN=fc5b3d97f62b8a9098e53a99eaa9a03b7955e5aa
WORK=/tmp/meridian-release-rehearsal-1203
rm -rf "$WORK" && mkdir -p "$WORK"
(git -C "$REPO" archive "$PIN" | tar -x -C "$WORK")

DOCKER_BUILDKIT=1 docker build -f "$WORK/Dockerfile.paper" \
  --label "org.opencontainers.image.revision=$PIN" \
  -t "meridian-paper-rehearsal:$PIN" "$WORK"

DOCKER_BUILDKIT=1 docker build -f "$WORK/Dockerfile.paper-volume-protection" \
  --label "org.opencontainers.image.revision=$PIN" \
  -t "meridian-paper-volume-protection-rehearsal:$PIN" "$WORK"
```

## Actual local image identities
These are local daemon identities only (not hosted registry/deployed digests).

```text
IMAGE1_INSPECT
id=sha256:ec191ba1fbd70d858940bd5e934c79fd000bf1e1a61fdbd442766cd01f2e63b5
user=node
entry=["node","scripts/memecoin-paper/pilot-online.mjs"]
label.org.opencontainers.image.revision=fc5b3d97f62b8a9098e53a99eaa9a03b7955e5aa
repodigests=[]

IMAGE2_INSPECT
id=sha256:482b1847819a7071d64e823e38850b4556d8dd0245b6e0320f7af4ea3db01a72
user=0:1000
entry=["node","/helper/volume-protection.mjs"]
label.org.opencontainers.image.revision=fc5b3d97f62b8a9098e53a99eaa9a03b7955e5aa
repodigests=[]
```

## Fresh temporary volume preparation
```bash
VOL=meridian-paper-rehearsal-1203
(docker volume rm "$VOL" >/dev/null 2>&1 || true)
docker volume create "$VOL"
docker run --rm --network none --user 0:0 -v "$VOL":/var/data/meridian-paper alpine:3.20 sh -lc '
  mkdir -p /var/data/meridian-paper/synthetic-acceptance /var/data/meridian-paper/controller-acceptance
  chown 1000:1000 /var/data/meridian-paper/synthetic-acceptance /var/data/meridian-paper/controller-acceptance
  chmod 700 /var/data/meridian-paper/synthetic-acceptance /var/data/meridian-paper/controller-acceptance
  stat -c "%u:%g %a %n" /var/data/meridian-paper/synthetic-acceptance /var/data/meridian-paper/controller-acceptance
'
```
Observed:
```text
1000:1000 700 /var/data/meridian-paper/synthetic-acceptance
1000:1000 700 /var/data/meridian-paper/controller-acceptance
```

## In-image import closure check (host harness/provider warmup/handoff)
```bash
docker run --rm --network none --user 1000:1000 --entrypoint node \
  "meridian-paper-rehearsal:$PIN" --input-type=module -e '...imports...'
```
Observed:
```text
IMPORT_OK ./scripts/memecoin-paper/synthetic-host-acceptance.mjs exports=3
IMPORT_OK ./scripts/memecoin-paper/provider-warmup-handoff/index.mjs exports=5
IMPORT_OK ./scripts/memecoin-paper/evidence-warmup/index.mjs exports=7
IMPORT_OK ./scripts/memecoin-paper/paper-operational-controller.mjs exports=2
```

## Offline proof execution (all with `--network none`)

### A. Synthetic proof: `PIPELINE_QUOTE`
```bash
docker run --rm --network none --user 1000:1000 -v "$VOL":/var/data/meridian-paper \
  -e PAPER_SYNTHETIC_ACCEPTANCE_ENABLED=true \
  -e PAPER_SYNTHETIC_ACCEPTANCE_DATA_ROOT=/var/data/meridian-paper/synthetic-acceptance \
  -e PAPER_SYNTHETIC_ACCEPTANCE_PROOF=PIPELINE_QUOTE \
  --entrypoint node "meridian-paper-rehearsal:$PIN" \
  scripts/memecoin-paper/synthetic-host-acceptance.mjs
```
Observed receipt:
```json
{"status":"PASS","contractChecks":"PASS","proof":"SYNTHETIC_PIPELINE_QUOTE","runId":"synthetic-e41b95c8-4258-4589-826a-c11ce42c1ca3","configSha256":"ff28bab97c369f9a1ab448ab0cb3ba9ad6726679bbe0fdee1918823139537be5","producerRevision":"paper-pilot-composition/3","exportSha256":"2179a3a1218555a4fcf7785a1212d7bd1bf9a50b59f4f721153fa79d1288fafa","byteLength":33432,"evaluation":"PASS","outcome":"SIMULATED_ENTRY_EXIT_COMPLETE","entryFills":1,"exits":1,"stopAccepted":false,"restartDenied":true,"immutableReadback":true,"https":{"status":"DISABLED"},"hostAcceptance":"NOT_ASSESSED","providerTrust":"NOT_ASSESSED","liveExecution":false}
```
Exit code: `0`.

### B. Synthetic proof: `ACTIVE_STOP`
```bash
docker run --rm --network none --user 1000:1000 -v "$VOL":/var/data/meridian-paper \
  -e PAPER_SYNTHETIC_ACCEPTANCE_ENABLED=true \
  -e PAPER_SYNTHETIC_ACCEPTANCE_DATA_ROOT=/var/data/meridian-paper/synthetic-acceptance \
  -e PAPER_SYNTHETIC_ACCEPTANCE_PROOF=ACTIVE_STOP \
  --entrypoint node "meridian-paper-rehearsal:$PIN" \
  scripts/memecoin-paper/synthetic-host-acceptance.mjs
```
Observed receipt:
```json
{"status":"UNKNOWN","contractChecks":"PASS","proof":"SYNTHETIC_ACTIVE_STOP","runId":"synthetic-5d7f8a66-228f-4bc2-9eee-043f706bb040","configSha256":"45d680bff26b9fed0c7c99498d4b6bcc4407fa33b7cf0fa8a6fdce5b25ace045","producerRevision":"paper-pilot-composition/3","exportSha256":"f0b9368b3a1f5aae3c40499b5f7647ae606b8a30848409c445af8cef5901c690","byteLength":30981,"evaluation":"UNKNOWN","outcome":"OPEN_UNVALUED_TERMINAL_POSITION","entryFills":1,"exits":0,"stopAccepted":true,"restartDenied":true,"immutableReadback":true,"https":{"status":"DISABLED"},"hostAcceptance":"NOT_ASSESSED","providerTrust":"NOT_ASSESSED","liveExecution":false}
```
Exit code: `2`.

### C. Controller proof: `SOURCE_BACKED_PAPER` no-entry
Manifest and expected hash were generated in-container at a fresh invocation directory:
`/var/data/meridian-paper/controller-acceptance/proof-2f6f20c0-9c21-4201-afdd-6310a38a4ea2`

Controller command:
```bash
docker run --rm --network none --user 1000:1000 -v "$VOL":/var/data/meridian-paper \
  --entrypoint node "meridian-paper-rehearsal:$PIN" \
  scripts/memecoin-paper/paper-operational-controller.mjs start --enable \
  --manifest "$INVOCATION/manifest.json" --runs-dir "$INVOCATION/runs"
```
Observed controller output:
```json
{"status":"UNKNOWN","runId":"controller-no-entry-cef4626e-d735-4bf5-9790-b63615ef4dd3","runDirectory":"/var/data/meridian-paper/controller-acceptance/proof-2f6f20c0-9c21-4201-afdd-6310a38a4ea2/runs/controller-no-entry-cef4626e-d735-4bf5-9790-b63615ef4dd3","runDirectoryCreated":true,"executionStarted":true,"exportStatus":"ACKNOWLEDGED","statusPersistence":"ACKNOWLEDGED","evaluatorOverall":"UNKNOWN"}
```
Exit code: `2`.

Contract verification against run export (`run-export.json`) observed:
```json
{"proof":"CONTROLLER_SOURCE_POLICY_NO_ENTRY","evaluation":"UNKNOWN","reason":"SOURCE_POLICY_UNAPPROVED","quotes":0,"entryFills":0,"hostAcceptance":"NOT_ASSESSED"}
```

## Expected vs observed summary
- `PIPELINE_QUOTE`: expected `PASS` + exit `0`; observed `PASS` + exit `0`.
- `ACTIVE_STOP`: expected `UNKNOWN` + exit `2` + `contractChecks=PASS`; observed exact match.
- `SOURCE_BACKED_PAPER` no-entry: expected `SOURCE_POLICY_UNAPPROVED` and zero quote/entry activity with `UNKNOWN` evaluation; observed exact match (`quotes=0`, `entryFills=0`, no network).
- Restart denial and immutable readback: observed in synthetic receipts as `restartDenied=true` and `immutableReadback=true`.
- Hash/readback integrity: synthetic receipts report `configSha256` and `exportSha256`; in-volume readback matched both values.

## Minimal-fix assessment
- No Dockerfile/runtime dependency correction was required.
- No strategy/trust/permission-rule changes were made.

## Remaining real-host prerequisites (not performed here)
- `freshmount03775`: production mount ownership/mode validation on actual host path.
- `actualregistrydigest`: published registry digest capture for deployed image reference.
- `TLSsecrets`: runtime private TLS/auth file provisioning and independent host reachability checks.
- `ownerdeferredrotation`: owner-controlled secret rotation/operational sign-off.

## Command counts and skips
- Performed command groups: `11`.
- Skipped by design: live host activation, HTTPS transport proof, provider/account credential use, production mount operations.
- Local rehearsal artifacts were kept under `/tmp/rehearsal1203` and Docker volume `meridian-paper-rehearsal-1203`.
