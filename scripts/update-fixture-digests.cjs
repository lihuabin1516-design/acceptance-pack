const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const root = process.cwd();
for (const requestName of ["request.json", "native-request.json"]) {
  const requestPath = path.join(root, "fixtures", requestName);
  const request = JSON.parse(fs.readFileSync(requestPath, "utf8"));
  for (const source of request.sources) {
    const bytes = fs.readFileSync(path.join(root, source.path));
    source.sha256 = `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
  }
  fs.writeFileSync(requestPath, `${JSON.stringify(request, null, 2)}\n`);
}
