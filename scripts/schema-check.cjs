const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const packSchema = JSON.parse(fs.readFileSync(path.join(root, "schemas", "paneforge.acceptance.pack.v1.schema.json"), "utf8"));
const requestSchema = JSON.parse(fs.readFileSync(path.join(root, "schemas", "paneforge.acceptance.request.v1.schema.json"), "utf8"));
const required = ["schema", "generatedAt", "status", "taskId", "runId", "workspaceId", "workflowStatus", "checks", "sources", "blockingReasons", "missingOptional", "advisoryOnly"];
if (packSchema.$id !== "paneforge.acceptance.pack.v1") throw new Error("SCHEMA_ID_MISMATCH");
if (JSON.stringify(packSchema.required) !== JSON.stringify(required)) throw new Error("SCHEMA_REQUIRED_MISMATCH");
if (packSchema.properties.status.enum.join(",") !== "ready,partial,blocked") throw new Error("SCHEMA_STATUS_MISMATCH");
if (packSchema.properties.advisoryOnly.const !== true) throw new Error("SCHEMA_AUTHORITY_MISMATCH");
if (requestSchema.$id !== "paneforge.acceptance.request.v1") throw new Error("REQUEST_SCHEMA_ID_MISMATCH");
if (JSON.stringify(requestSchema.required) !== JSON.stringify(["schema", "taskId", "runId", "workspaceId", "sources"])) throw new Error("REQUEST_SCHEMA_REQUIRED_MISMATCH");
if (requestSchema.properties.schema.const !== "paneforge.acceptance.request.v1") throw new Error("REQUEST_SCHEMA_CONST_MISMATCH");
if (JSON.stringify(requestSchema.properties.sources.items.required) !== JSON.stringify(["kind", "path", "sha256", "required"])) throw new Error("REQUEST_SOURCE_REQUIRED_MISMATCH");
for (const output of ["out/acceptance-pack.json", "out/native-acceptance-pack.json"]) {
  const value = JSON.parse(fs.readFileSync(path.join(root, output), "utf8"));
  for (const key of required) if (!(key in value)) throw new Error(`OUTPUT_REQUIRED_MISSING:${key}`);
  if (value.schema !== packSchema.properties.schema.const || value.advisoryOnly !== true) throw new Error("OUTPUT_SCHEMA_MISMATCH");
}
for (const input of ["fixtures/request.json", "fixtures/native-request.json"]) {
  const value = JSON.parse(fs.readFileSync(path.join(root, input), "utf8"));
  for (const key of requestSchema.required) if (!(key in value)) throw new Error(`REQUEST_REQUIRED_MISSING:${key}`);
  if (value.schema !== requestSchema.properties.schema.const) throw new Error("REQUEST_SCHEMA_MISMATCH");
}
console.log("schema-check: PASS");
