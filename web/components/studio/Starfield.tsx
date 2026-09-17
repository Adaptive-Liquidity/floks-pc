"use client";

import dynamic from "next/dynamic";
import { Component, useEffect, useMemo, useState, type ReactNode } from "react";

const Background3D = dynamic(() => import("./Background3D"), { ssr: false });

class WebGLGuard extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render(): ReactNode {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

function CssStars() {
  const stars = useMemo(() => {
    const out: Array<{ left: string; top: string; size: number; opacity: number; color: string }> = [];
    let seed = 7;
    for (let i = 0; i < 260; i += 1) {
      seed = (seed * 16807) % 2147483647;
      out.push({
        left: `${(seed % 1000) / 10}%`,
        top: `${((seed * 13) % 1000) / 10}%`,
        size: (seed % 3) + 1,
        opacity: 0.22 + (seed % 70) / 100,
        color: seed % 5 === 0 ? "#E3F2FD" : "#ffffff",
      });
    }
    return out;
  }, []);

  return (
    <div className="starfield-css" aria-hidden="true">
      {stars.map((star, index) => (
        <span
          key={`${star.left}-${star.top}-${index}`}
          className="starfield-dot"
          style={{
            left: star.left,
            top: star.top,
            width: star.size,
            height: star.size,
            opacity: star.opacity,
            background: star.color,
            boxShadow: star.size > 2 ? `0 0 6px ${star.color}` : undefined,
          }}
        />
      ))}
    </div>
  );
}

export function Starfield() {
  const [reduce, setReduce] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReduce(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    setReady(true);
  }, []);

  return (
    <>
      <CssStars />
      {ready && !reduce ? (
        <WebGLGuard>
          <Background3D />
        </WebGLGuard>
      ) : null}
    </>
  );
}
