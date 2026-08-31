import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

type CheckStatus = "pass" | "fail" | "blocked" | "not-run";
type SourceKind = "workflow-index" | "verification-summary" | "acceptance-evidence" | "acceptance-verification" | "bootstrap-evidence" | "audit";
type SourceRef = { kind: SourceKind; path: string; sha256: string; required: boolean };

export interface AcceptanceRequest {
  schema: "ccpanes.acceptance.request.v1";
  taskId: string;
  runId: string;
  workspaceId: string;
  sources: SourceRef[];
}

export interface AcceptancePack {
  schema: "ccpanes.acceptance.pack.v1";
  generatedAt: string;
  status: "ready" | "partial" | "blocked";
  taskId: string;
  runId: string;
  workspaceId: string;
  workflowStatus: string;
  bootstrapStatus?: string;
  bootstrapStarted?: boolean;
  checks: Record<string, CheckStatus>;
  completionAllowed?: boolean;
  truthLayers?: Array<{ name: string; state: string; required: boolean }>;
  artifactResults?: Array<{ path: string; status: string }>;
  sources: Array<{ kind: SourceKind; path: string; sha256: string }>;
  blockingReasons: string[];
  missingOptional: string[];
  advisoryOnly: true;
}

const id = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const digest = /^sha256:[0-9a-f]{64}$/;
const checkNames = ["build", "typecheck", "lint", "tests", "smoke", "scope", "privacy"] as const;
const sensitiveKey = /token|secret|password|credential|api[-_]?key|raw[-_]?transcript/i;

export const sha256 = (value: Buffer | string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

function confinedPath(root: string, value: string): string {
  if (!value || isAbsolute(value) || value.split(/[\\/]+/).includes("..")) throw new Error("PATH_OUTSIDE_ROOT");
  const base = resolve(root);
  const target = resolve(base, value);
  const relation = relative(base, target);
  if (relation.startsWith("..") || isAbsolute(relation)) throw new Error("PATH_OUTSIDE_ROOT");
  return target;
}

function assertRequest(value: unknown): asserts value is AcceptanceRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_REQUEST");
  const request = value as Partial<AcceptanceRequest>;
  if (Object.keys(request).some(key => !["schema", "taskId", "runId", "workspaceId", "sources"].includes(key))) throw new Error("INVALID_REQUEST");
  if (request.schema !== "ccpanes.acceptance.request.v1" || typeof request.taskId !== "string" || !id.test(request.taskId) || typeof request.runId !== "string" || !id.test(request.runId) || typeof request.workspaceId !== "string" || !id.test(request.workspaceId) || !Array.isArray(request.sources) || request.sources.length < 2) throw new Error("INVALID_REQUEST");
  const kinds = new Set<SourceKind>();
  for (const source of request.sources) {
    if (!source || typeof source !== "object" || Array.isArray(source)) throw new Error("INVALID_REQUEST");
    const item = source as Partial<SourceRef>;
    if (Object.keys(item).some(key => !["kind", "path", "sha256", "required"].includes(key))) throw new Error("INVALID_REQUEST");
    if (!["workflow-index", "verification-summary", "acceptance-evidence", "acceptance-verification", "bootstrap-evidence", "audit"].includes(String(item.kind)) || typeof item.path !== "string" || !item.path || typeof item.sha256 !== "string" || !digest.test(item.sha256) || typeof item.required !== "boolean") throw new Error("INVALID_REQUEST");
    if (kinds.has(item.kind as SourceKind) && item.kind !== "audit") throw new Error("INVALID_REQUEST");
    kinds.add(item.kind as SourceKind);
  }
  if (!kinds.has("workflow-index") || (!kinds.has("verification-summary") && !kinds.has("acceptance-evidence") && !kinds.has("acceptance-verification"))) throw new Error("INVALID_REQUEST");
}

export function validateRequest(value: unknown): value is AcceptanceRequest {
  try {
    assertRequest(value);
    return true;
  } catch {
    return false;
  }
}

function rejectPrivacy(value: unknown): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) rejectPrivacy(item);
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (sensitiveKey.test(key) && !/Stored$/.test(key)) throw new Error("PRIVACY_REJECTED");
    rejectPrivacy(item);
  }
}

function parseSource(source: SourceRef, text: string): unknown {
  if (source.path.endsWith(".jsonl")) {
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (!lines.length) throw new Error("INVALID_SOURCE");
    return lines.map(line => {
      try { return JSON.parse(line); } catch { throw new Error("INVALID_JSONL"); }
    });
  }
  try { return JSON.parse(text); } catch { throw new Error("INVALID_JSON"); }
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_SOURCE");
  return value as Record<string, unknown>;
}

