import test from "node:test";
import assert from "node:assert/strict";
import {
  projectGlobalWorkflowAcceptance,
  type GlobalWorkflowAcceptanceInput,
  type GlobalWorkflowAcceptanceProjection
} from "../src/index";

const provenance = (authority: "canonical" | "observed" | "advisory" | "historical" | "unverified", source: string) => ({
  authority,
  observedAt: "2026-09-02T10:00:00Z",
  source
});

const evidence = (state: string, authority: "canonical" | "observed" | "advisory" | "historical" | "unverified", source: string) => ({
  ...provenance(authority, source),
  state
});

const completeInput = (): GlobalWorkflowAcceptanceInput => ({
  identity: { taskId: "task-001", runId: "run-001", workspaceId: "workspace-001" },
  bootstrap: { ...evidence("READY", "observed", "workflow-index"), inventory: evidence("READY", "observed", "session-inventory") },
  preflight: evidence("READY", "canonical", "preflight-summary"),
  session: evidence("COMPLETE", "observed", "session-evidence"),
  worker: evidence("COMPLETE", "observed", "worker-evidence"),
  workflow: evidence("COMPLETE", "observed", "workflow-evidence"),
  result: evidence("COMPLETE", "observed", "result-evidence"),
  hooks: {
    completionAllowed: true,
    truthLayers: [{ name: "scope", state: "pass", required: true }, { name: "gates", state: "pass", required: true }],
    artifactResults: [{ path: "artifact.json", status: "match" }]
  },
  context: {
    current: { ...provenance("canonical", "context.md"), binding: { taskId: "task-001", runId: "run-001", workspaceId: "workspace-001" }, digest: "sha256:" + "a".repeat(64) },
    previous: { ...provenance("historical", "context.prev.md"), digest: "sha256:" + "b".repeat(64) },
    previous2: { ...provenance("historical", "context.prev2.md"), digest: "sha256:" + "c".repeat(64) }
  },
  versions: { currentOfficial: "0.12.9", historical: ["0.12.3"] }
});

test("blocks at MCP_DISCOVERY when bootstrap is READY but inventory is absent", () => {
  const input = completeInput();
  delete input.bootstrap!.inventory;
  const projection = projectGlobalWorkflowAcceptance(input);
  assert.equal(projection.nextGate, "MCP_DISCOVERY");
  assert.equal(projection.acceptanceEligibility, "blocked");
  assert.equal(projection.productionStatus, "not-established");
  assert.match(projection.blockingReasons.join("\n"), /inventory/i);
});

test("blocks at PREFLIGHT when inventory is READY but preflight is DEGRADED", () => {
  const input = completeInput();
  input.preflight = evidence("DEGRADED", "observed", "preflight-summary");
  const projection = projectGlobalWorkflowAcceptance(input);
  assert.equal(projection.nextGate, "PREFLIGHT");
  assert.equal(projection.acceptanceEligibility, "blocked");
});

test("blocks at WORKFLOW when preflight is READY but Session evidence is absent", () => {
  const input = completeInput();
  delete input.session;
  const projection = projectGlobalWorkflowAcceptance(input);
  assert.equal(projection.nextGate, "WORKFLOW");
  assert.equal(projection.acceptanceEligibility, "blocked");
  assert.match(projection.blockingReasons.join("\n"), /session/i);
});

test("projects complete evidence as eligible without production completion authority", () => {
  const projection = projectGlobalWorkflowAcceptance(completeInput());
  assert.equal(projection.nextGate, "ACCEPTANCE");
  assert.equal(projection.acceptanceEligibility, "eligible");
  assert.equal(projection.projectionReady, true);
  assert.equal(projection.productionStatus, "not-established");
  assert.equal(projection.advisoryOnly, true);
  assert.equal(projection.authority, "advisory");
  assert.deepEqual(projection.truthLayers, completeInput().hooks?.truthLayers);
  assert.deepEqual(projection.artifactResults, completeInput().hooks?.artifactResults);
});

