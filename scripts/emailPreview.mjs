// Renders the Couranr email gallery to static HTML for visual review.
// Usage: node scripts/emailPreview.mjs [--out <dir>]
// Nothing is sent. The real logo PNGs are inlined as data-URIs so the gallery
// shows the actual brand mark in a browser (shipped emails use hosted URLs).

import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { fileURLToPath, pathToFileURL } from "url";
import path from "path";
import os from "os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const emailDir = path.join(root, "lib", "couranr", "email");

// output dir: --out <dir>, or $EMAIL_PREVIEW_OUT, or repo-local .email-preview
const outArgIdx = process.argv.indexOf("--out");
const outDir =
  outArgIdx !== -1 && process.argv[outArgIdx + 1]
    ? path.resolve(process.argv[outArgIdx + 1])
    : process.env.EMAIL_PREVIEW_OUT
    ? path.resolve(process.env.EMAIL_PREVIEW_OUT)
    : path.join(root, ".email-preview");

function dataUri(relFromRoot) {
  const buf = readFileSync(path.join(root, relFromRoot));
  return `data:image/png;base64,${buf.toString("base64")}`;
}

// 1) Bundle the self-contained email subsystem (relative imports only).
const bundled = await build({
  stdin: {
    contents:
      "export { renderGallery, collectEmails } from './preview.ts';\n" +
      "export { defaultEmailConfig } from './theme.ts';",
    resolveDir: emailDir,
    loader: "ts",
    sourcefile: "preview-entry.ts",
  },
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  write: false,
});

const tmpFile = path.join(os.tmpdir(), `couranr-email-preview-${process.pid}.mjs`);
writeFileSync(tmpFile, bundled.outputFiles[0].text, "utf8");
const mod = await import(pathToFileURL(tmpFile).href);

// 2) Config with the real logo inlined so the browser preview shows it.
const config = {
  ...mod.defaultEmailConfig,
  assets: {
    logoLightUrl: dataUri("public/brand/couranr-logo-primary@800.png"),
    logoDarkUrl: dataUri("public/brand/couranr-logo-reverse@800.png"),
    iconUrl: dataUri("public/brand/couranr-app-icon-256.png"),
  },
};

// 3) Write the gallery + one file per email.
mkdirSync(path.join(outDir, "emails"), { recursive: true });
const gallery = mod.renderGallery(config);
writeFileSync(path.join(outDir, "index.html"), gallery, "utf8");

const entries = mod.collectEmails(config);
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
for (const e of entries) {
  writeFileSync(path.join(outDir, "emails", `${slug(e.group)}--${slug(e.title)}.html`), e.html, "utf8");
}

console.log(`Rendered ${entries.length} emails`);
console.log(`Gallery:  ${path.join(outDir, "index.html")}`);
console.log(`Singles:  ${path.join(outDir, "emails")}/`);
