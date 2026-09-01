import { HonestyStrip } from "@/components/HonestyStrip";
import { Door } from "@/components/Door";
import { KitMark } from "@/components/KitMark";
import { PayPills } from "@/components/PayPills";
import { HOME_NEXT, HOME_QUESTION, HOME_TOOLS } from "@/lib/copy";

export default function HomePage() {
  return (
    <>
      <div style={{ position: "relative" }}>
        <Door title={HOME_QUESTION}>
          <p className="lede">{HOME_NEXT}</p>
          <PayPills />
          <p className="lede">{HOME_TOOLS}</p>
        </Door>
        <KitMark placement="home" />
      </div>
      <HonestyStrip />
    </>
  );
}