test("requires canonical or observed authority for every completion evidence layer", () => {
  for (const name of ["session", "worker", "workflow", "result"] as const) {
    for (const authority of ["historical", "advisory", "unverified", "UNVERIFIED"] as const) {
      const input = completeInput();
      input[name] = evidence("COMPLETE", authority as "historical", `${name}-${authority}`);
      const projection = projectGlobalWorkflowAcceptance(input);
      assert.equal(projection.acceptanceEligibility, "blocked", `${name}/${authority}`);
      assert.match(projection.blockingReasons.join("\n"), new RegExp(`AUTHORITY|${name}`, "i"));
    }
  }
});

test("preserves authority layers, provenance, and three context generations", () => {
  const projection = projectGlobalWorkflowAcceptance(completeInput());
  assert.deepEqual(projection.authorityLabels, ["canonical", "observed", "advisory", "historical", "unverified"]);
  assert.equal(projection.evidence.bootstrap!.authority, "observed");
  assert.equal(projection.evidence.inventory!.source, "session-inventory");
  assert.equal(projection.evidence.preflight!.source, "preflight-summary");
  assert.deepEqual(Object.keys(projection.context), ["current", "previous", "previous2"]);
  assert.equal(projection.context.previous2?.source, "context.prev2.md");
});

test("fails closed for completion, truth layers, and artifacts", () => {
  const input = completeInput();
  input.hooks = {
    completionAllowed: false,
    truthLayers: [{ name: "gates", state: "blocked", required: true }, { name: "optional", state: "not-run", required: false }],
    artifactResults: [{ path: "artifact.json", status: "mismatch" }]
  };
  const projection = projectGlobalWorkflowAcceptance(input);
  assert.equal(projection.acceptanceEligibility, "blocked");
  assert.equal(projection.projectionReady, false);
  assert.match(projection.blockingReasons.join("\n"), /completionAllowed|truth layer|artifact/i);
});

test("does not treat QUEUED or accepted as Session/Worker proof", () => {
  const input = completeInput();
  input.session = evidence("QUEUED", "advisory", "queued-sidecar");
  input.worker = evidence("accepted", "advisory", "accepted-sidecar");
  const projection = projectGlobalWorkflowAcceptance(input);
  assert.equal(projection.nextGate, "WORKFLOW");
  assert.equal(projection.acceptanceEligibility, "blocked");
});

test("keeps current 0.12.9 and historical 0.12.3 separate and version-only input blocked", () => {
  const input = completeInput();
  const projection = projectGlobalWorkflowAcceptance(input);
  assert.deepEqual(projection.versions, { currentOfficial: "0.12.9", historical: ["0.12.3"] });
  const versionOnly = completeInput();
  delete versionOnly.bootstrap;
  delete versionOnly.preflight;
  delete versionOnly.session;
  delete versionOnly.worker;
  delete versionOnly.workflow;
  delete versionOnly.result;
  const blocked = projectGlobalWorkflowAcceptance(versionOnly);
  assert.equal(blocked.acceptanceEligibility, "blocked");
});

test("fails closed for malformed, identity-conflicting, digest-mismatched, and sensitive input", () => {
  const malformed = completeInput();
  malformed.preflight = undefined;
  assert.equal(projectGlobalWorkflowAcceptance(malformed).acceptanceEligibility, "blocked");

  const identityConflict = completeInput();
  identityConflict.context!.current!.binding!.runId = "other-run";
  assert.equal(projectGlobalWorkflowAcceptance(identityConflict).acceptanceEligibility, "blocked");

  const digestMismatch = completeInput();
  digestMismatch.context!.current!.expectedDigest = "sha256:" + "d".repeat(64);
  assert.equal(projectGlobalWorkflowAcceptance(digestMismatch).acceptanceEligibility, "blocked");

  const sensitive = completeInput();
  (sensitive as unknown as Record<string, unknown>).token = "TOKEN";
  assert.equal(projectGlobalWorkflowAcceptance(sensitive).acceptanceEligibility, "blocked");

  assert.equal(projectGlobalWorkflowAcceptance(null as unknown as GlobalWorkflowAcceptanceInput).acceptanceEligibility, "blocked");

  const malformedHooks = completeInput();
  malformedHooks.hooks = { completionAllowed: true, truthLayers: "bad" as unknown as GlobalWorkflowAcceptanceInput["hooks"] extends { truthLayers: infer T } ? T : never };
  assert.equal(projectGlobalWorkflowAcceptance(malformedHooks).acceptanceEligibility, "blocked");
});

