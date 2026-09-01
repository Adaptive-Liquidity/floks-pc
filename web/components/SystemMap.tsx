/** Four-system map. Only FLOKS is for sale. */

const SYSTEMS = [
  {
    name: "FLOKS",
    role: "persistent runtime",
    state: "Live. For sale here.",
    live: true,
  },
  {
    name: "AEON",
    role: "cognitive state",
    state: "Locked until G0. Not for sale.",
    live: false,
  },
  {
    name: "NEXUS",
    role: "execution evidence",
    state: "Locked until G0. Not for sale.",
    live: false,
  },
  {
    name: "ASR",
    role: "coordination research",
    state: "Not for sale.",
    live: false,
  },
] as const;

export function SystemMap() {
  return (
    <div className="sys-map">
      {SYSTEMS.map((sys) => (
        <article key={sys.name} className={sys.live ? "sys-cell sys-live" : "sys-cell"}>
          <p className="kicker">{sys.live ? "Live" : "Locked"}</p>
          <h3>{sys.name}</h3>
          <p className="sys-role">{sys.role}</p>
          <p>{sys.state}</p>
        </article>
      ))}
    </div>
  );
}
