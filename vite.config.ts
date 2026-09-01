import { reactRouter } from "@react-router/dev/vite";
import { defineConfig, type Plugin, type UserConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { execSync } from "node:child_process";
import { applyHostToShopifyAppUrlFromEnv } from "./app/utils/publicAppOrigin";

// Related: https://github.com/remix-run/remix/issues/2835#issuecomment-1144102176
//
// `shopify app dev` passes the live tunnel URL as HOST (e.g. *.trycloudflare.com).
// Copy it to SHOPIFY_APP_URL once here so the whole Node process (Vite + SSR loaders)
// agrees on the public app origin — signed fulfillment photo links and server.origin match.
applyHostToShopifyAppUrlFromEnv();

const appUrl = process.env.SHOPIFY_APP_URL || "http://localhost";
const host = new URL(appUrl).hostname;

let hmrConfig;
if (host === "localhost") {
  hmrConfig = {
    protocol: "ws",
    host: "localhost",
    port: 64999,
    clientPort: 64999,
  };
} else {
  hmrConfig = {
    protocol: "wss",
    host: host,
    port: parseInt(process.env.FRONTEND_PORT!) || 8002,
    clientPort: 443,
  };
}

export default defineConfig({
  server: {
    origin: appUrl,
    allowedHosts: [host],
    cors: {
      preflightContinue: true,
    },
    port: Number(process.env.PORT || 3000),
    hmr: hmrConfig,
    fs: {
      // See https://vitejs.dev/config/server-options.html#server-fs-allow for more information
      allow: ["app", "node_modules", "src"],
    },
  },
  plugins: [
    {
      name: "shape-builder-island",
      buildStart() {
        execSync("node scripts/build-shape-builder-island.mjs", {
          stdio: "inherit",
        });
        this.addWatchFile("app/islands/shape-builder-entry.tsx");
        this.addWatchFile("app/components/shape-builder/ShapeBuilder.jsx");
        this.addWatchFile("app/utils/shapeProfile.ts");
      },
    } as Plugin,
    {
      name: "fix-app-proxy-forwarded-host",
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          const origin = req.headers.origin;
          let originHost = "";
          if (origin) {
            try {
              originHost = new URL(origin).host;
            } catch {
              originHost = "";
            }
          }

          const forwardedHost =
            originHost ||
            (Array.isArray(req.headers["x-forwarded-host"])
              ? req.headers["x-forwarded-host"][0]
              : req.headers["x-forwarded-host"]) ||
            req.headers.host;

          if (forwardedHost) {
            req.headers["x-forwarded-host"] = forwardedHost;
            req.headers.origin = `https://${forwardedHost}`;
          }

          next();
        });
      },
    } as Plugin,
    reactRouter(),
    tsconfigPaths(),
  ],
  build: {
    assetsInlineLimit: 0,
  },
  optimizeDeps: {
    include: ["@shopify/app-bridge-react"],
  },
}) satisfies UserConfig;
