/** Does / Does not — institutional honesty grid. */

const DOES = [
  "pair one Bot to one isolated Linux VM",
  "see the computer’s screen and what’s on it",
  "private files",
  "bounded exec",
  "scoped tokens",
  "owner-controlled lifecycle",
] as const;

const DOES_NOT = [
  "click is not live yet",
  "public VNC",
  "residential proxies",
  "bot-detection bypass",
  "unlimited root",
  "a production-scale multi-tenancy claim we have not earned",
] as const;

export function CapabilityGrid() {
  return (
    <div className="cap-grid">
      <article className="cap-col">
        <p className="kicker">Does</p>
        <ul>
          {DOES.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </article>
      <article className="cap-col cap-muted">
        <p className="kicker">Does not</p>
        <ul>
          {DOES_NOT.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </article>
    </div>
  );
}
