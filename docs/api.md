# Contract API

`SchemaWitness` has a no-argument constructor. All public arguments are strings; `samples_json` contains a JSON array. Write methods return `None`. Every view returns a **JSON-encoded string**, which callers must parse once. Deployment address, network and source hash are in [`public/deployment.json`](../public/deployment.json).

This is the `ghcn-daily-scalar-v1` profile: semantic interpretation of a frozen NOAA dictionary followed by deterministic conversion of **caller-supplied** scalar samples. An accepted mapping does not authenticate observations, prove measurement accuracy or establish scientific fitness.

## Lifecycle and methods

| Method | Exact arguments, in order | Result or effect |
|---|---|---|
| `create_plan` | `plan_id`, `element`, `target_quantity`, `target_aggregation`, `target_unit`, `dictionary_sha256` | Creates an immutable plan under the sender's address. |
| `capture_dictionary` | `plan_id` | Independently fetches the fixed official source and freezes it only when its exact UTF-8 SHA-256 matches the plan and validator snapshots agree. |
| `attest` | `plan_id` | Independently extracts and checks source semantics/citations; stores one immutable `ACCEPTED`, `MISMATCH` or `UNKNOWN` attestation. |
| `record_samples` | `plan_owner`, `plan_id`, `receipt_id`, `samples_json` | Records deterministic results against an accepted plan; receipt belongs to the transaction sender, who can differ from the plan owner. |
| `get_plan` | `owner`, `plan_id` | Plan object. An absent plan is an error. |
| `get_dictionary` | `owner`, `plan_id` | Frozen dictionary object, or JSON `null` if the existing plan has not captured one. |
| `get_attestation` | `owner`, `plan_id` | Attestation object, or JSON `null` if the existing plan has none. |
| `get_receipt` | `recorder`, `receipt_id` | Recorded receipt object, or JSON `null` if absent. |
| `normalize_samples` | `plan_owner`, `plan_id`, `samples_json` | Result array, computed without a transaction or stored receipt. Requires an accepted attestation. |

All argument types above are `str`. Plan and receipt IDs must match `[A-Za-z0-9_-]{1,64}`. Addresses must be `0x` plus 40 hexadecimal characters and are normalized to lowercase. Storage namespaces are `owner:plan_id` and `recorder:receipt_id`: two actors can use the same short ID, but an actor cannot overwrite their own existing record. `capture_dictionary` and `attest` implicitly select the sender's plan, so another actor cannot advance that owner's lifecycle.

Operational failures or validator disagreement do not become an accepted certificate or an automatic `UNKNOWN` attestation. After a failed transaction, inspect execution/consensus status and read back the record; block inclusion alone is insufficient.

## Plan input

- `element`: four uppercase letters/digits. This profile supports `TMAX`, `TMIN`, `TAVG`, `TAXN`, `PRCP`, `SNOW`, `SNWD`, `AWND`. Other codes cannot produce an accepted mapping.
- `target_quantity`: `TEMPERATURE`, `PRECIPITATION`, `SNOWFALL`, `SNOW_DEPTH`, `WIND_SPEED`.
- `target_aggregation`: `DAILY_MAX`, `DAILY_MIN`, `DAILY_MEAN`, `DAILY_MIDRANGE`, `DAILY_TOTAL`, `POINT`.
- `target_unit`: `degC`, `degF`, `mm`, `cm`, `m`, `m_s`, `km_h`.
- `dictionary_sha256`: 64 lowercase hexadecimal characters, computed from the exact source bytes without newline normalization. The fixed source is `https://noaa-ghcn-pds.s3.amazonaws.com/readme.txt`.

Target quantity/statistic must match the independently extracted meaning and its source unit must be convertible to the target unit. For example, `TMAX → TEMPERATURE / DAILY_MAX / degF` can be accepted; changing only the target statistic to `DAILY_MEAN` is a semantic mismatch. `TAVG` is not interchangeable with `TAXN`. `TEMPERATURE` follows the unqualified GHCN variable and does not add an undocumented sensor-method claim.

## Sample input and results

`samples_json` is a string of at most 6,000 characters encoding **1–16** objects with exactly these keys:

```json
[{"raw":253,"mflag":"","qflag":"","sflag":"S"}]
```

