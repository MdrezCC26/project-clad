import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { resolvePublicAppOrigin } from "./publicAppOrigin";

/**
 * App proxy pages are not hydrated by React, so all of their interactivity comes from plain
 * browser scripts. Those used to be inlined into every HTML response (~132KB), which is
 * re-sent on every navigation and every post-mutation reload and can never be cached.
 *
 * They now live as real files under `app/client-scripts/` and are served verbatim by
 * `routes/project-clad-script.$name.tsx` from the **app** origin with an immutable
 * `Cache-Control`, keyed by a `?v=<content hash>` so an edit produces a new URL.
 *
 * The files are read once and reused. Sources are stat'd per request (microseconds) so editing
 * one in dev produces a new hash, a new URL, and an immediate refetch without a Vite restart.
 *
 * These files are intentionally *not* part of the Vite module graph: nothing imports them, so
 * they are never bundled or transformed. They reach production the same way the CSS under
 * `app/styles/` does — the Dockerfile's `COPY . .` puts the whole `app/` tree in the image.
 */
export const PROJECT_CLAD_SCRIPT_PATHNAME_PREFIX = "/project-clad-script/";

const SCRIPTS_DIR = path.join(process.cwd(), "app", "client-scripts");

/** Allowlist. A name that is not in here is never touched on the filesystem. */
export const PROJECT_CLAD_SCRIPT_NAMES = [
  "pc-banner-dismiss.js",
  "pc-dirty-guard.js",
  "project-main.js",
  "project-customer-search.js",
  "project-page-transitions.js",
  "project-line-image-lightbox.js",
  "project-orders-sort.js",
  "project-po-pdf-upload.js",
  "project-projects-link-nav.js",
  "projects-page-nav.js",
  "projects-filters.js",
  "project-detail-page.js",
] as const;

export type ProjectCladScriptName = (typeof PROJECT_CLAD_SCRIPT_NAMES)[number];

const ALLOWED = new Set<string>(PROJECT_CLAD_SCRIPT_NAMES);

export function isProjectCladScriptName(
  name: string | undefined,
): name is ProjectCladScriptName {
  return typeof name === "string" && ALLOWED.has(name);
}

/**
 * Resolve an allowlisted name to an absolute path, refusing anything that escapes the scripts
 * directory. The allowlist already makes traversal impossible; this is belt-and-braces so a
 * future edit to the list cannot turn into a file-read primitive.
 */
function scriptFilePath(name: ProjectCladScriptName): string {
  const resolved = path.resolve(SCRIPTS_DIR, name);
  const root = path.resolve(SCRIPTS_DIR) + path.sep;
  if (!resolved.startsWith(root)) {
    throw new Error(`Refusing to serve script outside scripts dir: ${name}`);
  }
  return resolved;
}

/** Cheap change detector so a re-read only happens when the file actually changed. */
function sourceStamp(file: string): string {
  try {
    const stat = fs.statSync(file);
    return `${stat.size}:${stat.mtimeMs}`;
  } catch {
    return "missing";
  }
}

export type ProjectCladScript = {
  js: string;
  /** Content hash, used as the `?v=` cache buster so the URL can be cached immutably. */
  hash: string;
};

const cache = new Map<string, ProjectCladScript & { stamp: string }>();

export function getProjectCladScript(
  name: ProjectCladScriptName,
): ProjectCladScript {
  const file = scriptFilePath(name);
  const stamp = sourceStamp(file);
  const hit = cache.get(name);
  if (hit && hit.stamp === stamp) {
    return { js: hit.js, hash: hit.hash };
  }

  const js = fs.readFileSync(file, "utf8");
  const hash = crypto
    .createHash("sha256")
    .update(js)
    .digest("hex")
    .slice(0, 16);

  cache.set(name, { js, hash, stamp });
  return { js, hash };
}

/**
 * Absolute URL to a proxy script on the app origin. Absolute because the surrounding HTML is
 * served from the shop's origin, where a relative path would 404.
 */
export function projectCladScriptSrc(
  request: Request,
  name: ProjectCladScriptName,
): string {
  const { hash } = getProjectCladScript(name);

  let origin = resolvePublicAppOrigin();
  if (!origin) {
    try {
      origin = new URL(request.url).origin;
    } catch {
      origin = "";
    }
  }

  return `${origin}${PROJECT_CLAD_SCRIPT_PATHNAME_PREFIX}${name}?v=${hash}`;
}

/**
 * The few per-request values the extracted scripts need. Emitted as a tiny inline script
 * immediately before the external one, which keeps the 112KB body static and cacheable.
 *
 * `</` is escaped so a value can never terminate the surrounding `<script>` element, and
 * U+2028/U+2029 are escaped because they are valid JSON but illegal in JS string literals.
 */
export function projectCladInlineConfigScript(
  config: Record<string, string>,
): string {
  const json = JSON.stringify(config)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return `window.__PROJECT_CLAD__=${json};`;
}
