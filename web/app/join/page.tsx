import { HonestyStrip } from "@/components/HonestyStrip";
import { KitMark } from "@/components/KitMark";
import { PlanGrid } from "@/components/studio/PlanGrid";
import { JOIN_HOURS, JOIN_LINE, JOIN_SUB, JOIN_TITLE } from "@/lib/copy";

export const metadata = {
  title: "Join",
  description: JOIN_LINE,
  robots: { index: true, follow: true },
};

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ handoff?: string | string[] }>;
}) {
  const query = await searchParams;
  const handoff = typeof query.handoff === "string" ? query.handoff.trim() : "";
  return (
    <>
      <section className="min-h-screen flex flex-col items-center justify-center pt-28 pb-16 px-margin-x">
        <div className="text-center max-w-5xl w-full space-y-stack-lg relative">
          <h1 className="font-display-lg text-display-lg text-tertiary-fixed uppercase">{JOIN_TITLE}</h1>
          <p className="font-body-lg text-body-lg text-on-surface-variant max-w-2xl mx-auto">{JOIN_SUB}</p>
          <p className="font-label-mono text-[12px] text-on-surface-variant/80 max-w-2xl mx-auto uppercase tracking-wider">
            {JOIN_HOURS}
          </p>
          <p className="font-label-mono text-[12px] text-on-surface-variant/80 max-w-2xl mx-auto">{JOIN_LINE}</p>
          {handoff ? <p className="handoff mx-auto max-w-xl">{handoff}</p> : null}
          <PlanGrid />
          <p className="font-body-lg text-body-lg text-on-surface-variant max-w-2xl mx-auto pt-4">
            Already paid?{" "}
            <a className="text-secondary hover:text-white" href="/login">
              Sign in
            </a>
            .
          </p>
          <KitMark placement="join" />
        </div>
      </section>
      <HonestyStrip />
    </>
  );
}