function validateIdentity(kind: SourceKind, value: unknown, request: AcceptanceRequest): string | undefined {
  if (kind === "workflow-index") {
    const item = objectValue(value);
    if (item.schema !== "ccpanes.workflow.index.v1" || item.taskId !== request.taskId || item.runId !== request.runId || typeof item.status !== "string") throw new Error("IDENTITY_CONFLICT");
    return item.status;
  }
  if (kind === "verification-summary") {
    const item = objectValue(value);
    if (item.schema !== "ccpanes.verification.summary.v1" || item.taskId !== request.taskId || item.runId !== request.runId) throw new Error("IDENTITY_CONFLICT");
    const checks = objectValue(item.checks);
    for (const name of checkNames) {
      const check = objectValue(checks[name]);
      if (!["pass", "fail", "blocked"].includes(String(check.status)) || typeof check.safeSummary !== "string") throw new Error("INVALID_VERIFICATION");
    }
    return undefined;
  }
  if (kind === "acceptance-evidence") {
    const item = objectValue(value);
    const summary = objectValue(item.summary);
    if (item.schema !== "ccpanes.acceptance.v1" || item.taskId !== request.taskId || !Array.isArray(item.checks) || !Array.isArray(item.truthLayers) || typeof summary.completionAllowed !== "boolean") throw new Error("IDENTITY_CONFLICT");
    return undefined;
  }
  if (kind === "acceptance-verification") {
    const item = objectValue(value);
    if (item.schema !== "ccpanes.acceptance.verify.v1" || item.taskId !== request.taskId || typeof item.passed !== "boolean" || !Array.isArray(item.checkResults) || !Array.isArray(item.artifactResults)) throw new Error("IDENTITY_CONFLICT");
    return undefined;
  }
  if (kind === "bootstrap-evidence") {
    const item = objectValue(value);
    if (item.schema !== "ccpanes.bootstrap.evidence.v1" || item.taskId !== request.taskId || typeof item.runId !== "string" ||
      !["CREATED", "BOOTSTRAPPING", "ACTIVE", "SYSTEM_ERROR", "BOOTSTRAP_PROTOCOL_ERROR", "COMPLETED"].includes(String(item.status)) ||
      typeof item.threadIdDigest !== "string" || typeof item.firstActivityObserved !== "boolean" ||
      typeof item.handoffRead !== "boolean" || (item.protocolErrorCode !== null && typeof item.protocolErrorCode !== "string")) throw new Error("INVALID_BOOTSTRAP_EVIDENCE");
    if (item.runId !== request.runId) throw new Error("IDENTITY_CONFLICT");
    return undefined;
  }
  const values = Array.isArray(value) ? value : [value];
  for (const item of values) {
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      if (record.taskId !== undefined && record.taskId !== request.taskId) throw new Error("IDENTITY_CONFLICT");
      if (record.runId !== undefined && record.runId !== request.runId) throw new Error("IDENTITY_CONFLICT");
    }
  }
  return undefined;
}

