/** AuthKit-style stacked translucent product surfaces. Occupancy, not a login box. */

export function ProductSurface() {
  return (
    <div className="product-surface" aria-hidden="true">
      <article className="surface-card surface-card-left">
        <header className="surface-head">
          <span className="surface-dots" />
          <span className="surface-title">Observe</span>
        </header>
        <div className="surface-screen">
          <div className="surface-chrome-bar">
            <span />
            <span />
            <span />
          </div>
          <p className="surface-label">Live Chrome</p>
          <p className="surface-body">Screenshot of the dedicated browser on this desk.</p>
        </div>
      </article>

      <article className="surface-card surface-card-center">
        <header className="surface-head">
          <span className="surface-lamp" />
          <span className="surface-title">Desk · running</span>
        </header>
        <dl className="surface-meta">
          <div>
            <dt>Seat</dt>
            <dd>1 Bot · 1 computer</dd>
          </div>
          <div>
            <dt>State</dt>
            <dd>Running. Hours are billing.</dd>
          </div>
          <div>
            <dt>Boundary</dt>
            <dd>Scoped tokens. Owner lifecycle.</dd>
          </div>
        </dl>
        <div className="surface-row">
          <span className="surface-chip">Persistent</span>
          <span className="surface-chip">Isolated</span>
        </div>
      </article>

      <article className="surface-card surface-card-right">
        <header className="surface-head">
          <span className="surface-dots" />
          <span className="surface-title">Private files</span>
        </header>
        <ul className="surface-files">
          <li>workspace/</li>
          <li>notes.md</li>
          <li>session.log</li>
        </ul>
        <p className="surface-body">They stay with the work. Sleep does not wipe.</p>
      </article>
    </div>
  );
}
