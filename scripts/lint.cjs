const fs = require("node:fs");
const path = require("node:path");
let failed = false;
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory() && !["node_modules", "dist", "out"].includes(entry.name)) walk(file);
    else if (entry.isFile() && /\.(ts|json|md|cjs)$/.test(entry.name)) {
      const text = fs.readFileSync(file, "utf8");
      const forbidden = ["TO", "DO"].join("") + "|" + ["T", "B", "D"].join("") + "|" + ["replace", "-", "with"].join("");
      if (!text.endsWith("\n") || /[ \t]+$/m.test(text) || new RegExp(forbidden).test(text)) { console.error(`lint:${file}`); failed = true; }
    }
  }
}
walk(process.cwd());
process.exit(failed ? 1 : 0);
