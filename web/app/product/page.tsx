import { MarketingPage } from "@/components/MarketingPage";
import { PRODUCT_EYEBROW, PRODUCT_TITLE } from "@/lib/copy";

export const metadata = { title: "Product" };

export default function ProductPage() {
  return (
    <MarketingPage eyebrow={PRODUCT_EYEBROW} title={PRODUCT_TITLE}>
      <p>
        FLOKS is an isolated Agent Computer for one Grok Bot. Persistent workspace. Dedicated browser. Private
        files. Controlled execution. Scoped permissions.
      </p>
      <section className="space-y-3">
        <h2 className="font-headline-sm text-headline-sm text-tertiary-fixed uppercase">What it is</h2>
        <p>
          One paid seat = one Grok Bot = one isolated Linux computer. Not another chat window. Not a temporary
          sandbox. Not a shared host.
        </p>
      </section>
      <section className="space-y-3">
        <h2 className="font-headline-sm text-headline-sm text-tertiary-fixed uppercase">Where work happens</h2>
        <p>Work stays in Grok. This website is create account, pay, setup, and status.</p>
      </section>
      <section className="space-y-3">
        <h2 className="font-headline-sm text-headline-sm text-tertiary-fixed uppercase">The boundary</h2>
        <p>
          Pair with a one-time key and scoped tokens. The Bot works inside the computer. It does not inherit
          ambient access from you, from Grok’s shared native machine, or from another Bot.
        </p>
      </section>
      <section className="space-y-3">
        <h2 className="font-headline-sm text-headline-sm text-tertiary-fixed uppercase">What it is not</h2>
        <p>
          Not unrestricted click. Not public VNC. Not proxies. Not bot-detection bypass. Not unlimited root. Not
          a backup/snapshot product. Not AEON, NEXUS, or ASR for sale.
        </p>
      </section>
    </MarketingPage>
  );
}
