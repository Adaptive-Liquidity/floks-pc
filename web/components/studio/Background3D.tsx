"use client";

import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { PointMaterial, Points } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import * as THREE from "three";

function generateParticles(count: number, radius: number): Float32Array {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const theta = Math.random() * 2.0 * Math.PI;
    const phi = Math.acos(Math.random() * 2.0 - 1.0);
    const r = Math.cbrt(Math.random()) * radius;
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);
  }
  return positions;
}

function Swarm({
  mouse,
  scrollY,
}: {
  mouse: MutableRefObject<{ x: number; y: number; targetX: number; targetY: number }>;
  scrollY: MutableRefObject<number>;
}) {
  const frostRef = useRef<THREE.Points>(null);
  const iceRef = useRef<THREE.Points>(null);
  const groupRef = useRef<THREE.Group>(null);
  const frost = useMemo(() => generateParticles(4500, 22), []);
  const ice = useMemo(() => generateParticles(1800, 16), []);

  useFrame((state, delta) => {
    const scroll = scrollY.current;
    mouse.current.x += (mouse.current.targetX - mouse.current.x) * 0.05;
    mouse.current.y += (mouse.current.targetY - mouse.current.y) * 0.05;
    state.camera.position.x = THREE.MathUtils.lerp(state.camera.position.x, mouse.current.x * 2.2, 0.04);
    state.camera.position.y = THREE.MathUtils.lerp(
      state.camera.position.y,
      -mouse.current.y * 2.2 - scroll * 0.002,
      0.04,
    );
    state.camera.lookAt(0, -scroll * 0.001, 0);
    if (groupRef.current) {
      groupRef.current.rotation.x = mouse.current.y * 0.25;
      groupRef.current.rotation.y = mouse.current.x * 0.35 + Math.PI / 4;
    }
    if (frostRef.current) {
      frostRef.current.rotation.x -= delta * 0.04;
      frostRef.current.rotation.y -= delta * 0.06;
      frostRef.current.position.y = scroll * 0.002;
    }
    if (iceRef.current) {
      iceRef.current.rotation.x += delta * 0.025;
      iceRef.current.rotation.y += delta * 0.035;
      iceRef.current.position.y = scroll * 0.001;
    }
  });

  return (
    <group ref={groupRef} rotation={[0, 0, Math.PI / 4]}>
      <Points ref={frostRef} positions={frost} stride={3} frustumCulled={false}>
        <PointMaterial
          transparent
          color="#ffffff"
          size={0.032}
          sizeAttenuation
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </Points>
      <Points ref={iceRef} positions={ice} stride={3} frustumCulled={false}>
        <PointMaterial
          transparent
          color="#E3F2FD"
          size={0.045}
          sizeAttenuation
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </Points>
    </group>
  );
}

export default function Background3D() {
  const mouse = useRef({ x: 0, y: 0, targetX: 0, targetY: 0 });
  const scrollY = useRef(0);

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      mouse.current.targetX = (event.clientX / window.innerWidth) * 2 - 1;
      mouse.current.targetY = (event.clientY / window.innerHeight) * 2 - 1;
    };
    const onScroll = () => {
      scrollY.current = window.scrollY;
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[-1] bg-[#050505] overflow-hidden pointer-events-none">
      <Canvas camera={{ position: [0, 0, 12], fov: 60 }}>
        <fog attach="fog" args={["#050505", 5, 25]} />
        <Swarm mouse={mouse} scrollY={scrollY} />
        <EffectComposer enableNormalPass={false}>
          <Bloom luminanceThreshold={0.2} mipmapBlur intensity={1.5} />
        </EffectComposer>
      </Canvas>
      <div className="absolute inset-0 bg-gradient-to-b from-[#050505]/0 via-[#050505]/30 to-[#050505] mix-blend-multiply" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,#050505_100%)] opacity-80" />
    </div>
  );
}
