import fs from "node:fs";

const path = "dist/index.html";
let html;
try {
  html = fs.readFileSync(path, "utf8");
} catch {
  console.error(`verify-dist: missing ${path} — run npm run build first`);
  process.exit(1);
}

if (html.includes("/src/main") || html.includes("/src/")) {
  console.error(
    "verify-dist: dist/index.html still references /src/ — Vite did not transform the entry. Fix the build.",
  );
  process.exit(1);
}

if (!html.includes("/assets/")) {
  console.error(
    "verify-dist: dist/index.html has no /assets/ bundle reference — build output looks wrong.",
  );
  process.exit(1);
}

console.log("verify-dist: dist/index.html looks like a production Vite build.");
