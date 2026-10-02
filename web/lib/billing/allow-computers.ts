import { getComputerService } from "../desks/runtime";
import { getOauthStore } from "../oauth";
import { getSeatStore, type SeatRecord } from "./seats";

export type AllowComputer = {
  id: string;
  label: string;
  plan: string;
  status: string;
  in_use_by_bot?: string;
};

export async function listAllowComputers(email: string): Promise<AllowComputer[]> {
  const seats = (await getSeatStore().listByEmail(email)).filter((seat) => seat.status === "active");
  const found: Array<{ id: string; plan: string; status: string; bot: string | null }> = [];
  const service = await getComputerService();
  for (const seat of seats) {
    for (const id of computerIds(seat)) {
      if (found.some((row) => row.id === id)) continue;
      let status: string = seat.status;
      try {
        status = (await service.get(id)).state;
      } catch {
        status = seat.status;
      }
      const binding = await getOauthStore().liveComputerBinding(id);
      let bot: string | null = null;
      if (binding) {
        const client = await getOauthStore().getClient(binding.clientId);
        bot = client?.clientName || "another Bot";
      }
      found.push({ id, plan: seat.plan, status, bot });
    }
  }
  found.sort((left, right) => Number(Boolean(left.bot)) - Number(Boolean(right.bot)));
  return found.map((row, index) => ({
    id: row.id,
    label: `Computer ${index + 1}`,
    plan: row.plan,
    status: row.status,
    ...(row.bot ? { in_use_by_bot: row.bot } : {}),
  }));
}

function computerIds(seat: SeatRecord): string[] {
  const ids = seat.computerIds.filter(Boolean);
  if (seat.computerId && !ids.includes(seat.computerId)) ids.unshift(seat.computerId);
  return ids;
}
