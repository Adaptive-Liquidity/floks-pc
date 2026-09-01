import { CapabilityGrid } from "@/components/CapabilityGrid";
import { ComparePanel } from "@/components/ComparePanel";
import { FlowDiagram } from "@/components/FlowDiagram";
import { HonestyStrip } from "@/components/HonestyStrip";
import { KitMark } from "@/components/KitMark";
import { PayPills } from "@/components/PayPills";
import { ProductSurface } from "@/components/ProductSurface";
import { SystemMap } from "@/components/SystemMap";
import { HOME_HEADLINE, HOME_KICKER, HOME_LINE, HOME_SUB, HOME_TOOLS } from "@/lib/copy";

export default function HomePage() {
  return (
    <>
      <section className="hero-stage">
        <div className="hero-copy">
          <p className="intro-kicker">
            <span className="intro-rule" aria-hidden="true" />
            {HOME_KICKER}
            <span className="intro-rule" aria-hidden="true" />
          </p>
          <h1 className="display">{HOME_HEADLINE}</h1>
          <p className="hero-sub">{HOME_SUB}</p>
          <p className="hero-sub">{HOME_LINE}</p>
        </div>
        <div className="hero-product">
          <ProductSurface />
          <KitMark placement="home" />
        </div>
        <div className="hero-pay">
          <PayPills />
          <p className="lede center">{HOME_TOOLS}</p>
        </div>
      </section>

      <section className="band">
        <div className="band-copy">
          <p className="kicker">Occupation</p>
          <h2 className="section-title">A chat window can answer. A computer can continue.</h2>
          <p className="lede">
            Isolated runtime. Private files. Browser. Scoped tools. One Bot, one computer.
          </p>
        </div>
        <ComparePanel />
      </section>

      <section className="band">
        <div className="band-copy">
          <p className="kicker">Four moves</p>
          <h2 className="section-title">Then it occupies the machine.</h2>
          <p className="lede">Work stays in Grok. This page is pay, pair, and status.</p>
        </div>
        <FlowDiagram />
      </section>

      <section className="band">
        <div className="band-copy">
          <p className="kicker">Boundary</p>
          <h2 className="section-title">What it does. What it does not.</h2>
        </div>
        <CapabilityGrid />
      </section>

      <section className="band">
        <div className="band-copy">
          <p className="kicker">Asentxia Systems</p>
          <h2 className="section-title">Four systems. One of them is for sale.</h2>
        </div>
        <SystemMap />
      </section>

      <section className="band band-close">
        <div className="band-copy">
          <p className="kicker">{HOME_KICKER}</p>
          <h2 className="section-title">{HOME_HEADLINE}</h2>
          <p className="lede">{HOME_LINE}</p>
        </div>
        <PayPills />
      </section>

      <HonestyStrip />
    </>
  );
}