test("projects only declared Hooks truth and artifact fields", () => {
  const input = completeInput();
  input.hooks!.truthLayers = [{ name: "scope", state: "pass", required: true, evidence: "secret-source", reason: "extra" } as NonNullable<typeof input.hooks>["truthLayers"][number]];
  input.hooks!.artifactResults = [{ path: "artifact.json", status: "match", expectedSha256: "secret", actualSha256: "secret" } as NonNullable<typeof input.hooks>["artifactResults"] extends Array<infer T> ? T : never];
  const projection = projectGlobalWorkflowAcceptance(input);
  assert.deepEqual(projection.truthLayers, [{ name: "scope", state: "pass", required: true }]);
  assert.deepEqual(projection.artifactResults, [{ path: "artifact.json", status: "match" }]);
});

test("blocks malformed version field and element types", () => {
  const current = completeInput();
  current.versions = { currentOfficial: 0.12 as unknown as string, historical: ["0.12.3", 12 as unknown as string] };
  const projection = projectGlobalWorkflowAcceptance(current);
  assert.equal(projection.acceptanceEligibility, "blocked");
  assert.match(projection.blockingReasons.join("\n"), /VERSION/i);
  assert.equal(projection.versions, undefined);
});

test("checks expectedDigest against digest for every context generation", () => {
  for (const slot of ["current", "previous", "previous2"] as const) {
    const input = completeInput();
    input.context![slot]!.expectedDigest = "sha256:" + "d".repeat(64);
    const projection = projectGlobalWorkflowAcceptance(input);
    assert.equal(projection.acceptanceEligibility, "blocked", slot);
    assert.match(projection.blockingReasons.join("\n"), /CONTEXT_DIGEST_MISMATCH/);
  }
});

test("returns typed blocked projection for malformed context and source shapes", () => {
  const input = completeInput() as unknown as Record<string, unknown>;
  (input.context as Record<string, unknown>).previous = { authority: "historical", observedAt: "bad-date", source: 42, digest: "bad" };
  const projection = projectGlobalWorkflowAcceptance(input);
  assert.equal(projection.acceptanceEligibility, "blocked");
  assert.equal(projection.projectionReady, false);
  assert.ok(projection.blockingReasons.some(reason => reason.includes("CONTEXT")));
});

test("is a pure function and does not mutate input", () => {
  const input = completeInput();
  const before = JSON.stringify(input);
  const first = projectGlobalWorkflowAcceptance(input);
  const second = projectGlobalWorkflowAcceptance(input);
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(first, second);
});

test("rejects evidence identity conflicts and any failed truth layer, including optional layers", () => {
  const identityConflict = completeInput();
  (identityConflict.session as GlobalWorkflowAcceptanceInput["session"] & { taskId?: string }).taskId = "other-task";
  assert.equal(projectGlobalWorkflowAcceptance(identityConflict).acceptanceEligibility, "blocked");

  const optionalFailure = completeInput();
  optionalFailure.hooks!.truthLayers.push({ name: "advisory", state: "fail", required: false });
  assert.equal(projectGlobalWorkflowAcceptance(optionalFailure).acceptanceEligibility, "blocked");
});

