import { Door } from "@/components/Door";
import { KitMark } from "@/components/KitMark";
import { PayPills } from "@/components/PayPills";
import { JOIN_LINE } from "@/lib/copy";

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
    <div style={{ position: "relative" }}>
      <Door title={JOIN_LINE}>
        {handoff ? <p className="handoff">{handoff}</p> : null}
        <PayPills />
      </Door>
      <KitMark placement="join" />
    </div>
  );
}