export async function composeRequest(request: AcceptanceRequest, root: string, generatedAt = new Date().toISOString()): Promise<AcceptancePack> {
  assertRequest(request);
  const sources: AcceptancePack["sources"] = [];
  const missingOptional: string[] = [];
  let workflowStatus = "unknown";
  let checks: Record<string, CheckStatus> = {};
  let completionAllowed: boolean | undefined;
  let truthLayers: AcceptancePack["truthLayers"];
  let artifactResults: AcceptancePack["artifactResults"];
  let bootstrapStatus: string | undefined;
  let bootstrapStarted: boolean | undefined;
  const blockingReasons: string[] = [];

  for (const source of request.sources) {
    const target = confinedPath(root, source.path);
    let bytes: Buffer;
    try { bytes = await readFile(target); } catch {
      if (source.required) throw new Error("SOURCE_MISSING");
      missingOptional.push(source.path);
      continue;
    }
    const actual = sha256(bytes);
    if (actual !== source.sha256) throw new Error("SOURCE_DIGEST_MISMATCH");
    const parsed = parseSource(source, bytes.toString("utf8"));
    rejectPrivacy(parsed);
    const sourceStatus = validateIdentity(source.kind, parsed, request);
    if (source.kind === "workflow-index") workflowStatus = sourceStatus ?? "unknown";
    if (source.kind === "verification-summary") {
      const verification = objectValue(parsed);
      const rawChecks = objectValue(verification.checks);
      checks = Object.fromEntries(checkNames.map(name => [name, objectValue(rawChecks[name]).status as CheckStatus]));
      for (const name of checkNames) {
        if (checks[name] === "fail") blockingReasons.push(`CHECK_FAILED:${name}`);
        if (checks[name] === "blocked") blockingReasons.push(`CHECK_BLOCKED:${name}`);
        if (checks[name] === "not-run") blockingReasons.push(`CHECK_NOT_RUN:${name}`);
      }
    }
    if (source.kind === "acceptance-evidence") {
      const evidence = objectValue(parsed);
      const nativeChecks = evidence.checks as Array<Record<string, unknown>>;
      checks = Object.fromEntries(nativeChecks.map(check => [String(check.name), check.result as CheckStatus]));
      for (const [name, status] of Object.entries(checks)) {
        if (status === "fail") blockingReasons.push(`CHECK_FAILED:${name}`);
        if (status === "blocked") blockingReasons.push(`CHECK_BLOCKED:${name}`);
        if (status === "not-run") blockingReasons.push(`CHECK_NOT_RUN:${name}`);
      }
      const summary = objectValue(evidence.summary);
      completionAllowed = summary.completionAllowed as boolean;
      if (completionAllowed !== true) blockingReasons.push("NATIVE_COMPLETION_NOT_ALLOWED");
      truthLayers = (evidence.truthLayers as Array<Record<string, unknown>>).map(layer => ({ name: String(layer.name), state: String(layer.state), required: layer.required === true }));
      for (const layer of truthLayers) {
        if (layer.required === true && layer.state !== "pass") blockingReasons.push(`TRUTH_LAYER_${String(layer.name).toUpperCase()}:${String(layer.state)}`);
      }
    }
    if (source.kind === "bootstrap-evidence") {
      const bootstrap = objectValue(parsed);
      bootstrapStatus = String(bootstrap.status);
      bootstrapStarted = bootstrap.firstActivityObserved === true && bootstrap.handoffRead === true &&
        (bootstrap.status === "ACTIVE" || bootstrap.status === "COMPLETED");
      if (bootstrapStatus === "BOOTSTRAP_PROTOCOL_ERROR") {
        blockingReasons.push(`BOOTSTRAP_PROTOCOL_ERROR:${bootstrap.protocolErrorCode ?? "UNKNOWN"}`);
      }
    }
    if (source.kind === "acceptance-verification") {
      const verification = objectValue(parsed);
      const nativeChecks = verification.checkResults as Array<Record<string, unknown>>;
      checks = Object.fromEntries(nativeChecks.map(check => [String(check.name), check.status as CheckStatus]));
      const summary = objectValue(verification.summary);
      completionAllowed = summary.completionAllowed === true;
      artifactResults = (verification.artifactResults as Array<Record<string, unknown>>).map(artifact => ({ path: String(artifact.path), status: String(artifact.status) }));
      if (verification.passed !== true) blockingReasons.push("NATIVE_VERIFICATION_FAILED");
      for (const artifact of artifactResults) {
        if (artifact.status !== "match") blockingReasons.push(`ARTIFACT_${String(artifact.status).toUpperCase()}:${String(artifact.path)}`);
      }
    }
    sources.push({ kind: source.kind, path: source.path.replace(/\\/g, "/"), sha256: actual });
  }

  if (workflowStatus === "blocked" || workflowStatus === "unknown") blockingReasons.push(`WORKFLOW_${workflowStatus.toUpperCase()}`);
  const status = blockingReasons.length ? "blocked" : (workflowStatus === "ready" && missingOptional.length === 0 ? "ready" : "partial");
  return { schema: "ccpanes.acceptance.pack.v1", generatedAt, status, taskId: request.taskId, runId: request.runId, workspaceId: request.workspaceId, workflowStatus, checks, ...(bootstrapStatus === undefined ? {} : { bootstrapStatus, bootstrapStarted }), ...(completionAllowed === undefined ? {} : { completionAllowed }), ...(truthLayers === undefined ? {} : { truthLayers }), ...(artifactResults === undefined ? {} : { artifactResults }), sources, blockingReasons, missingOptional, advisoryOnly: true };
}

