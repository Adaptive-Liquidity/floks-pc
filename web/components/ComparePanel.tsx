/** Two-column contrast — a chat window versus an occupiable computer. */

const CHAT = [
  "Rebuilt context every session",
  "Fragile, borrowed browser",
  "Files somewhere else",
  "Access spread across the host",
  "Failure means a human investigates",
  "An assistant",
] as const;

const COMPUTER = [
  "Persistent workspace. Sleep does not wipe.",
  "Dedicated browser on this computer",
  "Private files with the work",
  "Scoped capabilities, granted by you",
  "Defined state and lifecycle",
  "An accountable operator",
] as const;

export function ComparePanel() {
  return (
    <div className="compare">
      <article className="compare-col">
        <p className="kicker">Chat</p>
        <h3>A window can answer.</h3>
        <ul>
          {CHAT.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </article>
      <article className="compare-col compare-live">
        <p className="kicker">FLOKS</p>
        <h3>A computer can continue.</h3>
        <ul>
          {COMPUTER.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </article>
    </div>
  );
}
