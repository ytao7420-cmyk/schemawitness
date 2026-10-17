# Contract architecture

## Reuse boundary

SchemaWitness is a semantic decoder attestation for a bounded NOAA GHCN-Daily scalar profile. The source elements are `TMAX`, `TMIN`, `TAVG`, `TAXN`, `PRCP`, `SNOW`, `SNWD`, and `AWND`. Other codes receive `UNKNOWN`: a documented dew point, wet-bulb temperature, snow-water equivalent or gust is not interchangeable with this profile's quantities. A consumer binds an intended quantity, aggregation and output unit to one exact data-dictionary version. It can then reuse that accepted plan for many immutable normalization receipts.

The normalizer handles individual scalar observations. It does not reaggregate dates, compare weather stations, resolve source-specific observation windows, identify independent people, or authenticate a weather observation. A daily value retains its original `sflag`; a shared label such as `DAILY_MEAN` does not prove equivalent sampling methods or local-day boundaries.

## State lifecycle

`create_plan` → `capture_dictionary` → `attest` → zero or more `record_samples` calls.

- Plans are keyed by creator address and plan ID. An ID is not globally reserved by its first caller.
- A plan fixes the source endpoint, full-body SHA-256, source element, target semantic tuple and decoder profile.
- The creator freezes the dictionary. Independent source fetches must match the committed bytes, and the capture uses strict equivalence.
- The creator requests semantic attestation after capture. The same plan cannot be recaptured, reinterpreted or overwritten after the corresponding stage has completed. A changed intention or dictionary requires a new plan.
- A receipt is keyed by its recorder and receipt ID. Another caller may use an accepted plan, but cannot write under another recorder's identity or overwrite an existing receipt.
- A mismatched or unknown attestation remains inspectable; it cannot produce a normalized receipt.

There are no deposits, payouts, external callbacks, schedulers or production-system actions.

## Consensus design

The leader interprets the selected element from the frozen dictionary. The validator independently performs the interpretation and compares the semantic fields: support, quantity, aggregation, source unit, missing sentinel, quality policy and trace policy.

Agreement on those fields is necessary but insufficient. A separate evidence check verifies the leader's source spans against the full dictionary and the selected element. Exact line ranges are checked in deterministic code, and stored quotes are reconstructed from the source rather than supplied by the model. Two valid citation sets need not be identical. A valid JSON object or an allowed enum is not evidence of a correct interpretation.

Free-form reasoning is leader-authored explanation. Semantic fields and the candidate's supporting citations are checked; prose is not advertised as unanimously agreed wording. A model or source failure can prevent transaction execution. No partially evaluated mapping is stored as accepted.

## Deterministic decision and arithmetic

The model does not choose acceptance directly. Contract code compares the independently interpreted source quantity and aggregation with the target tuple, and verifies unit compatibility. Results are `ACCEPTED`, `MISMATCH`, or `UNKNOWN`.

Only an accepted mapping can normalize a sample. Exact reduced integer fractions represent output values. For example, converting tenths of Celsius to Fahrenheit uses `(9 × raw + 1600) / 50`. There is no floating-point rounding and no model-generated conversion formula.

The supported output units are `degC`, `degF`, `mm`, `cm`, `m`, `m_s`, and `km_h`, restricted to the appropriate source quantity. Output is a numerator, positive denominator and unit. Consumers choose their own presentation precision without changing the recorded exact result.

## Sample status handling

Each sample contains exactly `raw`, `mflag`, `qflag` and `sflag`. Flags remain present in the receipt. Processing is deliberately conservative:

| Condition | Result | Numeric output |
| --- | --- | --- |
| Missing sentinel | `MISSING` | None |
| Nonblank quality flag | `QUALITY_FLAGGED` | None |
| Unknown measurement/source flag, or absent source for a nonmissing sample | `UNKNOWN_FLAGS` | None |
| Trace flag for precipitation or snow | `TRACE` | None |
| Other nonblank measurement flag | `MEASUREMENT_FLAGGED` | None |
| Negative non-temperature amount | `INVALID_VALUE` | None |
| Eligible unflagged scalar | `VALUE` | Exact fraction |

This policy avoids silently treating presumed-zero, partial-report, hourly-summary or trace observations as exact unflagged measurements. It does not assert those observations are useless; interpreting them is outside this decoder profile. A blank quality flag is retained as a source convention, not proof that a caller supplied genuine NOAA data.

## Commitments and consumer verification

Canonical JSON uses sorted object keys, UTF-8 and compact separators. SHA-256 commitments bind the dictionary, plan, attestation, sample list and receipt. A receipt references the source hash, plan digest and attestation digest. Consumers should verify these links and use the surrounding chain ID and contract address to identify the deployment. A content hash by itself is not a globally unique on-chain event or proof of external authenticity.

Public state is intended only for public or synthetic inputs. The demonstration records synthetic samples and uses project-controlled test actors. Model interpretation remains fallible even after validator agreement; the contract provides an inspectable shared result rather than a scientific accuracy guarantee.
