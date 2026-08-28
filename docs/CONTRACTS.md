# Acceptance Pack Contract Notes

## Truth flow

```text
Hooks / Method Layer / sidecars
        -> declared source files + SHA-256
        -> acceptance request
        -> acceptance-pack
        -> advisory handoff artifact
```

The pack preserves source provenance and normalized truth-layer results. It never
promotes advisory output to authority.

## Failure policy

The CLI exits non-zero for source, schema, digest, identity, path, or privacy
errors. A syntactically valid but incomplete evidence set is represented as
`partial` or `blocked`, so downstream systems can distinguish “not enough
evidence” from a process failure.
