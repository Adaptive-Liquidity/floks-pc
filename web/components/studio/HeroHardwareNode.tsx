"use client";

import Tilt from "react-parallax-tilt";
import { Terminal } from "lucide-react";

const LOGS = [
  "ILLUSTRATION: This picture is not a live computer.",
  "NODE: Example only. Nothing here is running.",
  "BOUNDARY: Computer access is described, not armed. Pairing is required.",
  "FILES: A private workspace appears after you pair on /setup.",
];

export function HeroHardwareNode() {
  return (
    <Tilt
      tiltMaxAngleX={8}
      tiltMaxAngleY={8}
      perspective={1200}
      scale={1}
      transitionSpeed={1200}
      glareEnable={false}
      className="relative w-full max-w-lg mx-auto"
    >
      <div className="relative glass-card rounded-2xl p-6 border border-white/10 overflow-hidden bg-surface-container-lowest/80 backdrop-blur-2xl shadow-2xl">
        <div className="absolute top-3 left-3 w-1.5 h-1.5 rounded-full bg-white/20 border border-white/40" />
        <div className="absolute top-3 right-3 w-1.5 h-1.5 rounded-full bg-white/20 border border-white/40" />
        <div className="absolute bottom-3 left-3 w-1.5 h-1.5 rounded-full bg-white/20 border border-white/40" />
        <div className="absolute bottom-3 right-3 w-1.5 h-1.5 rounded-full bg-white/20 border border-white/40" />

        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-white/10 mb-5">
          <div>
            <div className="font-label-mono text-[11px] text-white tracking-widest uppercase flex flex-wrap items-center gap-2">
              DESK_01
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/10 text-secondary border border-white/10">
                ILLUSTRATION
              </span>
            </div>
            <div className="font-label-mono text-[10px] text-on-surface-variant">Not a live computer</div>
          </div>
          <div className="font-label-mono text-[11px] text-right">
            <div className="text-on-surface-variant text-[9px] uppercase tracking-wider">Status</div>
            <div className="text-white">EXAMPLE</div>
          </div>
        </div>

        <div className="relative bg-[#050505] p-4 rounded-xl border border-white/10 font-label-mono text-[11px] space-y-1.5 shadow-inner crt-overlay overflow-hidden">
          <div className="flex items-center pb-2 mb-2 border-b border-white/5 text-[10px] text-white">
            <span className="flex items-center gap-1">
              <Terminal className="w-3 h-3 text-white" /> EXAMPLE LOG
            </span>
          </div>
          <div className="space-y-1 text-on-surface-variant/90 leading-relaxed">
            {LOGS.map((log) => (
              <div key={log} className="break-words">
                {log}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Tilt>
  );
}
