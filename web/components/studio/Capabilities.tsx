"use client";

import { motion } from "motion/react";
import { HardDrive, Monitor, ShieldCheck, Zap } from "lucide-react";

const capabilities = [
  {
    icon: Monitor,
    tag: "Live Chrome",
    title: "Observe the screen",
    description:
      "The Bot observes with screenshots and the accessibility tree on a dedicated browser. Click stays fail-closed until we ship safer click.",
    metric: "Observe",
  },
  {
    icon: HardDrive,
    tag: "Private files",
    title: "Persistent workspace",
    description:
      "Files stay with the work while the computer is up. Sleep does not wipe. When the subscription ends, the disk is not kept.",
    metric: "Sleep-safe",
  },
  {
    icon: ShieldCheck,
    tag: "One boundary",
    title: "Isolated computer",
    description:
      "One paid seat: one Grok Bot, one isolated Linux VM. Scoped permissions you grant. Not a shared chat sandbox.",
    metric: "VM isolate",
  },
  {
    icon: Zap,
    tag: "Work in Grok",
    title: "Pair and operate",
    description:
      "Pay, sign in with a 6-digit code, Allow in Grok, Approve on /setup. The Bot works inside the computer. You watch the boundary.",
    metric: "Four moves",
  },
] as const;

export function Capabilities() {
  return (
    <section className="py-20 px-margin-x relative overflow-hidden">
      <div className="max-w-container-max mx-auto space-y-12">
        <div className="text-center max-w-2xl mx-auto space-y-4">
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="inline-flex items-center gap-2 font-label-mono text-[11px] text-secondary uppercase tracking-widest px-3 py-1 rounded-full bg-surface-container/60 border border-white/10"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-secondary" />
            Core Capabilities
          </motion.div>
          <motion.h2
            initial={{ opacity: 0, y: 15 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
            className="font-display-lg text-headline-lg md:text-display-md text-tertiary-fixed uppercase tracking-tight"
          >
            What is an <span className="text-gradient-accent">Agent Computer?</span>
          </motion.h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {capabilities.map((cap, index) => {
            const Icon = cap.icon;
            return (
              <motion.div
                key={cap.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-40px" }}
                transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: index * 0.1 }}
                className="glass-card p-6 rounded-2xl border border-white/10 bg-surface-container-lowest/70 backdrop-blur-xl flex flex-col justify-between hover:border-white/25 transition-all duration-300 group shadow-lg"
              >
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-white group-hover:border-white/30 group-hover:scale-105 transition-all">
                      <Icon className="w-5 h-5 text-secondary" />
                    </div>
                    <span className="font-label-mono text-[10px] text-on-surface-variant uppercase tracking-wider px-2 py-0.5 rounded bg-white/5 border border-white/5">
                      {cap.tag}
                    </span>
                  </div>
                  <div className="space-y-2 pt-1">
                    <h3 className="font-headline-sm text-[18px] text-white tracking-wide font-medium">{cap.title}</h3>
                    <p className="text-[13px] text-on-surface-variant leading-relaxed">{cap.description}</p>
                  </div>
                </div>
                <div className="pt-5 mt-4 border-t border-white/5 flex items-center justify-between font-label-mono text-[11px]">
                  <span className="text-on-surface-variant/70">Specification</span>
                  <span className="text-white font-medium">{cap.metric}</span>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
