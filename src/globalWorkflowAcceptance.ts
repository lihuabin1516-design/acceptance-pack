export type AcceptanceAuthority = "canonical" | "observed" | "advisory" | "historical" | "unverified";
export type AcceptanceGate = "MCP_DISCOVERY" | "PREFLIGHT" | "WORKFLOW" | "ACCEPTANCE";
export type AcceptanceEligibility = "eligible" | "blocked";

export interface EvidenceProvenance {
  authority: AcceptanceAuthority;
  observedAt: string;
  source: string;
}

export interface WorkflowEvidence extends EvidenceProvenance {
  state: string;
  taskId?: string;
  runId?: string;
  workspaceId?: string;
}

export interface ContextEvidence extends EvidenceProvenance {
  digest: string;
  expectedDigest?: string;
  binding?: { taskId: string; runId: string; workspaceId: string };
}

export interface GlobalWorkflowAcceptanceInput {
  identity: { taskId: string; runId: string; workspaceId: string };
  bootstrap?: WorkflowEvidence & { inventory?: WorkflowEvidence };
  preflight?: WorkflowEvidence;
  session?: WorkflowEvidence;
  worker?: WorkflowEvidence;
  workflow?: WorkflowEvidence;
  result?: WorkflowEvidence;
  hooks?: {
    completionAllowed: boolean;
    truthLayers: Array<{ name: string; state: string; required: boolean }>;
    artifactResults?: Array<{ path: string; status: string }>;
  };
  context?: {
    current?: ContextEvidence;
    previous?: ContextEvidence;
    previous2?: ContextEvidence;
  };
  versions?: { currentOfficial?: string; historical?: string[] };
}

export interface GlobalWorkflowAcceptanceProjection {
  schema: "ccpanes.global-workflow-acceptance.projection.v1";
  authority: "advisory";
  advisoryOnly: true;
  projectionReady: boolean;
  acceptanceEligibility: AcceptanceEligibility;
  productionStatus: "not-established";
  nextGate: AcceptanceGate;
  authorityLabels: AcceptanceAuthority[];
  evidence: Partial<Record<"bootstrap" | "inventory" | "preflight" | "session" | "worker" | "workflow" | "result", WorkflowEvidence>>;
  context: {
    current?: ContextEvidence & { slot: "current" };
    previous?: ContextEvidence & { slot: "previous" };
    previous2?: ContextEvidence & { slot: "previous2" };
  };
  versions?: { currentOfficial?: string; historical?: string[] };
  completionAllowed?: boolean;
  truthLayers?: Array<{ name: string; state: string; required: boolean }>;
  artifactResults?: Array<{ path: string; status: string }>;
  blockingReasons: string[];
}

const authorities: AcceptanceAuthority[] = ["canonical", "observed", "advisory", "historical", "unverified"];
const id = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const digest = /^sha256:[0-9a-f]{64}$/;
const sensitiveKey = /token|authorization|secret|password|credential|api[-_]?key|raw[-_]?session|transcript/i;
const sensitiveValue = /^(?:Bearer\s+|sk-|gh[pousr]_|AKIA[0-9A-Z])/i;

function blockedProjection(input: GlobalWorkflowAcceptanceInput, reasons: string[], nextGate: AcceptanceGate): GlobalWorkflowAcceptanceProjection {
  return {
    schema: "ccpanes.global-workflow-acceptance.projection.v1",
    authority: "advisory",
    advisoryOnly: true,
    projectionReady: false,
    acceptanceEligibility: "blocked",
    productionStatus: "not-established",
    nextGate,
    authorityLabels: [...authorities],
    evidence: collectEvidence(input),
    context: collectContext(input),
    ...(canNormalizeVersions(input.versions) ? { versions: normalizeVersions(input.versions) } : {}),
    ...(canNormalizeHooks(input.hooks) ? normalizeHooks(input.hooks) : {}),
    blockingReasons: [...new Set(reasons)]
  };
}

