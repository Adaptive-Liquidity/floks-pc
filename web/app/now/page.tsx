import { MarketingPage } from "@/components/MarketingPage";
import { HONESTY, NOW_EYEBROW, NOW_TITLE } from "@/lib/copy";

export const metadata = { title: "Now" };

export default function NowPage() {
  return (
    <MarketingPage eyebrow={NOW_EYEBROW} title={NOW_TITLE}>
      <p>This is what you can buy and run today. No roadmap theater.</p>
      <section className="space-y-3">
        <h2 className="font-headline-sm text-headline-sm text-tertiary-fixed uppercase">Available now</h2>
        <ul className="list-disc pl-5 space-y-2">
          <li>Personal, Pro, and Team. Pricing to be confirmed. Enterprise is contact us.</li>
          <li>Personal · 10h · Pro · 40h · Team · 30h per agent (min 3)</li>
          <li>One Bot, one isolated Linux VM</li>
          <li>Live Chrome observe (screenshots + accessibility tree)</li>
          <li>Private files on that computer. Files kept while your computer exists.</li>
          <li>Shell and browser tools</li>
          <li>Scoped, revocable computer access, only on the supported computer-access surface</li>
          <li>Start / Sleep / Resume / Shut down</li>
          <li>Create account or sign in with a 6-digit AuthKit code, then buy, then Allow in Grok and Approve on /setup</li>
          <li>Cancel and billing portal from /setup</li>
        </ul>
      </section>
      <section className="space-y-3">
        <h2 className="font-headline-sm text-headline-sm text-tertiary-fixed uppercase">Not for sale / not live yet</h2>
        <ul className="list-disc pl-5 space-y-2">
          <li>Always-on as a public plan (not sold)</li>
          <li>Safer click (stays fail-closed)</li>
          <li>Backup or snapshot product (copy files while it’s up; disk not kept after cancel)</li>
          <li>Public VNC, residential proxies, bot-detection bypass</li>
          <li>AEON, NEXUS, ASR (not for sale on this site)</li>
        </ul>
      </section>
      <p>{HONESTY}</p>
    </MarketingPage>
  );
}
