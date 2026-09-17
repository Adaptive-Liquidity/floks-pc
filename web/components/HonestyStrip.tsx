import { HONESTY } from "@/lib/copy";

export function HonestyStrip() {
  return (
    <aside className="honesty max-w-container-max mx-auto w-[calc(100%-var(--gutter)*2)] glass-card rounded-2xl border border-white/5">
      <p className="font-label-mono text-[11px] text-secondary uppercase tracking-widest mb-2">Honesty</p>
      <p className="font-body-md text-on-surface-variant">{HONESTY}</p>
    </aside>
  );
}
