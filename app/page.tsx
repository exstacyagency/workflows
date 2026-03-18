import Link from "next/link";

export default function IndexPage() {
  return (
    <div className="site-shell marketing-shell">
      <header className="site-header">
        <div className="container header-inner">
          <a href="#top" className="brand">Kairos AI</a>
          <div className="flex items-center gap-3">
            <Link href="/studio" className="nav-cta">Enter Studio</Link>
            <a href="mailto:hello@kairos.ai" className="nav-cta">Book Demo</a>
          </div>
        </div>
      </header>

      <main id="top">
        <section className="hero section">
          <div className="container hero-grid">
            <div className="hero-copy">
              <p className="eyebrow">Research-backed creative system</p>
              <h1>
                Stop guessing.
                <br />
                <span>Start building from signal.</span>
              </h1>
              <p className="lede">
                Kairos helps performance teams turn customer insight, competitor patterns,
                and product intelligence into stronger creative bets.
              </p>
              <div className="hero-actions">
                <a href="mailto:hello@kairos.ai" className="btn btn-primary">Book Demo</a>
                <a href="#workflow" className="btn btn-secondary">See the Workflow</a>
                <Link href="/studio" className="btn btn-secondary">Open Platform</Link>
              </div>
            </div>

            <div className="hero-visual" aria-label="Kairos pipeline concept board">
              <article className="signal-card reddit-card">
                <p className="card-label">Reddit • r/SkincareAddiction</p>
                <p className="card-copy">“Love the texture but the pump broke after 2 days...”</p>
              </article>

              <article className="signal-card metric-card">
                <p className="card-label">Creative V3 UGC</p>
                <div className="metric-row">
                  <span>CPA: $45.20</span>
                  <span className="pill pill-warn">High</span>
                </div>
              </article>

              <article className="signal-card notes-card">
                <p className="card-label">Q3 brief notes</p>
                <p className="mono-lines">
                  {">"} need to pivot hook.
                  <br />
                  {">"} drop the aesthetic angle, focus purely on durability.
                  <br />
                  {">"} who is shooting this?
                </p>
              </article>

              <article className="signal-card file-card">
                <div className="file-preview"></div>
                <p className="card-label">RAW FILE 04.mp4</p>
              </article>

              <div className="pipeline-core">
                <p className="core-kicker">Kairos Pipeline</p>
                <h2>Unified Concept Board</h2>
              </div>
            </div>
          </div>
        </section>

        <section className="audience-strip">
          <div className="container audience-inner">
            <p>Built for teams that can’t afford to guess their way into the next campaign.</p>
            <ul>
              <li>DTC Brands</li>
              <li>Performance Teams</li>
              <li>Creative Strategists</li>
              <li>Ecommerce Agencies</li>
            </ul>
          </div>
        </section>

        <section className="section problem-section">
          <div className="container problem-grid">
            <div>
              <p className="eyebrow">The mess upstream</p>
              <h2>Ad production is fragmented by default.</h2>
              <p className="body-copy">
                Customer voice lives in reviews and Reddit. Competitor patterns live in ad libraries.
                Product insight lives in scattered notes. Strategy lives in someone’s head. Production
                lives across disconnected tools.
              </p>
              <p className="body-copy"><strong>That’s how teams end up guessing what to make.</strong></p>
              <p className="body-copy accent">Kairos turns that mess into one system.</p>
            </div>
          </div>
        </section>

        <section id="workflow" className="section workflow-section">
          <div className="container">
            <div className="section-heading narrow">
              <p className="eyebrow">The Kairos pipeline</p>
              <h2>How Kairos turns signal into creative direction.</h2>
              <p>
                Kairos brings research, analysis, strategy, and creative production into one workflow —
                so your team can make better decisions before production starts.
              </p>
            </div>

            <div className="workflow-grid">
              <article className="stage-card">
                <span className="stage-num">Stage 01</span>
                <h3>Collect Research</h3>
                <p>Gather customer research, competitor creative, and product inputs into one shared research layer.</p>
                <div className="mini-console">
                  <span>{">"} Fetching ASIN data...</span>
                  <span>{">"} Parsing 4,203 reviews...</span>
                  <span>{">"} Extracting pain points...</span>
                </div>
              </article>
              <article className="stage-card">
                <span className="stage-num">Stage 02</span>
                <h3>Analyze Patterns</h3>
                <p>Identify recurring pains, objections, desires, hooks, and language patterns that actually matter.</p>
                <div className="tag-list">
                  <span>Objection: Price</span>
                  <span>Hook: “Life hack”</span>
                  <span>Desire: Time-saving</span>
                </div>
              </article>
              <article className="stage-card">
                <span className="stage-num">Stage 03</span>
                <h3>Generate Strategy</h3>
                <p>Turn raw signal into angles, themes, and script directions worth testing.</p>
                <div className="quote-box">
                  <span>0.0s — Hook</span>
                  <strong>“Stop wasting 3 hours every Sunday...”</strong>
                </div>
              </article>
              <article className="stage-card">
                <span className="stage-num">Stage 04</span>
                <h3>Build Creative</h3>
                <p>Produce scripts, storyboards, and generated assets from evidence-backed creative direction.</p>
                <div className="storyboard-grid">
                  <span>Frame 01</span>
                  <span>Frame 02</span>
                  <span>Frame 03</span>
                </div>
              </article>
              <article className="stage-card">
                <span className="stage-num">Stage 05</span>
                <h3>Deliver Output</h3>
                <p>Move from approved output into production-ready assets and repeatable campaign workflows.</p>
                <div className="status-chip success">✓ Export Complete</div>
              </article>
            </div>
          </div>
        </section>

        <section className="section why-section">
          <div className="container why-grid">
            <div>
              <p className="eyebrow">Why Kairos</p>
              <h2>Winning creative starts upstream.</h2>
              <p className="body-copy">
                Most tools start at the generation layer, assuming you already know what to make.
                Kairos starts with evidence — what customers want, what competitors are proving,
                and what the market is already telling you.
              </p>
              <p className="body-copy">
                That gives your team a stronger basis for deciding what to make before production begins.
              </p>
              <ul className="check-list">
                <li>Extract real customer pain points, desires, and language</li>
                <li>Identify patterns in competitor hooks, claims, and structures</li>
                <li>Turn scattered inputs into clearer creative direction</li>
              </ul>
            </div>

            <div className="intel-stack">
              <article className="intel-card">
                <p className="card-label">Transcript OCR</p>
                <p>“The competitor ad focuses 70% of screen time on the product texture. User retention drops off at 0:04.”</p>
              </article>
              <article className="intel-card">
                <p className="card-label">Sentiment Cluster</p>
                <p>42% of 5-star reviews mention “morning routine integration”.</p>
              </article>
              <article className="intel-card accent-card">
                <p className="card-label">Synthesized strategic angle</p>
                <p>“Effortless Morning Texture”</p>
              </article>
            </div>
          </div>
        </section>

        <section className="section studio-section">
          <div className="container studio-grid">
            <div>
              <p className="eyebrow">Creative studio</p>
              <h2>Where better inputs become creative output.</h2>
              <p className="body-copy">
                Kairos doesn’t stop at insight. It turns research into scripts, storyboards,
                scenes, and creative assets your team can actually use.
              </p>
              <p className="body-copy">So insight doesn’t die in a doc — it moves into production.</p>
            </div>

            <div className="concept-card">
              <div className="concept-header">
                <span>Creative Concept #42</span>
                <span className="status-chip muted">Generated</span>
              </div>
              <div className="concept-block">
                <p className="card-label">Winning angle</p>
                <h3>“The Invisible Ritual”</h3>
                <p>
                  Positioning the product as a seamless addition to morning habits, directly addressing
                  the “residue” objection found in competitor datasets.
                </p>
              </div>
              <div className="concept-script">
                <div>
                  <span className="card-label">0.0s — Hook</span>
                  <p>“Stop wasting 3 hours every Sunday...”</p>
                </div>
                <div>
                  <span className="card-label">0.2s — Script opening</span>
                  <p>[Fast paced establishing shot of messy kitchen counter]. Narrator: “If your morning routine looks like this...”</p>
                </div>
              </div>
              <div className="storyboard-grid large">
                <span>Frame 01</span>
                <span>Frame 02</span>
                <span>Frame 03</span>
              </div>
              <div className="status-row">
                <span className="status-chip">Script Locked</span>
                <span className="status-chip">Storyboard Ready</span>
                <span className="status-chip">Asset Queue Ready</span>
              </div>
            </div>
          </div>
        </section>

        <section className="section operators-section">
          <div className="container operators-grid">
            <div>
              <p className="eyebrow">Operators</p>
              <h2>Built for repeatable execution.</h2>
              <p className="body-copy">
                Better outcomes come from repeatable systems, not isolated guesses. Kairos is built for teams
                that need visible runs, structured workflows, and a better way to move from research to production.
              </p>
              <p className="body-copy">Not prompt roulette. Not scattered docs. A system your team can reuse, refine, and scale.</p>
            </div>
            <div className="runs-card">
              <div className="runs-header">
                <span>Recent pipeline runs</span>
                <span className="new-run">+ New Run</span>
              </div>
              <div className="run-item">
                <strong>#KAI-042</strong>
                <span>Evergreen UGC Concept Board</span>
                <span>2m ago</span>
                <span className="status-chip success subtle">Completed</span>
              </div>
              <div className="run-item">
                <strong>#KAI-043</strong>
                <span>Competitor Analysis (Skincare)</span>
                <span>Just now</span>
                <span className="status-chip subtle">Analyzing DB...</span>
              </div>
            </div>
          </div>
        </section>

        <section className="section cta-section">
          <div className="container cta-box">
            <h2>Build a repeatable ad pipeline, not a pile of prompts.</h2>
            <p>
              Stop guessing what to make. Use Kairos to turn fragmented signal into creative direction,
              production output, and a stronger shot at winning.
            </p>
            <div className="hero-actions centered">
              <a href="mailto:hello@kairos.ai" className="btn btn-primary">Book Demo</a>
              <Link href="/studio" className="btn btn-secondary">Open Platform</Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="container footer-inner">
          <a href="#top" className="brand">Kairos AI</a>
          <p>© 2026 Kairos. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
