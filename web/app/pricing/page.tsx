import { HonestyStrip } from "@/components/HonestyStrip";
import { KitMark } from "@/components/KitMark";
import { PlanGrid } from "@/components/studio/PlanGrid";
import { readAuthFromCookies } from "@/lib/setup-server";
import {
  CREATE_ACCOUNT,
  JOIN_HOURS,
  JOIN_LINE,
  PRICING_SUB,
  PRICING_TITLE,
  SETUP_SIGN_IN,
} from "@/lib/copy";

export const metadata = {
  title: "Pricing",
  description: PRICING_SUB,
  robots: { index: true, follow: true },
};

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string | string[] }>;
}) {
  const query = await searchParams;
  const canceled = query.checkout === "canceled";
  const auth = await readAuthFromCookies();
  const signedIn = Boolean(auth.email);
  return (
    <>
      <section className="min-h-screen flex flex-col items-center justify-center pt-28 pb-16 px-margin-x">
        <div className="text-center max-w-5xl w-full space-y-stack-lg relative">
          <h1 className="font-display-lg text-display-lg text-tertiary-fixed uppercase">{PRICING_TITLE}</h1>
          <p className="font-body-lg text-body-lg text-on-surface-variant max-w-2xl mx-auto">{PRICING_SUB}</p>
          <p className="font-label-mono text-[12px] text-on-surface-variant/80 max-w-2xl mx-auto uppercase tracking-wider">
            {JOIN_HOURS}
          </p>
          <p className="font-label-mono text-[12px] text-on-surface-variant/80 max-w-2xl mx-auto">{JOIN_LINE}</p>
          {canceled ? (
            <p className="font-body-lg text-body-lg text-on-surface-variant max-w-2xl mx-auto">
              Checkout was canceled. No charge was made.
            </p>
          ) : null}
          {signedIn ? (
            <p className="font-body-lg text-body-lg text-on-surface-variant max-w-2xl mx-auto">
              Signed in as <strong>{auth.email}</strong>. Buy a computer — Stripe return lands on{" "}
              <a className="text-secondary hover:text-white" href="/setup">
                /setup
              </a>
              .
            </p>
          ) : (
            <p className="font-body-lg text-body-lg text-on-surface-variant max-w-2xl mx-auto">
              Create an account first, then buy.{" "}
              <a className="text-secondary hover:text-white" href="/signup">
                {CREATE_ACCOUNT}
              </a>
              {" · "}
              <a className="text-secondary hover:text-white" href="/login">
                {SETUP_SIGN_IN}
              </a>
              .
            </p>
          )}
          <PlanGrid email={auth.email} signedIn={signedIn} />
          <KitMark placement="join" />
        </div>
      </section>
      <HonestyStrip />
    </>
  );
}
