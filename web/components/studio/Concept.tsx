"use client";

import { motion } from "motion/react";

export function Concept() {
  return (
    <section className="py-section-gap px-margin-x relative overflow-hidden">
      <motion.div
        className="max-w-container-max mx-auto text-center space-y-stack-lg mb-section-gap relative z-10"
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-100px" }}
        transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
      >
        <h2 className="font-headline-lg text-headline-lg text-tertiary-fixed uppercase">
          CHAT WAS NEVER A <span className="text-gradient-accent">WORKPLACE</span>.
        </h2>
        <p className="font-body-lg text-body-lg text-on-surface-variant max-w-2xl mx-auto">
          One Bot. One computer. One clear boundary. Work stays in Grok. This site is pay, sign-in, setup, and status.
        </p>
      </motion.div>
      <div className="max-w-container-max mx-auto grid md:grid-cols-2 gap-gutter items-center relative z-10">
        <motion.div
          className="space-y-stack-md"
          initial={{ opacity: 0, x: -30 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
        >
          <h3 className="font-headline-lg text-headline-lg text-tertiary-fixed uppercase leading-tight">
            ONE BOT.
            <br />
            ONE COMPUTER.
            <br />
            ONE CLEAR <span className="text-gradient-accent">BOUNDARY</span>.
          </h3>
        </motion.div>
        <motion.div
          className="relative h-[400px] glass-card rounded-2xl flex items-center justify-center glow-border overflow-hidden group"
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1], delay: 0.4 }}
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(227,242,253,0.12)_0%,transparent_70%)] opacity-80 group-hover:opacity-100 transition-opacity duration-700" />
          <motion.div
            animate={{ y: [-10, 10, -10] }}
            transition={{ repeat: Infinity, duration: 8, ease: "easeInOut" }}
            className="relative z-10 w-48 h-48 rounded-3xl border border-white/20 bg-white/5 shadow-[0_0_80px_rgba(227,242,253,0.18)]"
          >
            <div className="absolute inset-6 rounded-2xl border border-secondary/40 bg-[#050505]/70" />
            <div className="absolute inset-x-10 top-1/2 h-px bg-gradient-to-r from-transparent via-secondary to-transparent" />
            <div className="absolute inset-y-10 left-1/2 w-px bg-gradient-to-b from-transparent via-white/40 to-transparent" />
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
