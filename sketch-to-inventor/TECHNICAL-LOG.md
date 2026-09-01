# sketch-to-inventor — technical / experiment log

**Written:** 24 Aug 2026  
**Purpose:** Dated record for continued work and for scoping an SR&ED claim window. This is an engineering log, not a tax opinion. Confirm fiscal year-end and claim eligibility with the company’s accountant / SR&ED preparer.

Related legal entity in repo copy: **11921029 Canada Inc.** (Project Clad). Fiscal year-end is **not in this repository**.

---

## 1. Project period (code + chats)

| Bound | Date | Evidence |
|--------|------|----------|
| Start | **21 Apr 2026** | Git `8d1e2de` (22:22 ET) adds `sketch-to-inventor/`. Same-day Cursor session on the Micha clone built the folder from one order-form photo. |
| Related same week | **27 Apr 2026** | Git `ce4c947` adds `scripts/inventor-automation-staging/` (parametric template generator; not the Vision CLI). |
| Production isolation noted | **13 Aug 2026** | Privacy / subprocessor review: Vision CLI is local-only; storefront drawing jobs stay numbers-only; no OpenAI on uploads. |
| This reconstruction | **24 Aug 2026** | Chat reconstruction of history; **this file**. |

**Suggested SR&ED window for this CLI:** 21 Apr 2026 → ongoing, for as long as you keep systematically trying to get Vision extraction + Inventor COM construction working.

**Related Inventor work (same shop problem, different code path — do not lump blindly):**

- Mar–early Apr 2026: `scripts/inventor-worker/` (DrawingJob, L-only COM, iLogic). That is **before** 21 Apr.
- 27 Apr 2026: staging PyQt generator (templates + Test Mode).
- 25 Jun 2026: W-folder wall-area iLogic (Revit import takeoff, not shop drawings).
- 18 Aug 2026 onward: Shape Builder (browser-drawn profile; no Vision).

If the claim is “automatic shop drawings from a hand sketch,” Shape Builder is a **pivot**, not a continuation of the Vision experiment, unless you document it as an alternative approach to the same uncertainty.

---

## 2. What git actually contains in this window

`git log --since=2026-04-21 -- sketch-to-inventor/`

| Commit | Date | Message | What changed |
|--------|------|---------|--------------|
| `8d1e2de` | 21 Apr 2026 | `Describe your release in one short sentence.` | **First and only** add of the CLI (837 lines). Bundled with unrelated storefront work. |

`git log --since=2026-04-21 -- scripts/inventor-automation-staging/`

| Commit | Date | Message | What changed |
|--------|------|---------|--------------|
| `ce4c947` | 27 Apr 2026 | `Release: project storefront, …` | **First and only** add of the PyQt generator. Also a mixed storefront commit. |

There are **no later commits** on either path through 24 Aug 2026. No diffs that say “Contour Flange failed so we changed X.” No Vision prompt iterations. No experiment JSON checked in (`output/` is gitignored).

---

## 3. What broke / what we changed / why — honest status

### Proven (ran and fixed)

| When | Failure | Change | Why |
|------|---------|--------|-----|
| 21 Apr 2026 (build chat) | Dry-run of `sample_input.json` crashed on Windows console encoding (`UnicodeEncodeError` from `→` in print statements). | Replaced Unicode arrows with `->` in `main.py`, `inventor_part.py`, `inventor_drawing.py`. | cp1252 console cannot print those characters. |

That dry-run used **hand-authored JSON**, not GPT-4o. It did **not** open Inventor.

### Designed-for, never demonstrated in the record

These are in the first draft (README + `try/except`), not from a dated failed run:

| Anticipated issue | Code / docs | Ran against real data? |
|-------------------|-------------|------------------------|
| GPT-4o misreads segments / dimensions | `--dry-run`, write `extracted.json`, `--json` to skip Vision | **No.** API key was never used in the build chat. |
| Contour Flange COM fails (API / Inventor version) | Catch exception, still save constrained sketch, print “create flange manually” | **No.** |
| Sheet-metal style / extent / width APIs differ by version | Nested try on thickness, bend radius, `SetSymmetricExtent` vs `Width.Expression` | **No.** |
| Drawing views / retrieve dims / notes fail | Best-effort views; several retrieve-dimension APIs | **No.** |
| Inventor not running / unlicensed | Connect-or-launch; README `pywintypes.com_error` | **No** for this CLI. |