function collectEvidence(input: GlobalWorkflowAcceptanceInput): GlobalWorkflowAcceptanceProjection["evidence"] {
  const result: GlobalWorkflowAcceptanceProjection["evidence"] = {};
  for (const name of ["bootstrap", "preflight", "session", "worker", "workflow", "result"] as const) {
    const value = input[name];
    if (value) result[name] = { authority: value.authority, observedAt: value.observedAt, source: value.source, state: value.state };
  }
  const inventory = input.bootstrap?.inventory;
  if (inventory) result.inventory = { authority: inventory.authority, observedAt: inventory.observedAt, source: inventory.source, state: inventory.state };
  return result;
}

function collectContext(input: GlobalWorkflowAcceptanceInput): GlobalWorkflowAcceptanceProjection["context"] {
  const context = input.context ?? {};
  const result: GlobalWorkflowAcceptanceProjection["context"] = {};
  for (const slot of ["current", "previous", "previous2"] as const) {
    const value = context[slot];
    if (!value) continue;
    if (slot === "current") result.current = projectContext(value, "current");
    if (slot === "previous") result.previous = projectContext(value, "previous");
    if (slot === "previous2") result.previous2 = projectContext(value, "previous2");
  }
  return result;
}

function projectContext<TSlot extends "current" | "previous" | "previous2">(
  value: ContextEvidence,
  slot: TSlot
): ContextEvidence & { slot: TSlot } {
  return {
      authority: value.authority,
      observedAt: value.observedAt,
      source: value.source,
      digest: value.digest,
      ...(value.expectedDigest === undefined ? {} : { expectedDigest: value.expectedDigest }),
      ...(value.binding === undefined ? {} : {
        binding: {
          taskId: value.binding.taskId,
          runId: value.binding.runId,
          workspaceId: value.binding.workspaceId
        }
      }),
      slot
  };
}

function normalizeVersions(versions: NonNullable<GlobalWorkflowAcceptanceInput["versions"]>) {
  return {
    ...(versions.currentOfficial === undefined ? {} : { currentOfficial: versions.currentOfficial }),
    ...(versions.historical === undefined ? {} : { historical: [...versions.historical] })
  };
}

function normalizeHooks(hooks: NonNullable<GlobalWorkflowAcceptanceInput["hooks"]>) {
  return {
    completionAllowed: hooks.completionAllowed,
    truthLayers: hooks.truthLayers.map(({ name, state, required }) => ({ name, state, required })),
    ...(hooks.artifactResults === undefined ? {} : { artifactResults: hooks.artifactResults.map(({ path, status }) => ({ path, status })) })
  };
}

function canNormalizeHooks(hooks: unknown): hooks is NonNullable<GlobalWorkflowAcceptanceInput["hooks"]> {
  if (!hooks || typeof hooks !== "object") return false;
  const candidate = hooks as { completionAllowed?: unknown; truthLayers?: unknown; artifactResults?: unknown };
  const truthLayers = candidate.truthLayers;
  const artifactResults = candidate.artifactResults;
  return typeof candidate.completionAllowed === "boolean" &&
    Array.isArray(truthLayers) &&
    truthLayers.every(layer => !!layer && typeof layer === "object" &&
      typeof (layer as { name?: unknown }).name === "string" &&
      typeof (layer as { state?: unknown }).state === "string" &&
      typeof (layer as { required?: unknown }).required === "boolean") &&
    (artifactResults === undefined || (Array.isArray(artifactResults) && artifactResults.every(artifact => !!artifact && typeof artifact === "object" &&
      typeof (artifact as { path?: unknown }).path === "string" &&
      typeof (artifact as { status?: unknown }).status === "string")));
}

function canNormalizeVersions(versions: unknown): versions is NonNullable<GlobalWorkflowAcceptanceInput["versions"]> {
  return !!versions && typeof versions === "object" &&
    ((versions as { currentOfficial?: unknown }).currentOfficial === undefined || typeof (versions as { currentOfficial?: unknown }).currentOfficial === "string") &&
    ((versions as { historical?: unknown }).historical === undefined ||
      (Array.isArray((versions as { historical?: unknown }).historical) &&
        (versions as { historical: unknown[] }).historical.every(version => typeof version === "string")));
}

