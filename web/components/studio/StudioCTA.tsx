"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { ArrowRight } from "lucide-react";
import { JOIN_LINE } from "@/lib/copy";

export function StudioCTA() {
  return (
    <section className="py-section-gap px-margin-x text-center bg-gradient-to-t from-surface-container-lowest to-transparent relative">
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-primary-fixed/5 blur-[100px] rounded-full pointer-events-none" />
      <motion.div
        className="max-w-2xl mx-auto space-y-stack-lg relative z-10"
        initial={{ opacity: 0, y: 40 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-100px" }}
        transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
      >
        <h2 className="font-headline-lg text-headline-lg text-tertiary-fixed uppercase">FLOKS PRIVATE BETA</h2>
        <p className="font-body-lg text-body-lg text-on-surface-variant">{JOIN_LINE}</p>
        <div className="pt-4">
          <Link
            className="inline-flex items-center gap-2 button-primary px-12 py-5 rounded-full font-label-mono text-label-mono uppercase tracking-wider"
            href="/join"
          >
            Get Started
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </motion.div>
    </section>
  );
}
