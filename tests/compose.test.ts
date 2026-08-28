import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readFile } from "node:fs/promises";
import { composeRequest, explainPack, sha256, validatePack, validateRequest, writePackAtomic, type AcceptanceRequest } from "../src/index";

const digest = "sha256:" + "a".repeat(64);
const verification = (statuses: Record<string, string> = {}) => ({
  schema: "ccpanes.verification.summary.v1",
  taskId: "task-001", runId: "run-001",
  checks: Object.fromEntries(["build", "typecheck", "lint", "tests", "smoke", "scope", "privacy"].map(name => [name, { status: statuses[name] ?? "pass", safeSummary: name }])),
  privacy: { secretsStored: false, piiStored: false, fullTranscriptsStored: false }
});
const workflow = { schema: "ccpanes.workflow.index.v1", status: "ready", taskId: "task-001", runId: "run-001", advisoryOnly: true };
const request = (refs: AcceptanceRequest["sources"]): AcceptanceRequest => ({ schema: "ccpanes.acceptance.request.v1", taskId: "task-001", runId: "run-001", workspaceId: "workspace-001", sources: refs });
async function setup(files: Record<string, unknown>) {
  const root = await mkdtemp(join(tmpdir(), "ccpanes-acceptance-"));
  const refs: AcceptanceRequest["sources"] = [];
  for (const [path, value] of Object.entries(files)) {
    const body = typeof value === "string" ? value : JSON.stringify(value);
    await writeFile(join(root, path), body);
    refs.push({ kind: path.includes("workflow") ? "workflow-index" : path.includes("verification") ? "verification-summary" : "audit", path, sha256: sha256(body), required: !path.includes("optional") });
  }
  return { root, refs };
}

test("composes a ready pack from verified workflow, checks, and audit sources", async () => {
  const data = await setup({ "workflow.json": workflow, "verification.json": verification(), "audit.json": JSON.stringify({ event: "pass" }) });
  const pack = await composeRequest(request(data.refs), data.root, "2026-08-27T12:00:00Z");
  assert.equal(pack.status, "ready");
  assert.equal(pack.checks.tests, "pass");
  assert.equal(pack.sources.length, 3);
  assert.equal(validatePack(pack), true);
});

test("returns partial when an optional audit is absent", async () => {
  const data = await setup({ "workflow.json": workflow, "verification.json": verification() });
  const refs = [...data.refs, { kind: "audit" as const, path: "optional-audit.jsonl", sha256: digest, required: false }];
  const pack = await composeRequest(request(refs), data.root);
  assert.equal(pack.status, "partial");
  assert.deepEqual(pack.missingOptional, ["optional-audit.jsonl"]);
});

test("blocks when a required verification check fails", async () => {
  const data = await setup({ "workflow.json": workflow, "verification.json": verification({ tests: "fail" }) });
  const pack = await composeRequest(request(data.refs), data.root);
  assert.equal(pack.status, "blocked");
  assert.deepEqual(pack.blockingReasons, ["CHECK_FAILED:tests"]);
});

test("rejects digest drift, path escape, malformed JSONL, privacy keys, and identity mismatch", async () => {
  const data = await setup({ "workflow.json": workflow, "verification.json": verification() });
  await assert.rejects(() => composeRequest(request(data.refs.map(ref => ref.kind === "workflow-index" ? { ...ref, sha256: digest } : ref)), data.root), /SOURCE_DIGEST_MISMATCH/);
  await assert.rejects(() => composeRequest(request([{ ...data.refs[0], path: "../outside.json" }, ...data.refs.slice(1)]), data.root), /PATH_OUTSIDE_ROOT/);
  const privacy = await setup({ "workflow.json": { ...workflow, token: "secret" }, "verification.json": verification() });
  await assert.rejects(() => composeRequest(request(privacy.refs), privacy.root), /PRIVACY_REJECTED/);
  const identity = await setup({ "workflow.json": { ...workflow, taskId: "other-task" }, "verification.json": verification() });
  await assert.rejects(() => composeRequest(request(identity.refs), identity.root), /IDENTITY_CONFLICT/);
});

test("writes a validated pack atomically", async () => {
  const data = await setup({ "workflow.json": workflow, "verification.json": verification() });
  const pack = await composeRequest(request(data.refs), data.root);
  const output = join(data.root, "out", "pack.json");
  await writePackAtomic(output, pack, data.root);
  assert.equal(validatePack(JSON.parse(await (await import("node:fs/promises")).readFile(output, "utf8"))), true);
});

