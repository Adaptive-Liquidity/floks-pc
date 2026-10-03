"use client";

export type ActivityRow = {
  id: string;
  at: string;
  operation: string;
  success: boolean;
  errorCode: string | null;
};

export function ComputerActivityLog({
  events,
  nextCursor,
  busy,
  onOlder,
}: {
  events: ActivityRow[];
  nextCursor: string | null;
  busy: boolean;
  onOlder: () => void;
}) {
  return (
    <div>
      <h3>Activity</h3>
      {events.length === 0 ? (
        <p className="activity-empty">No recorded activity yet.</p>
      ) : (
        <table className="activity-log">
          <thead>
            <tr>
              <th>Time</th>
              <th>Operation</th>
              <th>Result</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id}>
                <td>{event.at}</td>
                <td>{event.operation}</td>
                <td className={event.success ? "ok" : "bad"}>{event.success ? "ok" : "fail"}</td>
                <td>{event.errorCode ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {nextCursor ? (
        <button className="ghost" type="button" disabled={busy} onClick={onOlder}>
          Older
        </button>
      ) : null}
    </div>
  );
}
