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

## Offline global workflow projection

`projectGlobalWorkflowAcceptance` is a pure, synchronous, read-only projection over
already-generated and redacted evidence. It does not invoke MCP, Coordinator,
CC-Panes, Worker, Session, hooks executables, filesystem, network, shell, or
processes, and it never writes upstream state.

The projection has explicit `nextGate`, `acceptanceEligibility`, `projectionReady`,
and `productionStatus` fields. `projectionReady: true` means only that the offline
projection is eligible for acceptance review; `productionStatus` remains
`not-established`, and `advisoryOnly` remains `true`. It is not live inventory,
preflight, Worker, Session, or production proof.

Evidence provenance uses the labels `canonical`, `observed`, `advisory`,
`historical`, and `unverified`. The gate is fail-closed for missing or malformed
evidence, identity conflicts, digest mismatch, sensitive fields/values, absent
current context, and any `fail`, `blocked`, or `not-run` truth layer. All three
context generations are required for eligibility: `context.md -> current`,
`context.prev.md -> previous`, and `context.prev2.md -> previous2`; every slot
checks `expectedDigest` against `digest`. `QUEUED`, `accepted`, historical
evidence, advisory sidecars, and version existence do not prove Session or Worker
completion. A Hooks truth layer forms completion proof only with the explicitly
allowed state `pass` or `completed`; `warn`, `degraded`, `partial`, `unknown`,
and every unrecognized state block, even when `required` is false.
Hooks-native `completionAllowed`, `truthLayers`, and `artifactResults` are
preserved as constrained copies containing only contract-declared fields, without
replacing their authority. Input traversal is cycle-aware: circular malformed
input returns a typed blocked projection rather than recursing indefinitely.

## Failure policy

The CLI exits non-zero for source, schema, digest, identity, path, or privacy
errors. A syntactically valid but incomplete evidence set is represented as
`partial` or `blocked`, so downstream systems can distinguish “not enough
evidence” from a process failure.
