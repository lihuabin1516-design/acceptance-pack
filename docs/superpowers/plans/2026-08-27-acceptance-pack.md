# CC-Panes Acceptance Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only acceptance-pack CLI that verifies and correlates workflow, verification, and audit artifacts.

**Architecture:** A strict TypeScript library validates a request manifest, confines paths to a caller-supplied root, hashes and parses sources, derives a typed status, and atomically writes a validated pack. A thin CLI exposes compose and validate commands without executing external checks.

**Tech Stack:** Node.js 22+, TypeScript strict mode, built-in `node:test`, pnpm.

---

### Task 1: Repository contract and failing composition tests

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `AGENTS.md`
- Create: `tests/compose.test.ts`

- [ ] Write tests for ready, partial, blocked, digest drift, identity conflict,
  path confinement, JSONL validation, privacy rejection, and atomic output.
- [ ] Run `pnpm test` and confirm failure because the implementation module is
  absent.

### Task 2: Minimal acceptance-pack library

**Files:**
- Create: `src/index.ts`
- Test: `tests/compose.test.ts`

- [ ] Define request, verification, source, and pack contracts.
- [ ] Implement strict manifest and artifact validation.
- [ ] Implement root-confined reads, SHA-256 comparison, JSON/JSONL parsing,
  privacy-key rejection, identity correlation, and status derivation.
- [ ] Implement atomic write and readback validation.
- [ ] Run `pnpm test` and confirm all composition tests pass.

### Task 3: CLI and production fixture

**Files:**
- Create: `src/cli.ts`
- Create: `fixtures/request.json`
- Create: `fixtures/workflow-index.json`
- Create: `fixtures/verification.json`
- Create: `fixtures/hook-audit.json`
- Create: `fixtures/post-tool-audit.jsonl`
- Create: `scripts/update-fixture-digests.cjs`
- Create: `scripts/lint.cjs`
- Create: `README.md`

- [ ] Add `compose` and `validate` CLI commands.
- [ ] Generate exact fixture digests through the local update script.
- [ ] Add build, typecheck, lint, test, and production smoke scripts.
- [ ] Run production smoke and validate the emitted pack.

### Task 4: Final verification and scope audit

**Files:**
- Verify all repository files.

- [ ] Run `pnpm run build`.
- [ ] Run `pnpm run typecheck`.
- [ ] Run `pnpm run lint`.
- [ ] Run `pnpm test`.
- [ ] Run `pnpm run smoke:production`.
- [ ] Run `git diff --check` and inspect full status.
- [ ] Confirm external authority repositories and user-global configuration
  were not modified by this task.