**24 Aug 2026 note:** There is **no** dated log of “Vision got this sketch wrong” or “Contour Flange failed on this segment list.” If you remember a live Inventor or Vision failure that is not in git/chat, add it under §6 with date, input, error text, and what you did.

### Staging generator Test Mode (27 Apr) — not a CAD experiment log

Test Mode logs L1/L2/L3/A1/A2/gauge/length, sleeps 0.3s, always succeeds, **writes no files**, **does not call Inventor**. It exists so the GUI can be used without Inventor. The zip that landed in git had **no `.ipt` / `.idw` templates**. So Test Mode does **not** record what broke in COM or what you changed.

### Why it stayed unwired (13 Aug reconstruction, written 24 Aug)

Not because a logged reliability study failed. Because:

1. Vision + Inventor were never run end-to-end after the prototype.
2. Storefront `DrawingJob` is numbers-only (L/Z/U); this CLI is photo → freeform segments.
3. Wiring Vision to customer uploads would add OpenAI as a subprocessor; privacy work treated that as off unless you actually run it.
4. Later work (Shape Builder) lets the customer draw the profile in the browser instead of photographing a form.

---

## 4. Fiscal year / 18-month filing clock

CRA: an SR&ED claim is generally due **18 months after the end of the tax year** in which the work was done. **Confirm FYE** (T2, articles, or accountant). It is not in this repo.

Until FYE is known, treat **21 Apr 2026** work as belonging to **whichever taxation year contains that date**.

Illustrative only (not a filing instruction):

| If FYE is | Tax year containing 21 Apr 2026 | 18-month claim due (approx.) |
|-----------|----------------------------------|------------------------------|
| 31 Dec | 1 Jan 2026 – 31 Dec 2026 | ~30 Jun 2028 |
| 31 Mar | 1 Apr 2026 – 31 Mar 2027 | ~30 Sep 2028 |
| 30 Apr | 1 May 2025 – 30 Apr 2026 | ~31 Oct 2027 — **tighter**; Apr 21 sits at the end of that year |
| 30 Jun | 1 Jul 2025 – 30 Jun 2026 | ~31 Dec 2027 |

Work **after** FYE (e.g. Aug 2026 Shape Builder, this log, any new Vision/COM trials) belongs to the **next** tax year and a later claim, unless the same project is claimed across years with a consistent technological objective.

**Do next (outside this repo):** ask the accountant “What is 11921029 Canada Inc.’s tax year-end?” then put the date in the first row of §6.

---

## 5. How to capture work from today forward

For every Vision or Inventor trial, add a row in §6 **the same day**. Commit this file (not API keys, not customer photos unless they are sanitised fixtures).

Copy:

```text
### YYYY-MM-DD — <short title>
- Input: photo name / JSON / segment list
- Step: vision | json-only | inventor-part | inventor-drawing
- Result: pass / fail
- Error / bad output: (paste)
- Change made: file + why
- Still uncertain: …
```

Keep `output/extracted.json` locally; paste the **sanitised** JSON (no customer names) into the entry if Vision was wrong.

---

## 6. Experiment log

### 2026-04-21 — initial CLI
- Input: order-form photo (interpreted by eye → `sample_input.json`: 16 ga, Galvanized, right 2″, down 4″, right 4″, length 120″).
- Step: json-only dry-run (no Vision, no Inventor).
- Result: fail then pass (console encoding).
- Change: ASCII `->` in print statements.
- Still uncertain: whether GPT-4o reads real forms; whether Contour Flange COM works on this Inventor version; whether drawings auto-dimension.

### 2026-04-27 — staging generator imported
- Input: `files.zip` (PyQt + COM wrapper). No templates in zip.
- Step: unpack to `scripts/inventor-automation-staging/`. Test Mode = UI only.
- Result: not a Vision/COM trial for sketch-to-inventor.
- Change: none to the CLI.
- Still uncertain: same as 21 Apr.

### 2026-08-13 — production isolation
- Finding: CLI not called from the Shopify app; drawing jobs do not send photos to OpenAI.
- Change: none to the CLI (privacy policy wording only).

### 2026-08-24 — history reconstruction
- Finding: no further CLI commits; no Vision/COM failure log exists.
- Change: this file.
- FYE: **unknown — fill in here:** _______________

<!-- next entries above this line -->
