"use client";

import { useRef } from "react";
import Link from "next/link";
import { motion, useScroll, useTransform } from "motion/react";
import { ArrowRight, Cpu, ShieldCheck } from "lucide-react";
import { HeroHardwareNode } from "./HeroHardwareNode";

export function Hero() {
  const containerRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end start"],
  });
  const yBadge = useTransform(scrollYProgress, [0, 1], [0, 40]);
  const yTitle = useTransform(scrollYProgress, [0, 1], [0, 85]);
  const yDescription = useTransform(scrollYProgress, [0, 1], [0, 120]);
  const yCards = useTransform(scrollYProgress, [0, 1], [0, 150]);
  const yButtons = useTransform(scrollYProgress, [0, 1], [0, 175]);
  const yHardware = useTransform(scrollYProgress, [0, 1], [0, -50]);
  const rotateHardware = useTransform(scrollYProgress, [0, 1], [0, 3]);
  const heroOpacity = useTransform(scrollYProgress, [0, 0.8, 1], [1, 0.85, 0.2]);
  const heroScale = useTransform(scrollYProgress, [0, 1], [1, 0.97]);
  const glowY = useTransform(scrollYProgress, [0, 1], [0, -120]);
  const glowOpacity = useTransform(scrollYProgress, [0, 0.6, 1], [0.15, 0.05, 0]);

  return (
    <section
      ref={containerRef}
      className="relative min-h-screen flex items-center pt-28 pb-section-gap px-margin-x overflow-hidden"
    >
      <motion.div
        style={{ y: glowY, opacity: glowOpacity }}
        className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[700px] h-[500px] bg-gradient-to-tr from-secondary/10 via-white/5 to-transparent rounded-full blur-[140px] pointer-events-none -z-10"
      />
      <motion.div
        style={{ opacity: heroOpacity, scale: heroScale }}
        className="max-w-container-max mx-auto w-full relative z-10 grid lg:grid-cols-12 gap-12 items-center"
      >
        <div className="lg:col-span-7 space-y-stack-lg">
          <motion.div
            style={{ y: yBadge }}
            initial={{ opacity: 0, y: 20, filter: "blur(10px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 1, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
            className="inline-flex flex-wrap items-center gap-3 px-3.5 py-1.5 rounded-full bg-surface-container/60 border border-white/10 backdrop-blur-xl shadow-lg"
          >
            <span className="flex items-center gap-2 font-label-mono text-[11px] text-white uppercase tracking-wider">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-80" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
              </span>
              THE AGENT COMPUTER
            </span>
            <span className="w-px h-3 bg-white/20" />
            <span className="font-label-mono text-[11px] text-secondary flex items-center gap-1">
              <Cpu className="w-3 h-3 text-white" />
              ONE BOT · ONE COMPUTER
            </span>
            <span className="hidden sm:inline-block w-px h-3 bg-white/20" />
            <span className="hidden sm:flex items-center gap-1 font-label-mono text-[11px] text-on-surface-variant">
              <ShieldCheck className="w-3 h-3 text-secondary" />
              WORK STAYS IN GROK
            </span>
          </motion.div>

          <motion.h1
            style={{ y: yTitle }}
            className="font-display-lg text-display-lg text-tertiary-fixed uppercase leading-[1.05]"
            initial={{ opacity: 0, y: 40, filter: "blur(10px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1], delay: 0.35 }}
          >
            YOUR AGENT HAS <br /> <span className="text-gradient-accent">A MIND.</span>
          </motion.h1>

          <motion.p
            style={{ y: yDescription }}
            className="font-body-lg text-body-lg text-on-surface-variant max-w-xl leading-relaxed"
            initial={{ opacity: 0, y: 20, filter: "blur(10px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1], delay: 0.5 }}
          >
            Give it somewhere to work. An isolated Agent Computer — persistent workspace, dedicated browser, private
            files, controlled execution, scoped permissions. Not another chat window. Not a temporary sandbox. One Bot,
            one isolated computer. Work stays in Grok.
          </motion.p>

          <motion.div
            style={{ y: yCards }}
            className="grid grid-cols-3 gap-3 pt-2 max-w-lg"
            initial={{ opacity: 0, y: 20, filter: "blur(10px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1], delay: 0.65 }}
          >
            <div className="glass-card p-4 rounded-xl border border-white/5 flex flex-col justify-center">
              <span className="font-headline-sm text-headline-sm text-tertiary-fixed uppercase mb-0.5">Spark</span>
              <span className="font-label-mono text-label-mono text-white/80">$19 / 8h</span>
            </div>
            <div className="glass-card p-4 rounded-xl secondary-border flex flex-col justify-center bg-surface-container/60 shadow-[0_0_20px_rgba(227,242,253,0.05)]">
              <span className="font-headline-sm text-headline-sm text-white uppercase mb-0.5">Desk</span>
              <span className="font-label-mono text-label-mono text-secondary font-semibold">$39 / 25h</span>
            </div>
            <div className="glass-card p-4 rounded-xl border border-white/5 flex flex-col justify-center">
              <span className="font-headline-sm text-headline-sm text-tertiary-fixed uppercase mb-0.5">Shift</span>
              <span className="font-label-mono text-label-mono text-white/80">$69 / 60h</span>
            </div>
          </motion.div>

          <motion.div
            style={{ y: yButtons }}
            className="pt-2 flex flex-wrap items-center gap-4"
            initial={{ opacity: 0, y: 20, filter: "blur(10px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1], delay: 0.8 }}
          >
            <Link
              className="button-primary px-8 py-4 rounded-full font-label-mono text-label-mono uppercase tracking-widest inline-flex items-center gap-2 group"
              href="/join"
            >
              Get Started
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
            </Link>
            <Link
              className="text-on-surface-variant hover:text-white transition-colors font-label-mono text-label-mono uppercase tracking-widest px-4 py-4"
              href="/product"
            >
              View Architecture →
            </Link>
          </motion.div>
        </div>

        <motion.div
          style={{ y: yHardware, rotateZ: rotateHardware }}
          className="lg:col-span-5 relative w-full flex items-center justify-center pt-8 lg:pt-0"
          initial={{ opacity: 0, scale: 0.94, filter: "blur(15px)" }}
          animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
          transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1], delay: 0.55 }}
        >
          <HeroHardwareNode />
        </motion.div>
      </motion.div>
    </section>
  );
}