function inspectInput(value: unknown, key = "", seen = new WeakSet<object>()): { sensitive: boolean; cyclic: boolean } {
  if (sensitiveKey.test(key)) return { sensitive: true, cyclic: false };
  if (typeof value === "string") return { sensitive: sensitiveValue.test(value) || /https?:\/\/|Authorization:/i.test(value), cyclic: false };
  if (!value || typeof value !== "object") return { sensitive: false, cyclic: false };
  if (seen.has(value)) return { sensitive: false, cyclic: true };
  seen.add(value);
  for (const [name, item] of Object.entries(value)) {
    const result = inspectInput(item, name, seen);
    if (result.sensitive || result.cyclic) return result;
  }
  return { sensitive: false, cyclic: false };
}

function validProvenance(value: EvidenceProvenance): boolean {
  return authorities.includes(value.authority) && typeof value.source === "string" && value.source.length > 0 &&
    !/[:/\\]{2}|session[-_]?id|raw/i.test(value.source) && typeof value.observedAt === "string" && !Number.isNaN(Date.parse(value.observedAt));
}

function validateInput(input: unknown): string[] {
  const reasons: string[] = [];
  if (!input || typeof input !== "object") return ["INPUT_INVALID_OR_SENSITIVE"];
  const inspection = inspectInput(input);
  if (inspection.cyclic) return ["INPUT_CYCLIC"];
  if (inspection.sensitive) return ["INPUT_INVALID_OR_SENSITIVE"];
  const candidate = input as GlobalWorkflowAcceptanceInput;
  const identity = candidate.identity;
  if (!identity || !id.test(identity.taskId) || !id.test(identity.runId) || !id.test(identity.workspaceId)) reasons.push("IDENTITY_INVALID");
  const records: Array<WorkflowEvidence | undefined> = [candidate.bootstrap, candidate.bootstrap?.inventory, candidate.preflight, candidate.session, candidate.worker, candidate.workflow, candidate.result];
  for (const record of records) {
    if (!record) continue;
    if (!authorities.includes(record.authority)) reasons.push(`AUTHORITY_UNTRUSTED:${record.source || "unknown"}:${String(record.authority)}`);
    else if (!["canonical", "observed"].includes(record.authority)) reasons.push(`AUTHORITY_UNTRUSTED:${record.source || "unknown"}:${record.authority}`);
    if (!validProvenance(record) || typeof record.state !== "string" ||
      (record.taskId !== undefined && record.taskId !== identity?.taskId) ||
      (record.runId !== undefined && record.runId !== identity?.runId) ||
      (record.workspaceId !== undefined && record.workspaceId !== identity?.workspaceId)) {
      reasons.push(`EVIDENCE_MALFORMED_OR_IDENTITY_CONFLICT:${record.source || "unknown"}`);
    }
  }
  if (candidate.context?.current) {
    const current = candidate.context.current;
    if (!validProvenance(current) || !digest.test(current.digest) || (current.expectedDigest !== undefined && !digest.test(current.expectedDigest))) reasons.push("CONTEXT_CURRENT_MALFORMED");
    if (typeof current.source !== "string" || !current.source.replace(/\\/g, "/").endsWith("context.md")) reasons.push("CONTEXT_CURRENT_SOURCE_CONFLICT");
    if (current.expectedDigest !== undefined && current.expectedDigest !== current.digest) reasons.push("CONTEXT_DIGEST_MISMATCH:current");
    const binding = current.binding;
    if (!binding || binding.taskId !== identity?.taskId || binding.runId !== identity?.runId || binding.workspaceId !== identity?.workspaceId) reasons.push("CONTEXT_IDENTITY_CONFLICT");
  }
  for (const slot of ["previous", "previous2"] as const) {
    const value = candidate.context?.[slot];
    if (value && (!validProvenance(value) || !digest.test(value.digest) || (value.expectedDigest !== undefined && !digest.test(value.expectedDigest)))) reasons.push(`CONTEXT_${slot.toUpperCase()}_MALFORMED`);
    if (value && (typeof value.source !== "string" || !value.source.replace(/\\/g, "/").endsWith(slot === "previous" ? "context.prev.md" : "context.prev2.md"))) reasons.push(`CONTEXT_${slot.toUpperCase()}_SOURCE_CONFLICT`);
    if (value && value.expectedDigest !== undefined && value.expectedDigest !== value.digest) reasons.push(`CONTEXT_DIGEST_MISMATCH:${slot}`);
  }
  if (!candidate.context?.current) reasons.push("CONTEXT_CURRENT_MISSING");
  if (!candidate.context?.previous) reasons.push("CONTEXT_PREVIOUS_MISSING");
  if (!candidate.context?.previous2) reasons.push("CONTEXT_PREVIOUS2_MISSING");
  if (candidate.hooks && (!canNormalizeHooks(candidate.hooks) || candidate.hooks.truthLayers.some(layer => !layer || typeof layer.name !== "string" || typeof layer.state !== "string" || typeof layer.required !== "boolean") || candidate.hooks.artifactResults?.some(artifact => !artifact || typeof artifact.path !== "string" || typeof artifact.status !== "string"))) reasons.push("HOOKS_MALFORMED");
  if (candidate.versions && (!canNormalizeVersions(candidate.versions) || candidate.versions.historical?.some(version => typeof version !== "string"))) reasons.push("VERSIONS_MALFORMED");
  return reasons;
}

