"""
Fill "Image Src" in your product CSV from files already uploaded to Shopify (Content > Files).

Uses the Admin GraphQL API — one run, no copy/paste per image (no --mapping).

Setup (once) — follow in order:
  1. Shopify Admin → Settings → Apps and sales channels → Develop apps → Allow custom app development (if asked).
  2. Create an app → open it → Configuration → Admin API integration → Configure.
  3. Under Admin API access scopes, enable **read_files** → Save.
  4. **Install app** on your store (Install app button). Scopes apply only after install.
  5. API credentials → **Reveal token once** → copy **Admin API access token** (starts with shpat_).
     Do not use the Storefront API token, API key from old private apps, or theme app extensions token.

Credentials (pick one):
  A) Copy .env.example to .env next to this script; set SHOPIFY_STORE and SHOPIFY_ADMIN_TOKEN.
  B) PowerShell for this session only:
       $env:SHOPIFY_STORE = "your-store.myshopify.com"
       $env:SHOPIFY_ADMIN_TOKEN = "shpat_...."

Test token before the full run:
  python fill_image_src_from_shopify_files.py --verify

Run (fills Image Src from Files):
  python fill_image_src_from_shopify_files.py --csv "C:\\Users\\...\\products_export.csv" --in-place

Optional: --out, --in-place, --only-empty, --api-version 2025-01

Fallback without API: --mapping part_urls.csv (two columns: part, URL).
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import os
import re
import shutil
import sys
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import unquote, urlparse

_SCRIPT_DIR = Path(__file__).resolve().parent
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

from fix_shopify_product_csv import detect_delimiter, read_text_with_encoding

ZBAR_HANDLE_RE = re.compile(r"^z\d{7}$", re.IGNORECASE)


def load_env_file(path: Path) -> None:
    if not path.is_file():
        return
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return
    for line in text.splitlines():
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        if "=" not in s:
            continue
        key, _, val = s.partition("=")
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key and val and key not in os.environ:
            os.environ[key] = val


def normalize_store(store: str) -> str:
    s = (store or "").strip().lower()
    s = s.replace("https://", "").replace("http://", "")
    s = s.split("/")[0].split("?")[0]
    return s.rstrip(".").rstrip("/")


def verify_shopify_files_access(store: str, token: str, api_version: str) -> tuple[bool, str]:
    """Single GraphQL call to confirm token + read_files."""
    store = normalize_store(store)
    endpoint = f"https://{store}/admin/api/{api_version}/graphql.json"
    q = "query { files(first: 1) { edges { node { __typename } } } }"
    body = json.dumps({"query": q}).encode()
    req = urllib.request.Request(endpoint, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("X-Shopify-Access-Token", token)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        err = e.read().decode() if e.fp else str(e)
        if e.code == 401:
            return (
                False,
                "401 Unauthorized — token rejected.\n"
                "  - Copy Admin API access token again (no spaces/quotes).\n"
                "  - Token is shown only once after Install app; create a new custom app if you lost it.\n"
                "  - Store must be exactly: yourstore.myshopify.com\n"
                f"  Raw: {err[:500]}",
            )
        if e.code == 403:
            return (
                False,
                "403 Forbidden — token cannot use Admin API for this shop.\n"
                "  - Enable Admin scope **read_files**, Save, then click **Install app** again.\n"
                f"  Raw: {err[:500]}",
            )
        return False, f"HTTP {e.code}: {err[:800]}"

    if "errors" in data and data["errors"]:
        return False, "GraphQL errors:\n" + json.dumps(data["errors"], indent=2)
    return True, f"OK — Admin API + files query works on {store!r} (API {api_version})."


FILES_QUERY = """
query FilesPage($first: Int!, $after: String) {
  files(first: $first, after: $after) {
    pageInfo {
      hasNextPage
      endCursor
    }
    edges {
      cursor
      node {
        __typename
        ... on GenericFile {
          url
        }
        ... on MediaImage {
          image {
            url
          }
        }
      }
    }
  }
}
"""


def stem_from_file_url(url: str) -> str | None:
    if not url or not url.startswith("http"):
        return None
    path = urlparse(url).path
    name = unquote(path.rsplit("/", 1)[-1]) if path else ""
    if not name or "." not in name:
        return None
    stem = Path(name).stem.strip()
    if " - " in stem:
        stem = stem.split(" - ", 1)[0].strip()
    if re.match(r"^Z\d{7}$", stem, re.I):
        return stem.upper()
    return None


def url_from_node(node: dict) -> str | None:
    if not node:
        return None
    t = node.get("__typename")
    if t == "GenericFile":
        return node.get("url")
    if t == "MediaImage":
        img = node.get("image") or {}
        u = img.get("url")
        if u:
            return u
        return node.get("url")
    return None


def fetch_all_file_stem_to_url(store: str, token: str, api_version: str = "2025-01") -> dict[str, str]:
    store = normalize_store(store)
    endpoint = f"https://{store}/admin/api/{api_version}/graphql.json"
    stem_to_url: dict[str, str] = {}
    after: str | None = None
    page = 0
    while True:
        body = json.dumps(
            {
                "query": FILES_QUERY,
                "variables": {"first": 250, "after": after},
            }
        ).encode()
        req = urllib.request.Request(endpoint, data=body, method="POST")
        req.add_header("Content-Type", "application/json")
        req.add_header("X-Shopify-Access-Token", token)
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                data = json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            err = e.read().decode() if e.fp else str(e)
            hint = ""
            if e.code == 401:
                hint = (
                    "\n  401 fixes: use Admin API access token from Settings > Apps > Develop apps > "
                    "your app > Install app (not Storefront token). Store = name.myshopify.com only. "
                    "Enable scope: read_files. Install app after saving scopes."
                )
            raise RuntimeError(f"HTTP {e.code}: {err}{hint}") from e

        if "errors" in data and data["errors"]:
            raise RuntimeError(json.dumps(data["errors"], indent=2))

        payload = data.get("data") or {}
        conn = payload.get("files") or {}
        edges = conn.get("edges") or []
        for edge in edges:
            node = (edge or {}).get("node") or {}
            u = url_from_node(node)
            if not u:
                continue
            stem = stem_from_file_url(u)
            if stem:
                stem_to_url[stem] = u

        pi = conn.get("pageInfo") or {}
        if not pi.get("hasNextPage"):
            break
        after = pi.get("endCursor")
        if not after:
            break
        page += 1
        if page > 200:
            raise RuntimeError("Stopped after 200 pages (safety limit).")

    return stem_to_url


def _mapping_delimiter(line0: str) -> str:
    if not line0:
        return ","
    sc = line0.count(";")
    cc = line0.count(",")
    tc = line0.count("\t")
    if tc >= sc and tc >= cc and tc >= 2:
        return "\t"
    if sc > cc:
        return ";"
    return ","


def _normalize_mapping_url(s: str) -> str | None:
    u = (s or "").strip().strip('"').replace("\ufeff", "")
    if not u:
        return None
    if u.startswith("="):
        u = u.lstrip("=")
        hm = re.search(r'HYPERLINK\s*\(\s*"([^"]+)"', u, re.I)
        if hm:
            return _normalize_mapping_url(hm.group(1))
        u = u.strip().strip('"')
    u = u.replace(" ", "")
    if not u:
        return None
    if "cdn.shopify.com" in u:
        if not u.startswith("http"):
            u = "https://" + u.lstrip("/")
        return u
    if u.startswith("http://") or u.startswith("https://"):
        return u
    return None


def _part_key_from_cell(c: str) -> str | None:
    a = (c or "").strip().strip('"').replace("\ufeff", "")
    if re.match(r"^z\d{7}$", a, re.I):
        return "Z" + a[1:].upper()
    if re.match(r"^Z\d{7}$", a, re.I):
        return "Z" + a[1:].upper()
    return None


def load_mapping_csv(path: Path, encoding: str | None) -> tuple[dict[str, str], str]:
    """Return (stem_to_url, delimiter_used)."""
    raw, _ = read_text_with_encoding(path, encoding)
    lines = raw.splitlines()
    if not lines:
        return {}, ","
    delim = _mapping_delimiter(lines[0])
    rows = list(csv.reader(io.StringIO(raw), delimiter=delim))
    out: dict[str, str] = {}
    for row in rows:
        if not row or not any((x or "").strip() for x in row):
            continue
        joined_lower = ",".join(x.lower() for x in row if x)
        if re.search(r"\b(part|url|handle)\b", joined_lower) and not any(
            _part_key_from_cell(x) for x in row
        ):
            continue
        part_key = None
        url_val = None
        for cell in row:
            pk = _part_key_from_cell(cell)
            if pk:
                part_key = pk
            nu = _normalize_mapping_url(cell)
            if nu:
                url_val = nu
        if part_key and url_val:
            out[part_key] = url_val
    return out, delim


def print_mapping_file_preview(path: Path) -> None:
    """Show first lines as saved on disk (Excel often leaves column B empty)."""
    try:
        text = path.read_text(encoding="utf-8-sig")
    except UnicodeDecodeError:
        text = path.read_text(encoding="cp1252", errors="replace")
    lines = text.splitlines()[:8]
    print("Your file on disk starts like this (see if anything appears AFTER the comma):", file=sys.stderr)
    for i, ln in enumerate(lines, 1):
        tail = ln if len(ln) <= 120 else ln[:117] + "..."
        print(f"  {i}: {tail}", file=sys.stderr)
    https_lines = sum(
        1
        for ln in text.splitlines()[1:]
        if ("http" in ln.lower() or "cdn.shopify" in ln.lower())
        and "part,url" not in ln.lower()
    )
    print(
        f"Lines (excl. header) containing 'http' or 'cdn.shopify': {https_lines}",
        file=sys.stderr,
    )


def normalize_part_key(handle: str, sku: str) -> str | None:
    sku = (sku or "").strip()
    if sku and re.match(r"^Z\d{7}$", sku, re.I):
        return "Z" + sku[1:].upper()
    h = (handle or "").strip()
    if ZBAR_HANDLE_RE.match(h):
        return "Z" + h[1:].upper()
    return None


def main() -> int:
    load_env_file(_SCRIPT_DIR / ".env")

    ap = argparse.ArgumentParser(description="Fill Image Src from Shopify Files API or mapping CSV")
    ap.add_argument(
        "--csv",
        type=Path,
        default=None,
        help="Product export CSV (Handle, Image Src, ...). Not needed with --verify only.",
    )
    ap.add_argument("--out", type=Path, default=None, help="Output CSV path")
    ap.add_argument("--in-place", action="store_true", help="Overwrite --csv (creates .bak)")
    ap.add_argument("--only-empty", action="store_true", help="Only fill blank Image Src cells")
    ap.add_argument("--mapping", type=Path, default=None, help="Two-column CSV: part,url (skip API)")
    ap.add_argument(
        "--force-without-urls",
        action="store_true",
        help="Allow --in-place even when mapping has zero usable URLs (normally blocked)",
    )
    ap.add_argument("--encoding", default=None, metavar="ENC")
    ap.add_argument(
        "--api-version",
        default="2025-01",
        help="Admin API version segment (default 2025-01)",
    )
    ap.add_argument(
        "--verify",
        action="store_true",
        help="Only test SHOPIFY_STORE + SHOPIFY_ADMIN_TOKEN + read_files (no CSV changes)",
    )
    args = ap.parse_args()

    store = os.environ.get("SHOPIFY_STORE", "").strip()
    token = os.environ.get("SHOPIFY_ADMIN_TOKEN", "").strip().strip('"').strip("'")

    if args.verify:
        if not store or not token:
            print(
                "Set SHOPIFY_STORE and SHOPIFY_ADMIN_TOKEN (env or .env next to this script).",
                file=sys.stderr,
            )
            print(f"  Expected .env path: {_SCRIPT_DIR / '.env'}", file=sys.stderr)
            return 1
        if "paste_your" in token.lower() or ("xxxx" in token.lower() and len(token) < 40):
            print("Replace placeholder token in .env with the real shpat_... value.", file=sys.stderr)
            return 1
        ok, msg = verify_shopify_files_access(store, token, args.api_version)
        print(msg)
        if not ok:
            print(
                "\nSetup: https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/generate-app-access-tokens-admin",
                file=sys.stderr,
            )
        return 0 if ok else 1

    csv_path = args.csv
    if csv_path is None:
        print("--csv is required (or use --verify to test the token only).", file=sys.stderr)
        return 1
    if not csv_path.is_file():
        print(f"CSV not found: {csv_path}", file=sys.stderr)
        return 1

    if args.mapping is not None:
        if not args.mapping.is_file():
            print(f"Mapping not found: {args.mapping}", file=sys.stderr)
            print(
                "Create it with: python scripts/shopify/generate_part_urls_template.py",
                file=sys.stderr,
            )
            print(
                "  (writes Desktop\\\\part_urls.csv — Part + empty URL column; paste URLs in Excel.)",
                file=sys.stderr,
            )
            return 1
        stem_to_url, map_delim = load_mapping_csv(args.mapping, args.encoding)
        print(
            f"Loaded {len(stem_to_url)} URL(s) from {args.mapping} (delimiter {map_delim!r})"
        )
        if len(stem_to_url) == 0:
            print(
                "No rows had BOTH a Z######## part in one column AND a full https://... "
                "Shopify CDN URL in another.",
                file=sys.stderr,
            )
            print_mapping_file_preview(args.mapping)
            print("", file=sys.stderr)
            print(
                "If lines look like 'Z1600750,' with NOTHING after the comma, column B is still empty.",
                file=sys.stderr,
            )
            print(
                "  1) Paste each file URL into column B (URL), 2) File > Save As > CSV UTF-8 (or CSV).",
                file=sys.stderr,
            )
            print(
                "  Do not leave the workbook as .xlsx only; the script reads part_urls.csv on disk.",
                file=sys.stderr,
            )
            print(
                "  Or fix Admin API token and run without --mapping to pull URLs from Shopify automatically.",
                file=sys.stderr,
            )
            if not args.force_without_urls:
                print(
                    "Aborting. Use --force-without-urls only if you intend to write without image URLs.",
                    file=sys.stderr,
                )
                return 1
    else:
        if not store or not token:
            print(
                "Set SHOPIFY_STORE and SHOPIFY_ADMIN_TOKEN in .env or environment, or use --mapping.",
                file=sys.stderr,
            )
            print(f"  Tip: copy scripts/shopify/.env.example to {_SCRIPT_DIR / '.env'}", file=sys.stderr)
            return 1
        if "paste_your" in token.lower() or ("xxxx" in token.lower() and len(token) < 40):
            print(
                "SHOPIFY_ADMIN_TOKEN still looks like a placeholder. Paste the real shpat_... token.",
                file=sys.stderr,
            )
            return 1
        if len(token) < 32:
            print("SHOPIFY_ADMIN_TOKEN looks too short; Admin tokens are usually ~38+ characters.", file=sys.stderr)
            return 1
        ok, vmsg = verify_shopify_files_access(store, token, args.api_version)
        if not ok:
            print(vmsg, file=sys.stderr)
            return 1
        print(vmsg)
        print("Fetching full file list from Shopify (GraphQL)...")
        try:
            stem_to_url = fetch_all_file_stem_to_url(store, token, args.api_version)
        except Exception as e:
            print(f"API error: {e}", file=sys.stderr)
            return 1
        print(f"Found {len(stem_to_url)} image file(s) with Z########-style names.")

    raw, _ = read_text_with_encoding(csv_path, args.encoding)
    delim = detect_delimiter(raw.splitlines()[0])
    rows = list(csv.reader(io.StringIO(raw), delimiter=delim))
    if not rows or (rows[0][0] or "").strip() != "Handle":
        print("CSV must start with Handle header.", file=sys.stderr)
        return 1

    header = rows[0]
    col = {n: i for i, n in enumerate(header)}
    if "Image Src" not in col:
        print('CSV has no "Image Src" column.', file=sys.stderr)
        return 1
    sku_col = col.get("Variant SKU")

    filled = 0
    skipped_has_url = 0
    missing = 0
    ncols = len(header)

    for row in rows[1:]:
        while len(row) < ncols:
            row.append("")
        row = row[:ncols]
        isrc = col["Image Src"]
        cur = (row[isrc] or "").strip()
        if args.only_empty and cur:
            skipped_has_url += 1
            continue

        handle = (row[col["Handle"]] or "").strip()
        sku = (row[sku_col] or "").strip() if sku_col is not None else ""
        key = normalize_part_key(handle, sku)
        if not key:
            continue
        url = stem_to_url.get(key)
        if not url:
            if ZBAR_HANDLE_RE.match(handle) or (sku and re.match(r"^Z\d{7}$", sku, re.I)):
                missing += 1
            continue
        row[isrc] = url
        filled += 1

    if args.in_place:
        out_path = csv_path
        bak = csv_path.with_suffix(csv_path.suffix + ".bak")
        shutil.copy2(csv_path, bak)
        print(f"Backup: {bak}")
    elif args.out:
        out_path = args.out
    else:
        out_path = csv_path.with_name(csv_path.stem + "_with_images.csv")

    with out_path.open("w", newline="", encoding="utf-8-sig") as f:
        csv.writer(f, quoting=csv.QUOTE_MINIMAL).writerows(rows)

    print(f"Wrote: {out_path}")
    print(f"Image Src filled: {filled}")
    if args.only_empty and skipped_has_url:
        print(f"Skipped (already had image): {skipped_has_url}")
    print(f"Z-bar rows with no matching file in Shopify: {missing}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
