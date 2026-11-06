/**
 * Clicks the real project-order-note.js in headless Chrome.
 * The storefront project page does not hydrate React, so a button onClick
 * never runs there. This uses the same markup the server renders.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import test from "node:test";

const script = readFileSync(
  new URL("./project-order-note.js", import.meta.url),
  "utf8",
);

const savedNote = [
  "Mike, mockup was good just needs the hem flipped.",
  "",
  "Then send the revised drawing before we cut the next batch.",
  "Keep the return leg at 1 inch.",
  "<script>alert(1)</script>",
].join("\n");

const css = `
  body { margin: 0; background: #e7ebf2; font-family: Inter, system-ui, sans-serif; }
  .tile { display: flex; gap: 12px; background: #eef2f7; padding: 12px; align-items: flex-start; width: min(520px, 100%); box-sizing: border-box; }
  .sketch { width: 120px; height: 200px; background: #fff; border: 1px solid #cbd5e1; flex: 0 0 auto; display: flex; align-items: center; justify-content: center; font-size: 11px; color: #64748b; text-align: center; }
  .title { text-transform: uppercase; font-size: 15px; }
  .sub { margin: 2px 0 8px; font-size: 12px; text-transform: uppercase; opacity: 0.8; }
  .chip { font-size: 0.75rem; letter-spacing: 0.04em; text-transform: uppercase; color: #64748b; }
  .chip span { color: #0f172a; font-weight: 500; }
  .project-clad-order-note-open { appearance: none; margin: 0; padding: 0; border: 0; background: transparent; font-size: 0.75rem; font-weight: 600; color: #0f172a; text-decoration: underline; cursor: pointer; }
  .project-clad-order-note-print { display: none; }
  .project-clad-order-note-dialog { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(15,23,42,.45); box-sizing: border-box; }
  .project-clad-order-note-dialog__panel { width: min(32rem, 100%); max-height: min(80vh, 36rem); display: flex; flex-direction: column; background: #f4f5f6; border-radius: 16px; padding: 14px 16px; box-sizing: border-box; }
  .project-clad-order-note-dialog__header { display: flex; justify-content: space-between; align-items: center; }
  .project-clad-order-note-dialog__header h2 { margin: 0; font-size: 1rem; }
  .project-clad-order-note-dialog__close { width: 2.25rem; height: 2.25rem; border: 0; background: transparent; font-size: 1.35rem; }
  .project-clad-order-note-dialog__body { max-height: min(60vh, 24rem); overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 0.95rem; line-height: 1.45; }
  #empty { position: absolute; left: -9999px; }
`;

function page(): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${css}</style></head><body>
<div class="tile">
  <div class="sketch">uploaded<br>sketch<br>120 × 200</div>
  <div>
    <div class="title">Upload Part</div>
    <div class="sub">Customer-supplied file</div>
    <div class="chip"><b>Gauge</b> <span>26 Gauge</span></div>
    <span class="project-clad-order-note">
      <button type="button" class="project-clad-order-note-open" data-projectclad-order-note-open>View comment</button>
      <p class="project-clad-order-note-print">
        <span class="project-clad-order-note-print__label">Note</span>
        <span data-projectclad-order-note-body></span>
      </p>
    </span>
  </div>
</div>
<button type="button" id="empty" data-projectclad-order-note-open>View comment</button>
<script src="/note.js"></script>
<script>document.querySelector("[data-projectclad-order-note-body]").textContent = ${JSON.stringify(savedNote).replace(/</g, "\\u003c")};</script>
</body></html>`;
}

function chromeBin(): string {
  for (const bin of ["google-chrome", "chromium"]) {
    const found = spawnSyncVersion(bin);
    if (found) return bin;
  }
  throw new Error("Headless Chrome is required to exercise the note dialog");
}

function spawnSyncVersion(bin: string): boolean {
  return spawnSync(bin, ["--version"], { encoding: "utf8" }).status === 0;
}

type Cdp = (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>;

async function withPage(width: number, height: number, run: (cdp: Cdp) => Promise<void>) {
  const server: Server = createServer((req, res) => {
    const body = (req.url || "").startsWith("/note.js") ? script : page();
    const type = (req.url || "").startsWith("/note.js")
      ? "text/javascript; charset=utf-8"
      : "text/html; charset=utf-8";
    res.setHeader("content-type", type);
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("test server did not bind");
  }
  const port = address.port;
  const debugPort = 9400 + (width % 100);
  const bin = chromeBin();
  const chrome: ChildProcess = spawn(
    bin,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=/tmp/chrome-order-note-${process.pid}-${width}`,
      `http://127.0.0.1:${port}/`,
    ],
    { stdio: "ignore" },
  );
  try {
    let list: { type?: string; webSocketDebuggerUrl?: string }[] = [];
    for (let i = 0; i < 40; i += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
        list = (await response.json()) as typeof list;
        if (list.some((item) => item.type === "page" && item.webSocketDebuggerUrl)) break;
      } catch {
        /* chrome is still starting */
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const page = list.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
    if (!page?.webSocketDebuggerUrl) throw new Error("Chrome did not expose a page");
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve());
      ws.addEventListener("error", () => reject(new Error("devtools socket failed")));
    });
    let nextId = 0;
    const pending = new Map<number, (message: { result?: Record<string, unknown>; error?: unknown }) => void>();
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number;
        result?: Record<string, unknown>;
        error?: unknown;
      };
      if (message.id && pending.has(message.id)) {
        pending.get(message.id)?.(message);
        pending.delete(message.id);
      }
    });
    const cdp: Cdp = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, (message) => {
          if (message.error) reject(new Error(JSON.stringify(message.error)));
          else resolve(message.result || {});
        });
        ws.send(JSON.stringify({ id, method, params }));
      });
    await cdp("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 500,
    });
    await cdp("Runtime.evaluate", {
      expression: "document.readyState",
      awaitPromise: true,
      returnByValue: true,
    });
    await run(cdp);
    ws.close();
  } finally {
    chrome.kill();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function evaluate<T>(cdp: Cdp, expression: string): Promise<T> {
  const result = await cdp("Runtime.evaluate", {
    expression,
    returnByValue: true,
  });
  const remote = result as { result?: { value?: T } };
  return remote.result?.value as T;
}

test("clicking View comment opens, closes, and restores the saved note", async () => {
  await withPage(1100, 700, async (cdp) => {
    for (let i = 0; i < 30; i += 1) {
      const ready = await evaluate<boolean>(
        cdp,
        `!!document.querySelector("[data-projectclad-order-note-body]") && !!window.__projectCladOrderNote`,
      );
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const opened = await evaluate<{
      open: boolean;
      text: string;
      html: string;
      focus: string;
      scroll: string;
    }>(
      cdp,
      `(() => {
        document.querySelector("#empty") && document.getElementById("empty");
        document.querySelector(".project-clad-order-note-open").click();
        var dialog = document.querySelector("[role='dialog']");
        var node = dialog && dialog.querySelector(".project-clad-order-note-dialog__body");
        return {
          open: !!dialog,
          text: node ? node.textContent : "",
          html: node ? node.innerHTML : "",
          focus: document.activeElement ? document.activeElement.getAttribute("aria-label") : "",
          scroll: document.body.style.overflow
        };
      })()`,
    );
    if (!opened.open) {
      const debug = await evaluate<string>(
        cdp,
        `JSON.stringify({
          flag: !!window.__projectCladOrderNote,
          buttons: document.querySelectorAll("[data-projectclad-order-note-open]").length,
          body: (document.body && document.body.innerText || "").slice(0, 300)
        })`,
      );
      assert.fail(debug);
    }
    assert.equal(opened.open, true);
    assert.equal(opened.text, savedNote);
    assert.equal(opened.focus, "Close");
    assert.equal(opened.scroll, "hidden");
    assert.match(opened.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.doesNotMatch(opened.html, /<script>/);

    const shot = await cdp("Page.captureScreenshot", { format: "png" });
    writeFileSync(
      "/opt/cursor/artifacts/view-comment-real-desktop.png",
      Buffer.from(String((shot as { data?: string }).data || ""), "base64"),
    );

    const afterClose = await evaluate<{
      button: boolean;
      escape: boolean;
      outside: boolean;
      again: boolean;
      focusBack: boolean;
      tabWrapped: boolean;
    }>(
      cdp,
      `(() => {
        var btn = document.querySelector(".project-clad-order-note .project-clad-order-note-open");
        var body = document.querySelector(".project-clad-order-note-dialog__body");
        body.focus();
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
        var tabWrapped = document.activeElement === document.querySelector(".project-clad-order-note-dialog__close");
        document.querySelector(".project-clad-order-note-dialog__close").click();
        var button = !document.querySelector("[role='dialog']") && document.activeElement === btn;
        btn.click();
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        var escapeClosed = !document.querySelector("[role='dialog']");
        btn.click();
        document.querySelector(".project-clad-order-note-dialog").dispatchEvent(new MouseEvent("click", { bubbles: true }));
        var outside = !document.querySelector("[role='dialog']");
        btn.click();
        var again = !!document.querySelector("[role='dialog']") && document.querySelector(".project-clad-order-note-dialog__body").textContent === ${JSON.stringify(savedNote)};
        return { button: button, escape: escapeClosed, outside: outside, again: again, focusBack: button, tabWrapped: tabWrapped };
      })()`,
    );
    assert.equal(afterClose.tabWrapped, true);
    assert.equal(afterClose.button, true);
    assert.equal(afterClose.focusBack, true);
    assert.equal(afterClose.escape, true);
    assert.equal(afterClose.outside, true);
    assert.equal(afterClose.again, true);
  });

  await withPage(390, 800, async (cdp) => {
    await evaluate(
      cdp,
      `document.querySelector(".project-clad-order-note-open").click()`,
    );
    const open = await evaluate<boolean>(
      cdp,
      `!!document.querySelector("[role='dialog']")`,
    );
    assert.equal(open, true);
    const shot = await cdp("Page.captureScreenshot", { format: "png" });
    writeFileSync(
      "/opt/cursor/artifacts/view-comment-real-mobile.png",
      Buffer.from(String((shot as { data?: string }).data || ""), "base64"),
    );
  });
});
