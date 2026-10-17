# SchemaWitness contribution

Category: Intelligent Contracts

SchemaWitness is a reusable GenLayer primitive for evidence-bound data integration. A creator freezes a mapping intent and the SHA-256 of NOAA's GHCN-Daily dictionary. The contract fetches the authoritative document; validators independently interpret quantity, aggregation, unit scale and missing/flag conventions, compare semantic fields, and substantively verify cited source passages. Deterministic code accepts or rejects the mapping, then produces immutable receipts with exact rational conversions. Missing, trace and flagged samples never silently become numeric zero. The bounded profile covers eight element codes. Samples remain caller assertions, not authenticated weather observations.

Reproduce with the SDK harness and docs/validation.md. Tests and public chain transcripts cover accepted temperature/precipitation mappings, rejected max-as-mean mapping, and synthetic sample receipts. All actors are project-controlled; Studionet only. Earlier failed-attempt evidence is retained.

Evidence: https://github.com/ytao7420-cmyk/schemawitness