export function validatePack(value: unknown): value is AcceptancePack {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const pack = value as Record<string, unknown>;
  if (pack.schema !== "ccpanes.acceptance.pack.v1" || typeof pack.generatedAt !== "string" || Number.isNaN(Date.parse(pack.generatedAt)) || !["ready", "partial", "blocked"].includes(String(pack.status)) || typeof pack.taskId !== "string" || !id.test(pack.taskId) || typeof pack.runId !== "string" || !id.test(pack.runId) || typeof pack.workspaceId !== "string" || !id.test(pack.workspaceId) || typeof pack.workflowStatus !== "string" || pack.advisoryOnly !== true) return false;
  if (!pack.checks || typeof pack.checks !== "object" || Array.isArray(pack.checks) || !Object.values(pack.checks).every(status => ["pass", "fail", "blocked", "not-run"].includes(String(status)))) return false;
  if (!Array.isArray(pack.sources) || !pack.sources.every(source => {
    if (!source || typeof source !== "object" || Array.isArray(source)) return false;
    const item = source as Record<string, unknown>;
    return ["workflow-index", "verification-summary", "acceptance-evidence", "acceptance-verification", "audit"].includes(String(item.kind)) && typeof item.path === "string" && digest.test(String(item.sha256));
  })) return false;
  if (!Array.isArray(pack.blockingReasons) || !pack.blockingReasons.every(reason => typeof reason === "string")) return false;
  if (!Array.isArray(pack.missingOptional) || !pack.missingOptional.every(path => typeof path === "string")) return false;
  if (pack.bootstrapStatus !== undefined && (typeof pack.bootstrapStatus !== "string" || typeof pack.bootstrapStarted !== "boolean")) return false;
  if (pack.completionAllowed !== undefined && typeof pack.completionAllowed !== "boolean") return false;
  if (pack.truthLayers !== undefined && (!Array.isArray(pack.truthLayers) || !pack.truthLayers.every(layer => {
    if (!layer || typeof layer !== "object" || Array.isArray(layer)) return false;
    const item = layer as Record<string, unknown>;
    return typeof item.name === "string" && typeof item.state === "string" && typeof item.required === "boolean";
  }))) return false;
  if (pack.artifactResults !== undefined && (!Array.isArray(pack.artifactResults) || !pack.artifactResults.every(artifact => {
    if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) return false;
    const item = artifact as Record<string, unknown>;
    return typeof item.path === "string" && typeof item.status === "string";
  }))) return false;
  return true;
}

export function explainPack(pack: AcceptancePack): string {
  if (!validatePack(pack)) throw new Error("INVALID_PACK");
  const lines = [
    `Status: ${pack.status}`,
    `Task: ${pack.taskId}`,
    `Run: ${pack.runId}`,
    `Workspace: ${pack.workspaceId}`,
    `Workflow: ${pack.workflowStatus}`,
    `Completion: ${pack.completionAllowed === undefined ? "not recorded" : pack.completionAllowed ? "allowed" : "not allowed"}`,
    "Checks:"
  ];
  for (const name of Object.keys(pack.checks).sort()) lines.push(`- ${name}: ${pack.checks[name]}`);
  if (pack.truthLayers?.length) {
    lines.push("Truth Layers:");
    for (const layer of [...pack.truthLayers].sort((a, b) => a.name.localeCompare(b.name))) lines.push(`- ${layer.name}: ${layer.state} (${layer.required ? "required" : "optional"})`);
  }
  if (pack.artifactResults?.length) {
    lines.push("Artifact Results:");
    for (const artifact of [...pack.artifactResults].sort((a, b) => a.path.localeCompare(b.path))) lines.push(`- ${artifact.path}: ${artifact.status}`);
  }
  if (pack.blockingReasons.length === 0) lines.push("Blocking Reasons: none");
  else {
    lines.push("Blocking Reasons:");
    for (const reason of pack.blockingReasons) lines.push(`- ${reason}`);
  }
  if (pack.missingOptional.length === 0) lines.push("Missing Optional: none");
  else {
    lines.push("Missing Optional:");
    for (const item of pack.missingOptional) lines.push(`- ${item}`);
  }
  lines.push(`Advisory Only: ${pack.advisoryOnly}`);
  return `${lines.join("\n")}\n`;
}

export async function writePackAtomic(output: string, pack: AcceptancePack, root: string): Promise<void> {
  if (!validatePack(pack)) throw new Error("INVALID_PACK");
  const target = confinedPath(root, relative(resolve(root), resolve(output)));
  await mkdir(dirname(target), { recursive: true });
  const temp = `${target}.tmp-${process.pid}`;
  await writeFile(temp, `${JSON.stringify(pack, null, 2)}\n`, "utf8");
  await rename(temp, target);
  if (!validatePack(JSON.parse(await readFile(target, "utf8")))) throw new Error("RESULT_WRITE_FAILED");
}