export function projectGlobalWorkflowAcceptance(input: GlobalWorkflowAcceptanceInput | unknown): GlobalWorkflowAcceptanceProjection {
  const candidate = input && typeof input === "object" ? input as GlobalWorkflowAcceptanceInput : {} as GlobalWorkflowAcceptanceInput;
  const reasons = validateInput(input);
  if (reasons.length) {
    const nextGate: AcceptanceGate = candidate.bootstrap?.state === "READY" && candidate.bootstrap.inventory?.state === "READY"
      ? candidate.preflight?.state === "READY" ? "WORKFLOW" : "PREFLIGHT"
      : "MCP_DISCOVERY";
    return blockedProjection(candidate, reasons, nextGate);
  }

  if (candidate.bootstrap?.state !== "READY" || candidate.bootstrap.inventory?.state !== "READY") {
    return blockedProjection(candidate, [`MCP_DISCOVERY:${candidate.bootstrap?.inventory ? "INVENTORY_NOT_READY" : "INVENTORY_ABSENT"}`], "MCP_DISCOVERY");
  }
  if (candidate.preflight?.state !== "READY") return blockedProjection(candidate, [`PREFLIGHT:${candidate.preflight?.state ?? "MISSING"}`], "PREFLIGHT");
  if (candidate.session?.state !== "COMPLETE" || candidate.worker?.state !== "COMPLETE" || candidate.workflow?.state !== "COMPLETE" || candidate.result?.state !== "COMPLETE") {
    return blockedProjection(candidate, ["WORKFLOW:SESSION_WORKER_WORKFLOW_RESULT_EVIDENCE_INCOMPLETE"], "WORKFLOW");
  }

  const hookReasons: string[] = [];
  if (candidate.hooks) {
    if (!candidate.hooks.completionAllowed) hookReasons.push("HOOKS:completionAllowed=false");
    for (const layer of candidate.hooks.truthLayers) if (!["pass", "completed"].includes(layer.state)) hookReasons.push(`HOOKS:truthLayer:${layer.name}:${layer.state}`);
    for (const artifact of candidate.hooks.artifactResults ?? []) if (artifact.status !== "match") hookReasons.push(`HOOKS:artifact:${artifact.path}:${artifact.status}`);
  }
  if (hookReasons.length) return blockedProjection(candidate, hookReasons, "ACCEPTANCE");
  return {
    schema: "ccpanes.global-workflow-acceptance.projection.v1",
    authority: "advisory",
    advisoryOnly: true,
    projectionReady: true,
    acceptanceEligibility: "eligible",
    productionStatus: "not-established",
    nextGate: "ACCEPTANCE",
    authorityLabels: [...authorities],
    evidence: collectEvidence(candidate),
    context: collectContext(candidate),
    ...(candidate.versions === undefined ? {} : { versions: normalizeVersions(candidate.versions) }),
    ...(candidate.hooks === undefined ? {} : normalizeHooks(candidate.hooks)),
    blockingReasons: []
  };
}
