import { HONESTY, SEAT_RULE } from "@/lib/copy";

export function HonestyStrip() {
  return (
    <aside className="honesty">
      <p>
        <strong>Seat.</strong> {SEAT_RULE}
      </p>
      <p>
        <strong>Hours.</strong> {HONESTY.hours}
      </p>
      <p>
        <strong>Disk.</strong> {HONESTY.disk}
      </p>
      <p>
        <strong>Cancel.</strong> {HONESTY.cancel}
      </p>
    </aside>
  );
}