test("consumes native hooks acceptance evidence without inventing a parallel check contract", async () => {
  const nativeEvidence = {
    schema: "ccpanes.acceptance.v1",
    taskId: "task-001",
    worktreeRoot: "D:/fixture",
    branch: null,
    head: null,
    artifactHashes: [],
    checks: [
      { name: "build", command: "pnpm build", result: "pass", evidence: "build passed" },
      { name: "tests", command: "pnpm test", result: "pass", evidence: "tests passed" }
    ],
    truthLayers: [
      { name: "task-scope", state: "pass", required: true, evidence: "bound", reason: "scope" },
      { name: "repo-gates", state: "pass", required: true, evidence: "checks", reason: "gates" },
      { name: "completion", state: "pass", required: true, evidence: "all", reason: "complete" }
    ],
    summary: { passed: true, completionAllowed: true, requiredLayerCount: 3, failingLayerCount: 0, blockedLayerCount: 0, notRunLayerCount: 0 },
    recordedAt: "2026-08-27T12:00:00Z"
  };
  const data = await setup({ "workflow.json": workflow, "acceptance.json": nativeEvidence });
  const refs = data.refs.map(ref => ref.path === "acceptance.json" ? { ...ref, kind: "acceptance-evidence" as const } : ref);
  const pack = await composeRequest(request(refs), data.root);
  assert.equal(pack.status, "ready");
  assert.equal(pack.checks.build, "pass");
  assert.equal(pack.checks.tests, "pass");
  assert.equal(pack.completionAllowed, true);
  assert.equal(pack.truthLayers?.length, 3);
});

test("blocks native hooks evidence when a check was not run", async () => {
  const nativeEvidence = {
    schema: "ccpanes.acceptance.v1", taskId: "task-001", worktreeRoot: "D:/fixture", branch: null, head: null, artifactHashes: [],
    checks: [{ name: "tests", command: "pnpm test", result: "not-run", evidence: "not executed" }],
    truthLayers: [{ name: "completion", state: "not-run", required: true, evidence: "tests:not-run", reason: "complete" }],
    summary: { passed: false, completionAllowed: false, requiredLayerCount: 1, failingLayerCount: 0, blockedLayerCount: 0, notRunLayerCount: 1 },
    recordedAt: "2026-08-27T12:00:00Z"
  };
  const data = await setup({ "workflow.json": workflow, "acceptance.json": nativeEvidence });
  const refs = data.refs.map(ref => ref.path === "acceptance.json" ? { ...ref, kind: "acceptance-evidence" as const } : ref);
  const pack = await composeRequest(request(refs), data.root);
  assert.equal(pack.status, "blocked");
  assert.ok(pack.blockingReasons.includes("CHECK_NOT_RUN:tests"));
});

test("blocks native hooks verification when an artifact does not match", async () => {
  const nativeVerification = {
    schema: "ccpanes.acceptance.verify.v1", taskId: "task-001", passed: false,
    artifactResults: [{ path: "artifact.json", expectedSha256: "A", actualSha256: "B", status: "mismatch" }],
    checkResults: [{ name: "tests", command: "pnpm test", status: "pass", evidence: "passed" }],
    truthLayers: [], summary: { passed: false, completionAllowed: false, requiredLayerCount: 1, failingLayerCount: 1, blockedLayerCount: 0, notRunLayerCount: 0 },
    failures: ["artifact hash mismatch"], verifiedAt: "2026-08-27T12:00:00Z"
  };
  const data = await setup({ "workflow.json": workflow, "acceptance-verify.json": nativeVerification });
  const refs = data.refs.map(ref => ref.path === "acceptance-verify.json" ? { ...ref, kind: "acceptance-verification" as const } : ref);
  const pack = await composeRequest(request(refs), data.root);
  assert.equal(pack.status, "blocked");
  assert.ok(pack.blockingReasons.includes("ARTIFACT_MISMATCH:artifact.json"));
  assert.equal(pack.artifactResults?.[0]?.status, "mismatch");
});

test("publishes a JSON Schema matching the emitted pack contract", async () => {
  const schema = JSON.parse(await readFile(join(process.cwd(), "schemas", "ccpanes.acceptance.pack.v1.schema.json"), "utf8"));
  assert.equal(schema.$id, "ccpanes.acceptance.pack.v1");
  assert.deepEqual(schema.required, ["schema", "generatedAt", "status", "taskId", "runId", "workspaceId", "workflowStatus", "checks", "sources", "blockingReasons", "missingOptional", "advisoryOnly"]);
  assert.equal(schema.properties.status.enum.join(","), "ready,partial,blocked");
  assert.equal(schema.properties.advisoryOnly.const, true);
});

