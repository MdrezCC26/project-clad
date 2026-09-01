import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { resolvePublicAppOrigin } from "./publicAppOrigin";

/** Same `/project-clad-script/*` prefix as other proxy scripts so Vite does not intercept `.js` URLs. */
export const SHAPE_BUILDER_ISLAND_PATHNAME =
  "/project-clad-script/shape-builder-island.js";

const OUTFILE = path.join(process.cwd(), "app", "islands", "dist", "shape-builder.js");
const ENTRY = path.join(process.cwd(), "app", "islands", "shape-builder-entry.tsx");

const SOURCE_FILES = [
  ENTRY,
  path.join(process.cwd(), "app", "components", "shape-builder", "ShapeBuilder.jsx"),
  path.join(process.cwd(), "app", "utils", "shapeProfile.ts"),
];

function stamp(): string {
  return SOURCE_FILES.map((file) => {
    try {
      const s = fs.statSync(file);
      return `${s.size}:${s.mtimeMs}`;
    } catch {
      return "missing";
    }
  }).join("|");
}

let cached: { js: string; hash: string; stamp: string } | null = null;

function hashOf(js: string): string {
  return crypto.createHash("sha256").update(js).digest("hex").slice(0, 16);
}

function readBuiltFile(): string | null {
  try {
    return fs.readFileSync(OUTFILE, "utf8");
  } catch {
    return null;
  }
}

export function buildShapeBuilderIsland(): { js: string; hash: string } {
  const require = createRequire(import.meta.url);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const esbuild = require("esbuild") as typeof import("esbuild");
  fs.mkdirSync(path.dirname(OUTFILE), { recursive: true });
  esbuild.buildSync({
    absWorkingDir: process.cwd(),
    entryPoints: [ENTRY],
    bundle: true,
    format: "iife",
    outfile: OUTFILE,
    jsx: "automatic",
    jsxImportSource: "react",
    platform: "browser",
    target: "es2020",
    minify: true,
    logLevel: "warning",
  });
  const js = fs.readFileSync(OUTFILE, "utf8");
  return { js, hash: hashOf(js) };
}

export function getShapeBuilderIsland(): { js: string; hash: string } {
  const now = stamp();
  if (cached && cached.stamp === now) {
    return { js: cached.js, hash: cached.hash };
  }

  if (process.env.NODE_ENV !== "production") {
    try {
      buildShapeBuilderIsland();
    } catch {
      /* fall through to whatever is already on disk */
    }
  }

  const js = readBuiltFile();
  if (!js) {
    const built = buildShapeBuilderIsland();
    cached = { ...built, stamp: now };
    return built;
  }

  const built = { js, hash: hashOf(js) };
  cached = { ...built, stamp: now };
  return built;
}

export function shapeBuilderIslandSrc(request: Request): string {
  const { hash } = getShapeBuilderIsland();
  let origin = resolvePublicAppOrigin();
  if (!origin) {
    try {
      origin = new URL(request.url).origin;
    } catch {
      origin = "";
    }
  }
  return `${origin}${SHAPE_BUILDER_ISLAND_PATHNAME}?v=${hash}`;
}
