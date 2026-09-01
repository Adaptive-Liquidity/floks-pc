import { HONESTY, SEAT_RULE } from "@/lib/copy";

export function HonestyStrip() {
  return (
    <aside className="honesty">
      <div className="honesty-head">
        <svg className="honesty-warn" viewBox="0 0 20 20" aria-hidden="true">
          <path
            d="M10 2.4L18.4 17H1.6L10 2.4z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
          />
          <path d="M10 8v4.2" stroke="currentColor" strokeWidth="1.4" />
          <circle cx="10" cy="14.4" r="0.8" fill="currentColor" />
        </svg>
        <div>
          <h2>Honesty</h2>
          <p>{SEAT_RULE}</p>
        </div>
      </div>
      <div className="honesty-grid">
        <article className="honesty-card">
          <p className="kicker">Hours</p>
          <p>{HONESTY.hours}</p>
        </article>
        <article className="honesty-card">
          <p className="kicker">Disk</p>
          <p>{HONESTY.disk}</p>
        </article>
        <article className="honesty-card span">
          <p className="kicker">Cancel</p>
          <p>{HONESTY.cancel}</p>
        </article>
      </div>
    </aside>
  );
}
