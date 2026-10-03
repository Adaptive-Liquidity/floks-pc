/**
 * Entitlement/billing gate for waking or recovering a computer.
 * Missing seats stay allowed. past_due, canceled, and over-cap stay down.
 */
import { shouldSuspendForCap } from "../billing/metering";
import { getSeatStore } from "../billing/seats";

export async function admitComputerWake(computerId: string): Promise<boolean> {
  try {
    const seats = await getSeatStore().listAll();
    const seat = seats.find(
      (row) => row.computerId === computerId || row.computerIds.includes(computerId),
    );
    if (!seat) return true;
    if (seat.status !== "active") return false;
    return !shouldSuspendForCap(seat);
  } catch {
    return false;
  }
}
