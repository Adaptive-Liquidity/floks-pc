"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { HOW_STEPS } from "@/lib/copy";

type Line = { text: string; color: string };

const SEQUENCES: Record<string, Array<{ text: string; delay: number; color?: string }>> = {
  account: [
    { text: "> authkit --mode=magic_auth --screen=sign-up", delay: 80 },
    { text: "> [RUNNING] Emailing a 6-digit code...", delay: 320 },
    { text: "> [OK] Code sent. No password form.", delay: 240 },
    { text: "> [RUNNING] Sealing httpOnly session...", delay: 280 },
    { text: "> [OK] Account home on /setup. $0 seats is fine.", delay: 200 },
    { text: "> ACCOUNT READY. BUY A COMPUTER NEXT.", delay: 160, color: "text-secondary-fixed" },
  ],
  buy: [
    { text: "> init seat --plan=spark|desk|shift", delay: 80 },
    { text: "> [RUNNING] Opening Stripe Payment Link...", delay: 280 },
    { text: "> [OK] Payment confirmed. Seat open.", delay: 360 },
    { text: "> [RUNNING] Binding inbox to the paid seat...", delay: 280 },
    { text: "> [OK] Hours armed. Computer not launched yet.", delay: 240 },
    { text: "> PAID. RETURN TO /SETUP.", delay: 160, color: "text-secondary-fixed" },
  ],
  allow: [
    { text: "> oauth allow --client=floks-pc --scope=mcp", delay: 80 },
    { text: "> [RUNNING] Proving the paying customer...", delay: 300 },
    { text: "> [OK] Customer confirmed. Bot not chosen.", delay: 240 },
    { text: "> [RUNNING] Work stays in Grok...", delay: 260 },
    { text: "> [OK] Plugin allowed. Pair still unused.", delay: 200 },
    { text: "> ALLOW COMPLETE. APPROVE ON /SETUP.", delay: 160, color: "text-secondary-fixed" },
  ],
  approve: [
    { text: "> pair --reveal-once --fail-closed", delay: 80 },
    { text: "> [RUNNING] Minting pair key digest...", delay: 300 },
    { text: "> [OK] Key shown once. Lost key → revoke.", delay: 240 },
    { text: "> [RUNNING] Approve pending Bot claim...", delay: 280 },
    { text: "> [VERIFIED] That Bot occupies that computer.", delay: 240, color: "text-secondary-fixed" },
    { text: "> BOUNDARY ON. COMPUTER LIVE.", delay: 160, color: "text-primary-fixed" },
  ],
};

const STEP_KEYS = ["account", "buy", "allow", "approve"] as const;

const BOOT_LINES: Line[] = [
  { text: "> SYSTEM READY.", color: "" },
  { text: "> ONE BOT · ONE COMPUTER.", color: "" },
  { text: "> ISOLATED LINUX VM.", color: "" },
  { text: "> DEDICATED BROWSER OBSERVE.", color: "" },
  { text: "> PRIVATE FILES MOUNTED.", color: "" },
  { text: "> SCOPED PERMISSIONS ARMED.", color: "" },
  { text: "> AWAITING PAIR ON /SETUP...", color: "" },
];

