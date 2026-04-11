import fs from "node:fs";

const path = "dist/index.html";
let html;
try {
  html = fs.readFileSync(path, "utf8");
} catch {
  console.error(`verify-dist: missing ${path} — run npm run build first`);
  process.exit(1);
}

// Only inspect real <script src="..."> tags — comments in index.html may mention "src" and must not fail the build.
const scriptSrcs = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)].map(
  (m) => m[1],
);

if (scriptSrcs.length === 0) {
  console.error("verify-dist: no <script src=...> found in dist/index.html");
  process.exit(1);
}

for (const src of scriptSrcs) {
  if (src.includes("/src/") || src.endsWith(".tsx") || src.endsWith("/main.tsx")) {
    console.error(
      `verify-dist: a script still points at the dev entry (${src}) — Vite did not transform HTML.`,
    );
    process.exit(1);
  }
}

const hasBundle =
  scriptSrcs.some((s) => s.includes("/assets/")) ||
  scriptSrcs.some((s) => s.includes("./assets/"));

if (!hasBundle) {
  console.error(
    "verify-dist: no Vite bundle under assets/ in script src — check vite build output.",
  );
  process.exit(1);
}

console.log("verify-dist: dist/index.html looks like a production Vite build.");
