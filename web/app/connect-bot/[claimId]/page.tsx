import { notFound, redirect } from "next/navigation";
import { userFromRequest } from "@/lib/auth/request-session";
import { listAllowComputers } from "@/lib/billing/allow-computers";
import { flockIdForEmail, getComputerService } from "@/lib/desks/runtime";
import { cookies } from "next/headers";
import { COOKIE_NAME } from "@/lib/auth/workos";

export const metadata = { title: "Connect a bot", robots: { index: false, follow: false } };

export default async function ConnectBotPage({
  params,
  searchParams,
}: {
  params: Promise<{ claimId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { claimId } = await params;
  const query = await searchParams;
  const jar = await cookies();
  const request = new Request("https://staxions.local/connect-bot", {
    headers: { cookie: `${COOKIE_NAME}=${jar.get(COOKIE_NAME)?.value ?? ""}` },
  });
  const { user } = await userFromRequest(request);
  if (!user) redirect(`/login?return=${encodeURIComponent(`/connect-bot/${claimId}`)}`);
  const claim = await (await getComputerService()).getBotClaim(claimId);
  if (!claim || claim.flockId !== flockIdForEmail(user.email)) notFound();
  const computers = await listAllowComputers(user.email);
  return (
    <section className="stage">
      <div className="card">
        <h1 className="question">Name this bot</h1>
        <p className="lede">Pick the computer it may use. The name is yours, not the bot&apos;s.</p>
        <form className="actions" method="post" action={`/api/bots/claims/${claimId}/approve`}>
          {query.error === "bot_name" ? (
            <p className="fail" role="alert">
              Give this bot a name first.
            </p>
          ) : null}
          <label htmlFor="bot-name" className="note">
            Bot name
          </label>
          <input
            id="bot-name"
            name="bot_name"
            className="code"
            required
            minLength={1}
            maxLength={40}
            autoComplete="off"
          />
          <fieldset className="note">
            <legend>Computer</legend>
            {computers.map((computer) => (
              <label key={computer.id}>
                <input type="radio" name="computer_id" value={computer.id} required />
                {computer.label}
                {computer.in_use_by_bot
                  ? ` · Used by bot ${computer.in_use_by_bot}${computer.last_used ? `, last used ${computer.last_used}` : ""}`
                  : " · Free"}
                {computer.in_use_by_bot ? (
                  <span className="fail">{` ${computer.in_use_by_bot} will lose access`}</span>
                ) : null}
              </label>
            ))}
          </fieldset>
          <button className="key wide" type="submit">
            Approve
          </button>
          <input type="hidden" name="plan" value="personal" />
          <button
            className="ghost wide"
            type="submit"
            formAction={`/api/bots/claims/${claimId}/buy`}
            formNoValidate
          >
            Buy a new computer for this bot
          </button>
        </form>
        <form method="post" action={`/api/bots/claims/${claimId}/deny`}>
          <button className="ghost wide" type="submit">
            Deny
          </button>
        </form>
      </div>
    </section>
  );
}
