import { HonestyStrip } from "@/components/HonestyStrip";
import { KitMark } from "@/components/KitMark";
import { PayPills } from "@/components/PayPills";
import {
  HOME_HEADLINE,
  HOME_KICKER,
  HOME_LINE,
  HOME_SUB,
  HOME_TOOLS,
  HOW_STEPS,
  JOIN_LINE,
} from "@/lib/copy";

const CAPS = [
  {
    tag: "Live Chrome",
    title: "Observe the screen",
    body: "The Bot observes with screenshots and the accessibility tree on a dedicated browser. Click stays fail-closed until we ship safer click.",
    spec: "Observe",
  },
  {
    tag: "Private files",
    title: "Persistent workspace",
    body: "Files stay with the work while the computer is up. Sleep does not wipe. When the subscription ends, the disk is not kept.",
    spec: "Sleep-safe",
  },
  {
    tag: "One boundary",
    title: "Isolated computer",
    body: "One paid seat: one Grok Bot, one isolated Linux VM. Scoped permissions you grant. Not a shared chat sandbox.",
    spec: "VM isolate",
  },
  {
    tag: "Work in Grok",
    title: "Pair and operate",
    body: "Pay, sign in with a 6-digit code, Allow in Grok, Approve on /setup. The Bot works inside the computer. You watch the boundary.",
    spec: "Four moves",
  },
] as const;

export default function HomePage() {
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <p className="kicker kicker-badge">{HOME_KICKER}</p>
          <h1>
            {HOME_HEADLINE} <span className="hero-accent">A workplace.</span>
          </h1>
          <p className="lede">{HOME_SUB}</p>
          <p className="lede">{HOME_LINE}</p>
          <div className="hero-plans">
            <div className="hero-card">
              <p className="kicker">Spark</p>
              <p className="meta">$19 / 8h</p>
            </div>
            <div className="hero-card featured">
              <p className="kicker">Desk</p>
              <p className="meta">$39 / 25h</p>
            </div>
            <div className="hero-card">
              <p className="kicker">Shift</p>
              <p className="meta">$69 / 60h</p>
            </div>
          </div>
          <p className="lede">{HOME_TOOLS}</p>
          <p className="lede">{JOIN_LINE}</p>
          <div className="actions" style={{ marginTop: 24, maxWidth: 360 }}>
            <a className="btn" href="/join">
              Pick a desk
            </a>
            <a className="ghost wide" href="/login">
              Sign in
            </a>
          </div>
        </div>
        <div className="hero-node" aria-hidden="true" />
      </section>

      <section className="section">
        <h2>
          Chat was never a <span className="hero-accent">workplace</span>.
        </h2>
        <p className="lede">
          One Bot. One computer. One clear boundary. Work stays in Grok. This site is pay, sign-in, setup, and
          status.
        </p>
      </section>

      <section className="section">
        <p className="kicker">Core capabilities</p>
        <h2>
          What is an <span className="hero-accent">Agent Computer?</span>
        </h2>
        <div className="cap-grid">
          {CAPS.map((cap) => (
            <article key={cap.title} className="cap-card">
              <p className="kicker">{cap.tag}</p>
              <h3>{cap.title}</h3>
              <p className="lede">{cap.body}</p>
              <p className="meta">{cap.spec}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section">
        <h2>From Bot to operator in four steps</h2>
        <div className="cap-grid">
          {HOW_STEPS.map((step) => (
            <article key={step.n} className="step-card">
              <p className="kicker">
                {step.n} · {step.title}
              </p>
              <p className="lede">{step.body}</p>
            </article>
          ))}
        </div>
      </section>

      <div style={{ position: "relative" }}>
        <section className="section">
          <PayPills />
        </section>
        <KitMark placement="home" />
      </div>

      <HonestyStrip />

      <section className="cta-band">
        <h2>FLOKS private beta</h2>
        <p className="lede" style={{ margin: "0 auto 24px" }}>
          Spark, Desk, or Shift. Then sign in. We email a 6-digit code.
        </p>
        <a className="btn" href="/join">
          Pick a desk
        </a>
      </section>
    </>
  );
}
