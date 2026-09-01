import { HonestyStrip } from "@/components/HonestyStrip";
import { Door } from "@/components/Door";
import { KitMark } from "@/components/KitMark";
import { PayPills } from "@/components/PayPills";
import { HOME_KICKER, HOME_QUESTION, HOME_SUB } from "@/lib/copy";

export default function HomePage() {
  return (
    <>
      <div style={{ position: "relative" }}>
        <Door kicker={HOME_KICKER} title={HOME_QUESTION}>
          <p className="lede">{HOME_SUB}</p>
          <PayPills />
        </Door>
        <KitMark placement="home" />
      </div>
      <HonestyStrip />
    </>
  );
}
