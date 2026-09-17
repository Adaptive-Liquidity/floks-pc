"use client";

import { useEffect, useState } from "react";
import Tilt from "react-parallax-tilt";
import { motion } from "motion/react";
import { Activity, CheckCircle2, Cpu, HardDrive, ShieldCheck, Terminal, Wifi, Zap } from "lucide-react";

export function HeroHardwareNode() {
  const [pulseActive, setPulseActive] = useState(false);
  const [logs, setLogs] = useState<string[]>([
    "NODE_INIT: Isolated computer ready.",
    "BOUNDARY: Scoped permissions armed.",
    "BROWSER: Dedicated Chrome observe online.",
    "FILES: Private workspace mounted.",
    "SYSTEM: Waiting for Bot pair on /setup.",
  ]);
  const [cpuUsage, setCpuUsage] = useState(14);
  const [isHandshaking, setIsHandshaking] = useState(false);
  const [handshakeDone, setHandshakeDone] = useState(false);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setCpuUsage((prev) => Math.min(42, Math.max(12, prev + (Math.random() * 6 - 3))));
    }, 2000);
    return () => window.clearInterval(interval);
  }, []);

  function handleIgnite() {
    if (isHandshaking) return;
    setIsHandshaking(true);
    setPulseActive(true);
    setLogs((prev) => [...prev.slice(-4), ">> INITIATING MCP HANDSHAKE REQUEST..."]);
    window.setTimeout(() => {
      setLogs((prev) => [...prev.slice(-4), ">> PAIR READY. APPROVE ON /SETUP."]);
      setHandshakeDone(true);
      setIsHandshaking(false);
      window.setTimeout(() => setPulseActive(false), 800);
    }, 1200);
  }

  return (
    <Tilt
      tiltMaxAngleX={8}
      tiltMaxAngleY={8}
      perspective={1200}
      scale={1.02}
      transitionSpeed={1200}
      glareEnable
      glareMaxOpacity={0.12}
      glareColor="#ffffff"
      glarePosition="all"
      glareBorderRadius="16px"
      className="relative w-full max-w-lg mx-auto"
    >
      <div
        className={`relative glass-card rounded-2xl p-6 border transition-all duration-700 overflow-hidden bg-surface-container-lowest/80 backdrop-blur-2xl shadow-2xl ${
          pulseActive ? "border-white shadow-[0_0_50px_rgba(255,255,255,0.2)]" : "border-white/10 hover:border-white/20"
        }`}
      >
        <div className="absolute top-3 left-3 w-1.5 h-1.5 rounded-full bg-white/20 border border-white/40" />
        <div className="absolute top-3 right-3 w-1.5 h-1.5 rounded-full bg-white/20 border border-white/40" />
        <div className="absolute bottom-3 left-3 w-1.5 h-1.5 rounded-full bg-white/20 border border-white/40" />
        <div className="absolute bottom-3 right-3 w-1.5 h-1.5 rounded-full bg-white/20 border border-white/40" />

        <div className="flex items-center justify-between pb-4 border-b border-white/10 mb-5">
          <div className="flex items-center gap-3">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white" />
            </span>
            <div>
              <div className="font-label-mono text-[11px] text-white tracking-widest uppercase flex items-center gap-2">
                DESK_01
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/10 text-secondary border border-white/10">
                  ISOLATED
                </span>
              </div>
              <div className="font-label-mono text-[10px] text-on-surface-variant">HW-ID: 4f9a-882e-node</div>
            </div>
          </div>
          <div className="flex items-center gap-4 text-right font-label-mono text-[11px]">
            <div>
              <div className="text-on-surface-variant text-[9px] uppercase tracking-wider">Status</div>
              <div className="text-white flex items-center justify-end gap-1">
                <Wifi className="w-3 h-3 text-secondary" />
                LIVE
              </div>
            </div>
            <div>
              <div className="text-on-surface-variant text-[9px] uppercase tracking-wider">Boundary</div>
              <div className="text-secondary flex items-center justify-end gap-1">
                <ShieldCheck className="w-3 h-3 text-white" />
                ACTIVE
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-5">
          <div className="bg-surface-container/60 p-3 rounded-xl border border-white/5 space-y-1.5">
            <div className="flex justify-between text-[11px] font-label-mono">
              <span className="text-on-surface-variant flex items-center gap-1.5">
                <Cpu className="w-3 h-3 text-white" /> CPU LOAD
              </span>
              <span className="text-white font-medium">{Math.round(cpuUsage)}%</span>
            </div>
            <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden">
              <motion.div
                className="bg-white h-full rounded-full"
                animate={{ width: `${cpuUsage}%` }}
                transition={{ duration: 0.8, ease: "easeOut" }}
              />
            </div>
          </div>
          <div className="bg-surface-container/60 p-3 rounded-xl border border-white/5 space-y-1.5">
            <div className="flex justify-between text-[11px] font-label-mono">
              <span className="text-on-surface-variant flex items-center gap-1.5">
                <HardDrive className="w-3 h-3 text-secondary" /> DEDICATED RAM
              </span>
              <span className="text-white font-medium">8.4 / 64 GB</span>
            </div>
            <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden">
              <div className="bg-secondary h-full rounded-full w-[22%]" />
            </div>
          </div>
        </div>

        <div className="relative bg-[#050505] p-4 rounded-xl border border-white/10 font-label-mono text-[11px] space-y-1.5 mb-5 shadow-inner crt-overlay overflow-hidden">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-white/5 text-[10px] text-on-surface-variant">
            <span className="flex items-center gap-1 text-white">
              <Terminal className="w-3 h-3 text-white" /> GROK MCP SUBSYSTEM
            </span>
            <span className="text-[9px] uppercase tracking-wider text-secondary">DISPLAY :0 ACTIVE</span>
          </div>
          <div className="space-y-1 text-on-surface-variant/90 leading-relaxed min-h-[90px]">
            {logs.map((log, index) => (
              <div
                key={`${log}-${index}`}
                className={`truncate ${
                  log.startsWith(">>")
                    ? "text-white font-semibold flex items-center gap-1.5"
                    : index === logs.length - 1
                      ? "text-white"
                      : ""
                }`}
              >
                {log.startsWith(">>") ? <Zap className="w-3 h-3 text-secondary shrink-0" /> : null}
                {log}
              </div>
            ))}
            <div className="flex items-center gap-1 text-white">
              <span>$</span>
              <span className="terminal-cursor !bg-white" />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between pt-2">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-secondary animate-pulse" />
            <span className="font-label-mono text-[11px] text-on-surface-variant">
              {handshakeDone ? "NODE AUTHENTICATED" : "COMPUTER READY"}
            </span>
          </div>
          <button
            type="button"
            onClick={handleIgnite}
            disabled={isHandshaking}
            className={`font-label-mono text-[11px] uppercase tracking-widest px-4 py-2 rounded-full transition-all duration-300 flex items-center gap-2 ${
              handshakeDone
                ? "bg-white/10 text-white border border-white/20"
                : isHandshaking
                  ? "bg-white/20 text-white cursor-wait"
                  : "bg-white text-black font-semibold hover:bg-secondary hover:shadow-[0_0_20px_rgba(255,255,255,0.4)]"
            }`}
          >
            {isHandshaking ? (
              "Pinging Node..."
            ) : handshakeDone ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-secondary" />
                Handshake Active
              </>
            ) : (
              <>
                <Zap className="w-3.5 h-3.5" />
                Test Handshake
              </>
            )}
          </button>
        </div>
      </div>
    </Tilt>
  );
}
