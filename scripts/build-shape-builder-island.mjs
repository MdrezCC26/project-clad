import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const esbuild = require("esbuild");
const root = process.cwd();
const outfile = path.join(root, "app", "islands", "dist", "shape-builder.js");
fs.mkdirSync(path.dirname(outfile), { recursive: true });
esbuild.buildSync({
  absWorkingDir: root,
  entryPoints: [path.join(root, "app", "islands", "shape-builder-entry.tsx")],
  bundle: true,
  format: "iife",
  outfile,
  jsx: "automatic",
  jsxImportSource: "react",
  platform: "browser",
  target: "es2020",
  minify: true,
  logLevel: "info",
});
console.log(`wrote ${outfile}`);