export function ProcessAndTerminal() {
  const [activeStep, setActiveStep] = useState("");
  const [lines, setLines] = useState<Line[]>(BOOT_LINES);
  const [isTyping, setIsTyping] = useState(false);
  const [typingLine, setTypingLine] = useState<Line>({ text: "", color: "" });
  const scrollRef = useRef<HTMLDivElement>(null);
  const sequenceIdRef = useRef(0);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [lines, typingLine]);

  async function triggerSequence(type: string) {
    if (activeStep === type) return;
    setActiveStep(type);
    setIsTyping(true);
    setLines([]);
    setTypingLine({ text: "", color: "" });
    const seqId = (sequenceIdRef.current += 1);
    const sequence = SEQUENCES[type];
    if (!sequence) return;
    for (const step of sequence) {
      await new Promise((resolve) => {
        window.setTimeout(resolve, step.delay);
      });
      if (seqId !== sequenceIdRef.current) return;
      const color = step.color ?? "";
      setTypingLine({ text: "", color });
      for (let i = 0; i <= step.text.length; i += 1) {
        setTypingLine({ text: step.text.slice(0, i), color });
        await new Promise((resolve) => {
          window.setTimeout(resolve, 16);
        });
        if (seqId !== sequenceIdRef.current) return;
      }
      setLines((prev) => [...prev, { text: step.text, color }]);
      setTypingLine({ text: "", color: "" });
    }
    setLines((prev) => [...prev, { text: "> ", color: "" }]);
    setIsTyping(false);
  }

  return (
    <section className="py-section-gap px-margin-x relative border-y border-white/5 bg-surface-container-lowest/80 overflow-hidden">
      <div className="absolute inset-0 flex justify-center opacity-20 pointer-events-none">
        <div className="w-px h-full bg-gradient-to-b from-transparent via-primary-fixed to-transparent" />
      </div>
      <div className="max-w-container-max mx-auto grid lg:grid-cols-2 gap-section-gap">
        <motion.div
          initial={{ opacity: 0, x: -30 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
        >
          <p className="font-label-mono text-label-mono text-on-surface-variant mb-4">06</p>
          <h3 className="font-headline-lg text-headline-lg text-tertiary-fixed uppercase mb-12">
            FROM BOT TO <br />
            OPERATOR IN <br />
            FOUR STEPS
          </h3>
          <div className="space-y-8 relative before:absolute before:inset-y-0 before:left-8 before:w-px before:bg-white/10">
            {HOW_STEPS.map((step, index) => {
              const key = STEP_KEYS[index] ?? "account";
              return (
                <div
                  key={step.n}
                  className={`timeline-step flex gap-6 relative z-10 ${activeStep === key ? "active" : ""}`}
                  onMouseEnter={() => {
                    void triggerSequence(key);
                  }}
                >
                  <div className="step-num w-16 font-display-lg text-display-lg text-gradient-secondary opacity-50 shrink-0 transition-all duration-300">
                    {step.n}
                  </div>
                  <div className="pt-2">
                    <h4 className="font-headline-sm text-headline-sm text-tertiary-fixed uppercase transition-colors duration-300">
                      {step.title}
                    </h4>
                    <p className="font-body-md text-body-md text-on-surface-variant">{step.body}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, x: 30 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
        >
          <p className="font-label-mono text-label-mono text-on-surface-variant mb-4">07</p>
          <h3 className="font-headline-lg text-headline-lg text-tertiary-fixed uppercase mb-12">
            REAL SYSTEMS <br />
            HAVE REAL LIMITS
          </h3>
          <div className="glass-card rounded-lg p-6 font-label-mono text-label-mono glow-border h-[400px] overflow-hidden relative crt-overlay bg-[#0a0a0a]">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary-fixed to-transparent opacity-50 z-10" />
            <p className="text-on-surface-variant/70 mb-4 sticky top-0 bg-[#0a0a0a]/90 py-2 z-10 border-b border-white/5">
              SECURE TERMINAL ACCESS:
            </p>
            <div className="h-full overflow-y-auto pb-12 pr-2 custom-scrollbar relative z-0" ref={scrollRef}>
              <ul className="space-y-2 text-primary-fixed terminal-glow">
                {lines.map((line, index) => (
                  <li key={`${line.text}-${index}`} className={line.color}>
                    {line.text}
                    {index === lines.length - 1 && !isTyping ? <span className="terminal-cursor" /> : null}
                  </li>
                ))}
                {isTyping ? (
                  <li className={typingLine.color}>
                    {typingLine.text}
                    <span className="terminal-cursor" />
                  </li>
                ) : null}
              </ul>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