`raw` must be an integer fitting the signed five-character VALUE field (`-9999` through `99999`); booleans, floats and numeric strings are rejected. Each flag is empty or one printable ASCII character. A single space is normalized to an empty flag before results and input digests are generated.

Each result contains `input`, `status`, `reason` and `normalized`. Numeric output uses a reduced fraction with a positive denominator:

```json
{"numerator":3877,"denominator":50,"unit":"degF"}
```

This is exactly `77.54 °F` for raw `253` tenths Celsius. Arithmetic uses integers, including temperature offsets. `normalized` is `null` for every nonnumeric result.

The decoder applies these checks in order:

| Condition | Status |
|---|---|
| Raw `-9999` | `MISSING` |
| Any nonblank quality flag | `QUALITY_FLAGGED` |
| Unknown measurement/source flag, or absent source flag | `UNKNOWN_FLAGS` |
| Measurement flag `T` on precipitation, snowfall or snow depth | `TRACE` |
| Other recognized nonblank measurement flag, including `T` on temperature | `MEASUREMENT_FLAGGED` |
| Negative non-temperature scalar | `INVALID_VALUE` |
| Otherwise | `VALUE` |

Trace is never converted to exact zero. Blank quality flags report no failed check, not independently proven accuracy. Flags such as `H`, `P` and `I` remain nonnumeric under this conservative profile. A recognized source code is not proof that a caller's sample came from that source; NOAA's source-specific methodology cautions still apply.

## Returned evidence

- **Plan:** owner, ID, element, target, profile, fixed source URL, committed dictionary hash and `digest`.
- **Dictionary:** URL, exact text, SHA-256, byte/line counts and `digest`.
- **Attestation:** plan/dictionary digests, source hash, target, semantic fields, source spans, status and `digest`. Span quotes are reconstructed from the frozen source. Free-form explanations are leader-authored; the semantic fields and supporting citations undergo validation.
- **Receipt:** recorder and ID, plan owner/ID, plan/attestation digests, source hash, `samples_digest`, canonical samples, results, provenance notice and `digest`.

Digests use SHA-256 over sorted-key compact JSON, preserving Unicode. They identify content, not a signature or a globally unique deployment. Consumers must retain the **network and contract address** alongside a receipt and verify the linked attestation and source commitments.

## Read-only JavaScript example

Run this from the repository root after `npm ci`, using Node's module mode. It uses the published deployment and recorded creator address; it creates no wallet and sends no transaction.

```js
import {readFile} from 'node:fs/promises';
import {createClient} from 'genlayer-js';
import {studionet} from 'genlayer-js/chains';

const deployment = JSON.parse(await readFile('public/deployment.json', 'utf8'));
const evidence = JSON.parse(await readFile('public/evidence/demo.json', 'utf8'));
if (deployment.chainId !== studionet.id ||
    deployment.rpc !== studionet.rpcUrls.default.http[0]) {
  throw new Error('Deployment and configured network differ');
}

const reader = createClient({chain: studionet});
const owner = evidence.actors.creator;
const planId = 'tmax-fahrenheit-v1';
const read = async (functionName, args) => JSON.parse(
  await reader.readContract({address: deployment.address, functionName, args})
);

const attestation = await read('get_attestation', [owner, planId]);
if (attestation?.status !== 'ACCEPTED') throw new Error('Mapping is not accepted');

const results = await read('normalize_samples', [owner, planId, JSON.stringify([
  {raw: 253, mflag: '', qflag: '', sflag: 'S'}
])]);
console.log(results[0].normalized); // {numerator: 3877, denominator: 50, unit: 'degF'}
```

The recorded Studionet RPC exhibited a long-calldata `gen_call` limitation. The harness previews one sample per read, then compares all previews with the full batch write receipt. This is a transport workaround; the contract itself permits up to 16 samples per call.

## Expected rejection paths

Invalid identifiers, addresses, enums, hashes or samples raise `UserError`. So do an absent plan, a duplicate plan/receipt, recapturing a frozen dictionary, attesting before capture, reattesting an immutable record, source-byte hash mismatch, unsupported source responses and normalization without an accepted mapping. A semantic target mismatch is stored as `MISMATCH`; it is not a malformed-input error. No write path silently changes a previous plan, attestation or receipt to make a retry succeed.