test("requires context slot sources to follow the three-generation contract", () => {
  const input = completeInput();
  input.context!.previous2!.source = "wrong-context.md";
  const projection = projectGlobalWorkflowAcceptance(input);
  assert.equal(projection.acceptanceEligibility, "blocked");
});

test("rebuilds all context generations from a whitelist and removes extra fields", () => {
  const input = completeInput() as unknown as Record<string, any>;
  input.context.current.extra = "current-extra";
  input.context.current.binding.extra = "binding-extra";
  input.context.previous.extra = "previous-extra";
  input.context.previous2.extra = "previous2-extra";
  const projection = projectGlobalWorkflowAcceptance(input);
  for (const slot of ["current", "previous", "previous2"] as const) {
    assert.equal(Object.prototype.hasOwnProperty.call(projection.context[slot], "extra"), false, slot);
    assert.deepEqual(Object.keys(projection.context[slot]!).sort(), ["authority", "digest", "observedAt", "slot", "source"].concat(slot === "current" ? ["binding"] : []).sort(), slot);
  }
  assert.equal(Object.prototype.hasOwnProperty.call(projection.context.current!.binding, "extra"), false);
  assert.notEqual(projection.context.current!.binding, input.context.current.binding);
  assert.deepEqual(projection.context.current!.binding, { taskId: "task-001", runId: "run-001", workspaceId: "workspace-001" });
});

test("requires all three context generations for eligibility", () => {
  for (const slot of ["previous", "previous2"] as const) {
    const input = completeInput();
    delete input.context![slot];
    const projection = projectGlobalWorkflowAcceptance(input);
    assert.equal(projection.acceptanceEligibility, "blocked", slot);
    assert.match(projection.blockingReasons.join("\n"), new RegExp(`CONTEXT_${slot.toUpperCase()}_MISSING`));
  }
});

test("allows only explicit pass or completed truth states", () => {
  for (const state of ["warn", "degraded", "partial", "unknown", "completed", "unexpected"]) {
    const input = completeInput();
    input.hooks!.truthLayers = [{ name: "gates", state, required: false }];
    const projection = projectGlobalWorkflowAcceptance(input);
    const allowed = state === "completed";
    assert.equal(projection.acceptanceEligibility, allowed ? "eligible" : "blocked", state);
  }
});

test("returns typed blocked projection for malformed Hooks array elements", () => {
  const truthLayerCases = [null, "primitive", { name: "gates" }];
  for (const value of truthLayerCases) {
    const input = completeInput() as unknown as Record<string, any>;
    input.hooks.truthLayers = [value];
    const projection = projectGlobalWorkflowAcceptance(input);
    assert.equal(projection.acceptanceEligibility, "blocked");
    assert.ok(projection.blockingReasons.includes("HOOKS_MALFORMED"));
  }
  const artifactInput = completeInput() as unknown as Record<string, any>;
  artifactInput.hooks.artifactResults = [null, "primitive"];
  const artifactProjection = projectGlobalWorkflowAcceptance(artifactInput);
  assert.equal(artifactProjection.acceptanceEligibility, "blocked");
  assert.ok(artifactProjection.blockingReasons.includes("HOOKS_MALFORMED"));
});

test("returns typed blocked projection for circular input", () => {
  const cyclic = completeInput() as unknown as Record<string, unknown>;
  cyclic.self = cyclic;
  const projection = projectGlobalWorkflowAcceptance(cyclic);
  assert.equal(projection.acceptanceEligibility, "blocked");
  assert.equal(projection.projectionReady, false);
  assert.ok(projection.blockingReasons.includes("INPUT_CYCLIC"));
});

test("exports the projection API from the package entry", () => {
  const projection: GlobalWorkflowAcceptanceProjection = projectGlobalWorkflowAcceptance(completeInput());
  assert.equal(projection.schema, "ccpanes.global-workflow-acceptance.projection.v1");
});
