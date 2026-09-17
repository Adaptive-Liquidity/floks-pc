import { HonestyStrip } from "@/components/HonestyStrip";
import { KitMark } from "@/components/KitMark";
import { Capabilities } from "@/components/studio/Capabilities";
import { Concept } from "@/components/studio/Concept";
import { Hero } from "@/components/studio/Hero";
import { ProcessAndTerminal } from "@/components/studio/ProcessAndTerminal";
import { StudioCTA } from "@/components/studio/StudioCTA";
import { WhyItMatters } from "@/components/studio/WhyItMatters";

export default function HomePage() {
  return (
    <>
      <Hero />
      <Concept />
      <WhyItMatters />
      <Capabilities />
      <ProcessAndTerminal />
      <div className="relative">
        <HonestyStrip />
        <KitMark placement="home" />
      </div>
      <StudioCTA />
    </>
  );
}
