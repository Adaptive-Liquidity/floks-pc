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
          <motion.img
            src="/concept-boundary.png"
            alt="One Bot. One computer. One clear boundary."
            animate={{ y: [-10, 10, -10] }}
            transition={{ repeat: Infinity, duration: 8, ease: "easeInOut" }}
            className="relative z-10 w-[92%] h-auto max-h-[360px] object-contain"
          />
        </motion.div>
      </div>
    </section>
  );
}