test("publishes a JSON Schema matching the acceptance request contract", async () => {
  const schema = JSON.parse(await readFile(join(process.cwd(), "schemas", "ccpanes.acceptance.request.v1.schema.json"), "utf8"));
  assert.equal(schema.$id, "ccpanes.acceptance.request.v1");
  assert.deepEqual(schema.required, ["schema", "taskId", "runId", "workspaceId", "sources"]);
  assert.equal(schema.properties.schema.const, "ccpanes.acceptance.request.v1");
  assert.deepEqual(schema.properties.sources.items.required, ["kind", "path", "sha256", "required"]);
});

test("explains a native acceptance pack as stable human-readable text", async () => {
  const data = await setup({ "workflow.json": workflow, "acceptance.json": {
    schema: "ccpanes.acceptance.v1", taskId: "task-001", worktreeRoot: "D:/fixture", branch: null, head: null, artifactHashes: [],
    checks: [{ name: "tests", command: "pnpm test", result: "pass", evidence: "passed" }],
    truthLayers: [{ name: "completion", state: "pass", required: true, evidence: "all", reason: "complete" }],
    summary: { passed: true, completionAllowed: true, requiredLayerCount: 1, failingLayerCount: 0, blockedLayerCount: 0, notRunLayerCount: 0 },
    recordedAt: "2026-08-27T12:00:00Z"
  } });
  const refs = data.refs.map(ref => ref.path === "acceptance.json" ? { ...ref, kind: "acceptance-evidence" as const } : ref);
  const text = explainPack(await composeRequest(request(refs), data.root, "2026-08-27T12:00:00Z"));
  assert.match(text, /Status: ready/);
  assert.match(text, /Completion: allowed/);
  assert.match(text, /- tests: pass/);
  assert.match(text, /- completion: pass \(required\)/);
  assert.match(text, /Blocking Reasons: none/);
});

test("explains blocking reasons without source contents", async () => {
  const data = await setup({ "workflow.json": workflow, "verification.json": verification({ tests: "fail" }) });
  const text = explainPack(await composeRequest(request(data.refs), data.root));
  assert.match(text, /Status: blocked/);
  assert.match(text, /- CHECK_FAILED:tests/);
  assert.doesNotMatch(text, /safeSummary/);
});

test("runtime pack validation rejects malformed checks, sources, and native summaries", async () => {
  const data = await setup({ "workflow.json": workflow, "verification.json": verification() });
  const pack = await composeRequest(request(data.refs), data.root);
  assert.equal(validatePack({ ...pack, checks: { tests: "unexpected" } }), false);
  assert.equal(validatePack({ ...pack, sources: "not-an-array" }), false);
  assert.equal(validatePack({ ...pack, sources: [{ kind: "audit", path: "audit.json", sha256: "bad" }] }), false);
  assert.equal(validatePack({ ...pack, truthLayers: [{ name: "completion", state: "pass", required: "yes" }] }), false);
  assert.equal(validatePack({ ...pack, artifactResults: [{ path: "a", status: 1 }] }), false);
  assert.equal(validatePack({ ...pack, generatedAt: "not-a-date" }), false);
});

test("runtime request validation rejects malformed manifests without reading source files", () => {
  const valid = request([
    { kind: "workflow-index", path: "workflow.json", sha256: digest, required: true },
    { kind: "verification-summary", path: "verification.json", sha256: digest, required: true }
  ]);
  assert.equal(validateRequest(valid), true);
  assert.equal(validateRequest({ ...valid, schema: "wrong" }), false);
  assert.equal(validateRequest({ ...valid, extra: true }), false);
  assert.equal(validateRequest({ ...valid, taskId: "x" }), false);
  assert.equal(validateRequest({ ...valid, runId: "x" }), false);
  assert.equal(validateRequest({ ...valid, workspaceId: "x" }), false);
  assert.equal(validateRequest({ ...valid, sources: undefined }), false);
  assert.equal(validateRequest({ ...valid, sources: [{ ...valid.sources[0], kind: "unknown" }] }), false);
  assert.equal(validateRequest({ ...valid, sources: [{ ...valid.sources[0], extra: true }, valid.sources[1]] }), false);
  assert.equal(validateRequest({ ...valid, sources: [{ ...valid.sources[0], sha256: "bad" }] }), false);
  assert.equal(validateRequest({ ...valid, sources: [{ ...valid.sources[0], path: "" }] }), false);
  assert.equal(validateRequest({
    ...valid,
    sources: [valid.sources[0], valid.sources[0], valid.sources[1]]
  }), false);
  assert.equal(validateRequest({
    ...valid,
    sources: [valid.sources[1]]
  }), false);
  assert.equal(validateRequest({
    ...valid,
    sources: [{ kind: "workflow-index", path: "workflow.json", sha256: digest, required: true }]
  }), false);
});
