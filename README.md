# SchemaWitness

A standalone GenLayer Intelligent Contract for attesting a GHCN-Daily data mapping and producing exact, provenance-linked normalization receipts.

SchemaWitness addresses a data-integration trust problem: two columns can both be integers while representing different quantities, scales, aggregation methods or missing-value conventions. A receipt binds the caller's intended mapping, a specific version of the authoritative data dictionary, the consensus interpretation and the exact inputs used for conversion.

## What the primitive does

1. A creator commits a mapping intent and the SHA-256 of the complete official NOAA GHCN-Daily dictionary.
2. The contract retrieves that dictionary from NOAA and freezes its bytes and commitment.
3. GenLayer validators independently interpret the selected element and verify the source support for the proposed interpretation. Decision-bearing fields must agree; explanatory wording need not.
4. Deterministic code compares that interpretation with the target quantity, aggregation and unit. It records an immutable accepted, mismatched or unknown attestation.
5. A caller can record a bounded batch of samples against an accepted attestation. Integer/rational arithmetic converts eligible values; missing, trace and flagged values retain explicit non-numeric states. The receipt identifies its recorder, mapping and source commitments.

This is a reusable contract primitive, with an SDK demonstration harness and tests. It is not a weather-data oracle: the samples supplied to the normalizer are caller assertions. The demonstration uses synthetic samples and project-controlled test wallets.

## Why GenLayer

The semantic task requires reading an external data dictionary. In particular, the dictionary distinguishes daily mean from daily midrange, temperature from precipitation, and scaled integer units from presentation units. Independent validators must substantively check that interpretation. A JSON-shaped response alone does not establish agreement.

Once a mapping has been attested, conversion is ordinary deterministic arithmetic. An LLM does not calculate the normalized values, choose a rounding result or replace a missing observation with zero.

## Source

- Original NCEI dictionary: <https://www.ncei.noaa.gov/pub/data/ghcn/daily/readme.txt>
- Contract source endpoint: <https://noaa-ghcn-pds.s3.amazonaws.com/readme.txt>, the NOAA-managed distribution identified in the [AWS Open Data Registry](https://registry.opendata.aws/noaa-ghcn/). This authoritative endpoint was reachable when the original NCEI host timed out from the development machine.
- Dataset citation: Menne et al. (2012), *Global Historical Climatology Network - Daily*, Version 3, <https://doi.org/10.7289/V5D21VHZ>.
- Protocol: [GenLayer Equivalence Principle](https://docs.genlayer.com/understand-genlayer-protocol/core-concepts/optimistic-democracy/equivalence-principle).

The byte hash identifies the retrieved document version. A future source update requires a new mapping commitment. NOAA does not endorse this project.

The demonstration pins the complete Version 3.35 dictionary (29,587 bytes) to SHA-256 `0e4e6f0e6947cf1add884c328a01760f31c56ef5fb86b85ed57dd5dc4c4aeaa6`. The distribution reported a last-modified timestamp of 2026-10-05 22:59:14 UTC. This is a version observation, not a guarantee that a mutable URL will continue serving those bytes.

## Validation and reproduction

The final deployment, live demonstration commands and observed outcomes are recorded in [validation](docs/validation.md). The state and consensus rules are described in [architecture](docs/architecture.md). Exact methods and a read-only integration example are in the [API reference](docs/api.md).

The harness uses GenLayer Studionet (chain 61999), fresh test-only keys and zero-value transactions. `.local/` is excluded from publication. Keys from funded wallets are not needed to reproduce the demonstration.

## Boundaries

The supported source elements are `TMAX`, `TMIN`, `TAVG`, `TAXN`, `PRCP`, `SNOW`, `SNWD`, and `AWND`. Other elements are `UNKNOWN` even if the dictionary describes them: the target schema does not cover their scientific distinctions. This is not an arbitrary-schema decoder. A semantic attestation is not a guarantee that an observation is authentic, accurate, current, or appropriate for a downstream decision. Blank quality flags do not authenticate a sample. Measurement flags and source-specific time-window differences remain part of the record; the normalizer does not silently repair or aggregate observations.

Model disagreement, unavailable upstream evidence or a changed source hash can prevent completion. Local tests exercise logic with explicit SDK stubs; a separate live transcript is needed to establish actual network execution.

MIT licensed. See [LICENSE](LICENSE).
