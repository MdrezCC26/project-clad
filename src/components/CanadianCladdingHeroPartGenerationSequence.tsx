import "../styles/hero.css";

/**
 * Synthwave-style hero: grid horizon, part outline cycle, left copy.
 * Markup and CSS class names match `canadian_cladding_hero_part_generation_sequence.html`.
 */
export function CanadianCladdingHeroPartGenerationSequence() {
  return (
    <div
      style={{
        position: "relative",
        background: "#15171B",
        overflow: "hidden",
        height: 560,
        width: "100%",
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      }}
    >
      {/* Stars */}
      <div className="cc-stars">
        <div className="cc-star" style={{ top: "18%", left: "8%", animationDelay: "0.0s" }} />
        <div className="cc-star" style={{ top: "30%", left: "22%", animationDelay: "0.7s" }} />
        <div className="cc-star" style={{ top: "12%", left: "38%", animationDelay: "1.4s" }} />
        <div className="cc-star" style={{ top: "25%", left: "54%", animationDelay: "2.1s" }} />
        <div className="cc-star" style={{ top: "8%", left: "70%", animationDelay: "0.4s" }} />
        <div className="cc-star" style={{ top: "32%", left: "84%", animationDelay: "1.8s" }} />
        <div className="cc-star" style={{ top: "20%", left: "92%", animationDelay: "0.9s" }} />
        <div className="cc-star" style={{ top: "6%", left: "16%", animationDelay: "2.4s" }} />
        <div className="cc-star" style={{ top: "38%", left: "46%", animationDelay: "1.1s" }} />
      </div>

      {/* Beams */}
      <div className="cc-beam cc-beam-1" />
      <div className="cc-beam cc-beam-2" />
      <div className="cc-beam cc-beam-3" />
      <div className="cc-beam cc-beam-4" />

      {/* Horizon glow + line */}
      <div className="cc-horizon-glow" />
      <div className="cc-horizon" />

      {/* FULL-WIDTH grid */}
      <div className="cc-grid-stage">
        <div className="cc-grid" />
      </div>

      {/* RIGHT-SIDE generation stage */}
      <div className="cc-parts-stage">
        {/* SHAPE 1 — Z-BAR */}
        <div className="cc-shape cc-shape-1">
          <svg viewBox="0 0 280 200" preserveAspectRatio="xMidYMid meet">
            <path d="M 200 65 L 110 65 L 110 145 L 40 145" />
            <path d="M 200 65 L 235 43" />
            <path d="M 110 65 L 145 43" />
            <path d="M 110 145 L 145 123" />
            <path d="M 40 145 L 75 123" />
            <path d="M 235 43 L 145 43 L 145 123 L 75 123" />
            <path className="accent" d="M 110 75 L 200 75" />
          </svg>
          <div className="cc-label">
            <span className="pn">▸ PART.100023</span>Z-BAR 4.5
            <span className="meta">/ 16 GA / 120 IN</span>
          </div>
        </div>

        {/* SHAPE 2 — STEP FLASHING */}
        <div className="cc-shape cc-shape-2">
          <svg viewBox="0 0 280 200" preserveAspectRatio="xMidYMid meet">
            <path d="M 30 70 L 75 70 L 95 100 L 185 100 L 205 130 L 245 130" />
            <path d="M 30 70 L 60 50" />
            <path d="M 75 70 L 105 50" />
            <path d="M 95 100 L 125 80" />
            <path d="M 185 100 L 215 80" />
            <path d="M 205 130 L 235 110" />
            <path d="M 245 130 L 275 110" />
            <path d="M 60 50 L 105 50 L 125 80 L 215 80 L 235 110 L 275 110" />
          </svg>
          <div className="cc-label">
            <span className="pn">▸ PART.100041</span>STEP FLASHING
            <span className="meta">/ 24 GA / 120 IN</span>
          </div>
        </div>

        {/* SHAPE 3 — J-CHANNEL */}
        <div className="cc-shape cc-shape-3">
          <svg viewBox="0 0 280 200" preserveAspectRatio="xMidYMid meet">
            <path d="M 70 40 L 70 150 L 195 150 L 195 40" />
            <path d="M 70 40 L 105 18" />
            <path d="M 70 150 L 105 128" />
            <path d="M 195 150 L 230 128" />
            <path d="M 195 40 L 230 18" />
            <path d="M 105 18 L 105 128 L 230 128 L 230 18" />
            <path className="accent" d="M 70 160 L 195 160" />
          </svg>
          <div className="cc-label">
            <span className="pn">▸ PART.100025</span>J-CHANNEL 1.75
            <span className="meta">/ 22 GA / 120 IN</span>
          </div>
        </div>

        {/* SHAPE 4 — L-ANGLE */}
        <div className="cc-shape cc-shape-4">
          <svg viewBox="0 0 280 200" preserveAspectRatio="xMidYMid meet">
            <path d="M 90 35 L 90 145 L 220 145" />
            <path d="M 90 35 L 125 13" />
            <path d="M 90 145 L 125 123" />
            <path d="M 220 145 L 255 123" />
            <path d="M 125 13 L 125 123 L 255 123" />
            <path className="accent" d="M 100 145 L 100 35" />
          </svg>
          <div className="cc-label">
            <span className="pn">▸ PART.100037</span>L-ANGLE 1.5
            <span className="meta">/ 20 GA / 120 IN</span>
          </div>
        </div>
      </div>

      {/* Scanlines */}
      <div className="cc-scanline" />

      {/* LEFT-SIDE text content */}
      <div className="cc-content">
        <div className="cc-prefix">&gt; SYSTEM.READY_</div>
        <div className="cc-headline">
          FABRICATED
          <br />
          TO SPEC.
        </div>
        <div className="cc-meta">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div className="cc-meta-pip" />
            <span style={{ color: "#F5F3EE" }}>LIVE · 245 PARTS IN SHOP</span>
          </div>
          <span style={{ color: "rgba(0,255,204,0.7)" }}>
            {"// DEADLINE: 72HR AVG"}
          </span>
        </div>
      </div>
    </div>
  );
}
