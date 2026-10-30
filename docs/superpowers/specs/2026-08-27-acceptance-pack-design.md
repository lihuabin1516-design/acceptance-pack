# PaneForge Acceptance Pack Design

## Goal

Create a read-only, file-first acceptance pack that correlates an existing
workflow index, a verification summary, and optional governance audit
references into one reviewable delivery artifact.

## Authority boundary

The pack is advisory-only. It does not execute checks, decide permissions,
control PaneForge sessions, mutate source repositories, publish artifacts, or
replace hooks acceptance evidence. Hooks remains the policy and hard-gate
authority; Method Layer remains the task/run/evidence contract authority;
official PaneForge remains the Pane/Session/PTY/Worker runtime authority.

## Inputs

The CLI consumes one `paneforge.acceptance.request.v1` manifest under a caller
supplied root. The manifest contains:

- `taskId`, `runId`, and a non-sensitive `workspaceId`;
- one required workflow-index reference with an exact SHA-256;
- one required verification-summary, native acceptance-evidence, or native
  acceptance-verification reference with an exact SHA-256;
- zero or more audit references with exact SHA-256, format, and required flag.

The local verification summary contains the seven delivery checks. The native
hooks contracts `paneforge.acceptance.v1` and
`paneforge.acceptance.verify.v1` contribute their checks, required truth layers,
artifact verification results, and completion summary directly. The adapter
does not invent a second acceptance authority.

## Processing

All paths must be relative and remain within the supplied root. Every declared
source is read once, hashed, parsed, and identity checked. JSONL audits are
validated line by line. Missing required sources, digest drift, malformed
artifacts, task/run conflicts, and privacy-sensitive keys are explicit errors.
Missing optional audit files produce a partial pack.

## Status

- `ready`: workflow index is ready, every required check passes, and every
  declared source is available.
- `partial`: workflow index is partial or an optional audit is absent, while no
  blocking condition exists.
- `blocked`: a required verification check fails or is blocked, or the
  workflow index is blocked or unknown.

Digest drift and malformed required inputs stop composition instead of
guessing a pack status.

## Output

The output schema is `paneforge.acceptance.pack.v1`. It records identity,
workspace ID, derived status, workflow status, normalized checks, verified
source references, typed blocking reasons, missing optional sources, and
`advisoryOnly: true`. Native hooks inputs additionally contribute normalized
completion, truth-layer, and artifact-result summaries. It stores neither
source contents nor absolute paths.

The output is written atomically and read back through the same validator.

## Verification

Automated tests cover ready, partial, blocked, digest drift, identity conflict,
path escape, malformed JSONL, privacy rejection, schema validation, and atomic
write/readback. Production smoke composes synthetic fixtures and validates the
generated pack.
