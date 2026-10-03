import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth/workos";
import { userFromRequest } from "@/lib/auth/request-session";
import { ComputerScreen } from "@/components/ComputerScreen";
import { emailOwnsComputer } from "@/lib/desks/desktop-access";
import { desksForSeats, getComputerService } from "@/lib/desks/runtime";
import { getSeatStore } from "@/lib/billing/seats";

export const metadata: Metadata = {
  title: "Computer",
  robots: { index: false, follow: false },
};

function denied(message: string) {
  return (
    <div className="paper rack">
      <section className="bay">
        <p className="kicker">Computer</p>
        <h1>Not available</h1>
        <p>{message}</p>
        <a className="ghost wide" href="/setup">
          Back to account
        </a>
      </section>
    </div>
  );
}

export default async function ComputerScreenPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const jar = await cookies();
  const request = new Request("https://staxions.local/setup/computers", {
    headers: { cookie: `${COOKIE_NAME}=${jar.get(COOKIE_NAME)?.value ?? ""}` },
  });
  const { user } = await userFromRequest(request);
  if (!user) {
    redirect(`/login?return=${encodeURIComponent(`/setup/computers/${id}`)}`);
  }
  const owned = await emailOwnsComputer(user.email, id);
  if (!owned) return denied("That computer is not on this account.");

  const seats = await getSeatStore().listByEmail(user.email);
  const desks = await desksForSeats(seats);
  const index = desks.findIndex((desk) => desk.computerId === id);
  const label = index >= 0 ? `Computer ${index + 1}` : "Computer";

  try {
    const status = await (await getComputerService()).ownerDesktopStatus(id);
    return (
      <ComputerScreen
        computerId={id}
        label={label}
        initialState={status.computer.state}
        needsWake={status.needsWake}
      />
    );
  } catch {
    return denied("That computer is not available.");
  }
}
