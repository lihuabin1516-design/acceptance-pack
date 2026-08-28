import { readFile } from "node:fs/promises";
import { composeRequest, explainPack, validatePack, validateRequest, writePackAtomic } from "./index";

async function main() {
  const [command, input, rootFlag, root, outputFlag, output] = process.argv.slice(2);
  if (!input || rootFlag !== "--root" || !root || (command === "compose" && (outputFlag !== "--output" || !output))) throw new Error("INVALID_REQUEST");
  const value = JSON.parse(await readFile(input, "utf8"));
  if (command === "validate-request") {
    if (!validateRequest(value)) throw new Error("INVALID_REQUEST");
    console.log(JSON.stringify({ valid: true }));
  } else if (command === "compose") {
    const pack = await composeRequest(value, root);
    await writePackAtomic(output, pack, root);
    console.log(JSON.stringify(pack));
  } else if (command === "validate") {
    if (!validatePack(value)) throw new Error("INVALID_PACK");
    console.log(JSON.stringify({ valid: true }));
  } else if (command === "explain") {
    if (!validatePack(value)) throw new Error("INVALID_PACK");
    process.stdout.write(explainPack(value));
  } else throw new Error("INVALID_REQUEST");
}

main().catch(error => { console.error(error instanceof Error ? error.message : "UNKNOWN_ERROR"); process.exitCode = 1; });
