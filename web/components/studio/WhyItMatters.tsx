"use client";

import { motion } from "motion/react";
import { Link2Off, MessageSquare, Terminal } from "lucide-react";

export function WhyItMatters() {
  return (
    <section className="py-section-gap px-margin-x bg-surface-container-lowest/50">
      <div className="max-w-container-max mx-auto space-y-stack-lg">
        <motion.div
          className="text-center"
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
        >
          <h2 className="font-headline-md text-headline-md text-tertiary-fixed uppercase tracking-widest mb-4">
            Why It Matters
          </h2>
          <p className="font-headline-lg text-headline-lg text-tertiary-fixed">
            A CHAT WINDOW CAN ANSWER.
            <br />
            <span className="text-gradient-secondary">A COMPUTER CAN CONTINUE.</span>
          </p>
        </motion.div>
        <div className="grid md:grid-cols-2 gap-8 mt-16 max-w-4xl mx-auto">
          <motion.div
            className="glass-card rounded-2xl p-8 border border-white/5 opacity-60"
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 1, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
          >
            <h4 className="font-headline-sm text-headline-sm text-center text-on-surface-variant mb-8">Chat Window</h4>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div className="space-y-2">
                <MessageSquare className="mx-auto w-8 h-8 text-on-surface-variant/50" />
                <p className="font-label-mono text-label-mono text-on-surface-variant/70">
                  Limited
                  <br />
                  Context
                </p>
              </div>
              <div className="space-y-2">
                <Terminal className="mx-auto w-8 h-8 text-on-surface-variant/50" />
                <p className="font-label-mono text-label-mono text-on-surface-variant/70">
                  Text
                  <br />
                  Only
                </p>
              </div>
              <div className="space-y-2">
                <Link2Off className="mx-auto w-8 h-8 text-on-surface-variant/50" />
                <p className="font-label-mono text-label-mono text-on-surface-variant/70">
                  External
                  <br />
                  Access
                </p>
              </div>
            </div>
          </motion.div>
          <motion.div
            className="glass-card rounded-2xl p-8 glow-border relative overflow-hidden"
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 1, ease: [0.16, 1, 0.3, 1], delay: 0.4 }}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-primary-fixed/5 to-transparent" />
            <h4 className="font-headline-sm text-headline-sm text-center text-primary-fixed mb-8 relative z-10">
              Agent Computer
            </h4>
            <div className="grid grid-cols-3 gap-4 text-center relative z-10">
              <div className="space-y-2">
                <span className="block text-4xl text-primary-fixed drop-shadow-[0_0_10px_rgba(227,242,253,0.5)]">∞</span>
                <p className="font-label-mono text-label-mono text-primary-fixed">
                  Persistent
                  <br />
                  State
                </p>
              </div>
              <div className="space-y-2">
                <Terminal className="mx-auto w-8 h-8 text-primary-fixed drop-shadow-[0_0_10px_rgba(227,242,253,0.5)]" />
                <p className="font-label-mono text-label-mono text-primary-fixed">
                  Full
                  <br />
                  Execution
                </p>
              </div>
              <div className="space-y-2">
                <span className="block text-3xl text-primary-fixed drop-shadow-[0_0_10px_rgba(227,242,253,0.5)]">▣</span>
                <p className="font-label-mono text-label-mono text-primary-fixed">
                  Private
                  <br />
                  Space
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
