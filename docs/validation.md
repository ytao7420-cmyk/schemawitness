# Validation and reproduction

## Scope

The live demonstration uses GenLayer Studionet (chain 61999, `https://studio.genlayer.com/api`). The deployer, mapping creator and sample recorder are distinct, project-controlled test accounts. All submitted transaction values are zero. Sample measurements are synthetic; only the complete data dictionary comes from NOAA.

Local Python tests use explicit GenLayer stubs. They validate deterministic logic and equivalence decisions, but do not replace network execution. JavaScript tests validate transaction-receipt interpretation, including rejection of finalized-but-failed transactions.

## Reproduce locally (Windows, macOS or Linux)

Install Node.js 22 or later and Python 3.11 or later, then clone this repository and open its directory:

```text
npm ci
npm test
python -m unittest discover -s tests -p "test_*.py"
npm run plan
```

On systems where Python is named `python3`, use that executable instead. `npm run plan` does not create keys or send transactions.

`npm run verify` checks the committed evidence archive offline: source bytes, citations, digests, mapping outcomes, exact fractions, sample exclusions and the recorded transaction summaries. It does not query current chain state or assert any reward eligibility.

## Reproduce on Studionet

Read `scripts/demo-preset.json` first. It defines three mapping intents and all expected sample outcomes. To deploy a new contract from the reviewed local source, obtain its SHA-256 (`Get-FileHash contracts/schemawitness.py -Algorithm SHA256` in PowerShell), then run:

```text
node scripts/live-test.mjs --deploy --source-sha=YOUR_LOWERCASE_SOURCE_SHA256 --run
```

The harness creates fresh test keys in `.local/`, which is ignored by Git. Never add this directory to a public upload or replace these test keys with funded-wallet keys. Deployment and workflow journals are separate for each source hash and contract address. They preserve submitted transaction hashes so interrupted waits can resume without broadcasting duplicate writes. If a broadcast outcome is unknown, inspect the journal and chain before continuing.

For an already deployed local version, resume with:

```text
node scripts/live-test.mjs --run
```

The committed official dictionary is the exact NOAA-managed S3 distribution. `npm run source` fetches the current source again. If NOAA changes the dictionary bytes, the previous on-chain plan's commitment must not be altered: use a new plan/version and describe that source change.

## Expected workflow

| Mapping | Expected attestation | Sample handling |
| --- | --- | --- |
| TMAX → TEMPERATURE / DAILY_MAX / degF | ACCEPTED | Seven synthetic samples; exact conversion or explicit exclusion |
| PRCP → PRECIPITATION / DAILY_TOTAL / mm | ACCEPTED | Eight synthetic samples; trace remains non-numeric |
| TMAX → TEMPERATURE / DAILY_MEAN / degC | MISMATCH | Normalization refused; no sample receipt |

Three plans require create/capture/attest calls; the two accepted plans also record samples. That is eleven successful workflow writes in addition to deployment. A separate expected-failure transaction attempts to record samples against the mismatched plan: it must reach majority agreement on the exact rollback reason and leave no receipt. Its execution remains `ERROR`, never relabeled as a successful transaction. All use `leaderOnly: false`.

On this Studio endpoint, the `gen_call` read path rejected locally valid long RLP wrappers with `RLP string ends with ... superfluous bytes` once the wrapper exceeded 255 bytes. One-, two- and three-sample previews worked; four and seven failed. The harness therefore reads each preview sample separately, then compares the combined ordered results to the original full-batch on-chain receipt. The transaction still records the complete seven- or eight-sample batch. This is an RPC compatibility workaround, not a reduced consensus requirement.

The harness only reports success after both the transaction lifecycle and actual consensus/execution results pass. A lifecycle of FINALIZED alone is insufficient.

## Earlier failed attempt

`public/evidence/first-attempt.json` preserves a minimal diagnostic summary. The initial deployment and dictionary capture succeeded, but the first attestation reached MAJORITY_DISAGREE and did not commit an attestation. The final leader rolled back with `Supported semantics require every decoder field`. Earlier leader outputs in the transaction history were complete, so the final error is not evidence that every model returned the same malformed answer.

The revision clarifies that the quality policy conservatively excludes all nonblank flags, including the investigation code Z, without claiming that every flag proves a failed check. It also avoids requiring an unqualified temperature definition to certify a dry-bulb measurement method, explicitly explains common format-level conventions, and specifies a complete output schema. Independent semantic agreement and substantive citation checks remain required.

## Observed final run

Recorded at **2026-10-17T22:51:43.771Z** on GenLayer Studionet. All three mapping outcomes matched the expectations above. The two accepted plans stored **15 synthetic sample results** across two complete batch receipts. The mismatched plan refused normalization, and the explicit negative write reached **MAJORITY_AGREE** on the exact rollback `Normalization requires an accepted semantic mapping`; its receipt readback was JSON `null`.

- Active contract: `0x3BAfd91140bb7dF7e4ED2a98A2679Ed80A52e8c7`.
- Reviewed contract source SHA-256: `faeec3dbd2736a7f53bebd4c8f486f100246a7182723a278bb46392eab0a30f0`.
- [Deployment transaction](https://explorer-studio.genlayer.com/tx/0xc7d84be7eb145bf7143f1a9645cc05010637eb9f3c86ec12fd7f5c42f670241a).
- [Public evidence archive](../public/evidence/demo.json): **11 successful workflow transactions** and **1 expected-rejection transaction**, with actual consensus, execution, source citations, full snapshots, digests and readbacks.
- [Expected-rejection transaction](https://explorer-studio.genlayer.com/tx/0x9b74b37f3135d61f883cb5914eb7f43dc8cd17a90bd6bfa004d4722d7f6c91af). This is a correctly rejected call, not successful VM execution.
- Local validation: **33 Python tests + 21 JavaScript tests passed**.

The final archive verifier passed all mapping, source, citation, receipt and transaction checks. Majority agreement is not unanimity, and network lifecycle status is reported as observed rather than assumed. The source/LLM-dependent operations may disagree or fail on later runs; the earlier failed attempt is retained below the public evidence directory.

The harness serializes reads with a 2.2-second minimum start interval and honors the service's retry-after interval on rate-limit errors, with bounded retries. Other errors are not silently retried or credited as successful validation.
