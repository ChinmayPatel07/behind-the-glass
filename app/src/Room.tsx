import { Suspense, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Html, Lightformer, MeshReflectorMaterial, RoundedBox, useGLTF } from "@react-three/drei";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { SkeletonUtils } from "three-stdlib";
import * as THREE from "three";
import type { AgentId, AgentView, Gesture, Phase, Terms } from "./shared/types";
import { CAST, SEAT_ORDER } from "./cast";

const MODEL = "/models/Xbot.glb";

// Lite mode for software renderers and weak GPUs (or ?lite in the URL): no reflections, post-processing or shadows.
const LITE = (() => {
  if (typeof window === "undefined") return false;
  if (new URLSearchParams(location.search).has("lite")) return true;
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    const name = ext ? String(gl!.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "";
    return /swiftshader|llvmpipe|software/i.test(name);
  } catch {
    return false;
  }
})();
useGLTF.preload(MODEL);

const FOUNDER = new THREE.Vector3(0, 0, 5.2);
const HUDDLE = new THREE.Vector3(-4.6, 0, -2.4);

// Investors stand in an arc behind the table, facing the founder.
function standPos(i: number) {
  const x = (i - 3) * 0.98;
  return new THREE.Vector3(x, 0, -1.05 + Math.pow(i - 3, 2) * 0.05);
}
function huddlePos(i: number) {
  const a = (i / 7) * Math.PI * 2 + 0.3;
  return new THREE.Vector3(HUDDLE.x + Math.cos(a) * 1.55, 0, HUDDLE.z + Math.sin(a) * 1.55);
}

type Speaking = { speaker: AgentId; text: string } | null;

function Investor({ id, index, view, phase, speaking }: { id: AgentId; index: number; view: AgentView; phase: Phase; speaking: boolean }) {
  const { scene, animations } = useGLTF(MODEL);
  const c = CAST[id];
  const root = useRef<THREE.Group>(null!);
  const ring = useRef<THREE.Mesh>(null!);

  // Each investor gets its own skeleton, materials and animation mixer.
  const rig = useMemo(() => {
    const model = SkeletonUtils.clone(scene) as THREE.Group;
    const accent = new THREE.Color(c.color);
    const body = new THREE.MeshPhysicalMaterial({ color: "#2a2a31", metalness: 0.45, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.2 });
    const joints = new THREE.MeshStandardMaterial({ color: accent.clone().multiplyScalar(0.22), emissive: accent, emissiveIntensity: 0.12, metalness: 0.5, roughness: 0.5 });
    model.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.material = /Joints/i.test((m.material as THREE.Material).name) ? joints : body;
      }
    });
    const mixer = new THREE.AnimationMixer(model);
    const clip = (n: string) => animations.find((a) => a.name === n)!;
    const idle = mixer.clipAction(clip("idle"));
    const walk = mixer.clipAction(clip("walk"));
    const additive = (n: string) => {
      const a = THREE.AnimationUtils.makeClipAdditive(clip(n).clone());
      const act = mixer.clipAction(a);
      act.setLoop(THREE.LoopOnce, 1);
      act.clampWhenFinished = false;
      return act;
    };
    idle.play();
    walk.play();
    walk.setEffectiveWeight(0);
    idle.time = index * 0.7; // desynchronise idles so the panel doesn't breathe in unison
    const bone = (n: string) => model.getObjectByName(`mixamorig${n}`) ?? model.getObjectByName(`mixamorig:${n}`);
    return { model, mixer, idle, walk, agree: additive("agree"), shake: additive("headShake"), joints, spine: bone("Spine1"), neck: bone("Neck"), head: bone("Head") };
  }, [scene, animations, c.color, index]);

  // Gestures the agent chose this turn play once on top of the idle.
  const lastGesture = useRef<Gesture>("neutral");
  useEffect(() => {
    if (view.gesture === lastGesture.current) return;
    lastGesture.current = view.gesture;
    const act = view.gesture === "nod" || view.gesture === "smile" ? rig.agree : view.gesture === "head_shake" || view.gesture === "skeptical_tilt" ? rig.shake : null;
    act?.reset().setEffectiveWeight(1).fadeIn(0.15).play();
  }, [view.gesture, rig]);

  const huddling = phase === "huddle";
  const target = useMemo(() => (huddling ? huddlePos(index) : standPos(index)), [huddling, index]);

  useFrame((state, dt) => {
    const g = root.current;
    const t = state.clock.elapsedTime;
    const before = g.position.clone();
    g.position.lerp(target, Math.min(1, dt * 0.9));
    const speed = before.distanceTo(g.position) / Math.max(dt, 1e-3);
    const walking = speed > 0.12;
    rig.walk.setEffectiveWeight(THREE.MathUtils.lerp(rig.walk.getEffectiveWeight(), walking ? 1 : 0, Math.min(1, dt * 6)));
    rig.idle.setEffectiveWeight(1 - rig.walk.getEffectiveWeight());
    const look = walking ? g.position.clone().add(g.position.clone().sub(before).setY(0).normalize()) : huddling ? HUDDLE : FOUNDER;
    const yaw = Math.atan2(look.x - g.position.x, look.z - g.position.z);
    let d = yaw - g.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    g.rotation.y += d * Math.min(1, dt * 4);
    rig.mixer.update(dt);

    // Procedural layer on top of the clips: lean in to talk, look down to take notes, tilt when thinking.
    const lean = speaking ? 0.16 : view.gesture === "lean_in" ? 0.12 : view.gesture === "cross_arms" ? -0.08 : 0;
    if (rig.spine) rig.spine.rotation.x += lean;
    if (rig.neck) {
      if (view.gesture === "take_notes") rig.neck.rotation.x += 0.35;
      if (view.gesture === "skeptical_tilt") rig.neck.rotation.z += 0.18;
      if (view.thinking) rig.neck.rotation.y += Math.sin(t * 1.3 + index) * 0.18;
      if (speaking) rig.neck.rotation.x += Math.sin(t * 5.5) * 0.035;
    }
    const glow = speaking ? 1.0 : view.thinking ? 0.45 + Math.sin(t * 4) * 0.2 : 0.12;
    rig.joints.emissiveIntensity = THREE.MathUtils.lerp(rig.joints.emissiveIntensity, glow, Math.min(1, dt * 5));
    const rm = ring.current.material as THREE.MeshBasicMaterial;
    rm.opacity = THREE.MathUtils.lerp(rm.opacity, speaking ? 0.9 : view.thinking ? 0.35 : 0.12, Math.min(1, dt * 5));
  });

  return (
    <group ref={root} position={standPos(index)}>
      <primitive object={rig.model} scale={0.95} />
      <mesh ref={ring} rotation-x={-Math.PI / 2} position-y={0.012}>
        <ringGeometry args={[0.36, 0.42, 48]} />
        <meshBasicMaterial color={c.color} transparent opacity={0.12} toneMapped={false} />
      </mesh>
      {speaking && <pointLight position={[0, 2.2, 0.8]} intensity={9} distance={4} color={c.color} />}
      <Html position={[0, 2.02, 0]} center distanceFactor={9} zIndexRange={[5, 0]}>
        <div className={`chip ${speaking ? "on" : ""}`} style={{ ["--c" as string]: c.color }}>
          {c.name.split(" ")[0]}
        </div>
      </Html>
    </group>
  );
}

function Skyline() {
  // Night city behind the glass: dark towers with a procedurally lit window texture.
  const { towers, tex } = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#07080c";
    ctx.fillRect(0, 0, 64, 128);
    for (let y = 2; y < 128; y += 6)
      for (let x = 2; x < 64; x += 5)
        if (Math.random() < 0.2) {
          ctx.fillStyle = Math.random() < 0.8 ? "#f5c97a" : "#9cc8ff";
          ctx.globalAlpha = 0.25 + Math.random() * 0.5;
          ctx.fillRect(x, y, 2, 3);
        }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const towers = Array.from({ length: 46 }, (_, i) => {
      const w = 1.2 + rnd() * 2.4;
      const h = 4 + rnd() * 16;
      return { x: -40 + i * 1.8 + rnd(), z: -26 - rnd() * 18, w: w * 1.3, h: h * 1.2, d: 1.5 + rnd() * 2 };
    });
    return { towers, tex };
  }, []);
  return (
    <group>
      {towers.map((t, i) => {
        const map = tex.clone();
        map.needsUpdate = true;
        map.repeat.set(t.w / 2, t.h / 4);
        return (
          <mesh key={i} position={[t.x, t.h / 2 - 1, t.z]}>
            <boxGeometry args={[t.w, t.h, t.d]} />
            <meshStandardMaterial color="#0b0d12" emissive="#ffffff" emissiveMap={map} emissiveIntensity={0.7} map={map} />
          </mesh>
        );
      })}
      <mesh position={[0, 12, -40]}>
        <planeGeometry args={[140, 40]} />
        <meshBasicMaterial color="#0b1426" />
      </mesh>
    </group>
  );
}

function Boardroom({ phase }: { phase: Phase }) {
  return (
    <group>
      {/* reflective floor */}
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[40, 40]} />
        {LITE ? (
          <meshStandardMaterial color="#0e0e12" metalness={0.5} roughness={0.35} />
        ) : (
          <MeshReflectorMaterial blur={[400, 120]} resolution={1024} mixBlur={1} mixStrength={18} roughness={0.85} depthScale={1.1} minDepthThreshold={0.4} maxDepthThreshold={1.3} color="#0d0d10" metalness={0.6} mirror={0.5} />
        )}
      </mesh>
      {/* table: dark glass slab on a walnut base with a warm light strip */}
      <RoundedBox args={[7.0, 0.08, 1.4]} radius={0.04} position={[0, 0.98, 0.15]} castShadow receiveShadow>
        <meshPhysicalMaterial color="#3a271a" metalness={0.05} roughness={0.32} clearcoat={0.8} clearcoatRoughness={0.2} />
      </RoundedBox>
      <mesh position={[0, 0.935, 0.85]}>
        <boxGeometry args={[6.8, 0.012, 0.012]} />
        <meshBasicMaterial color="#38bdf8" toneMapped={false} />
      </mesh>
      {[-2.6, 2.6].map((x) => (
        <mesh key={x} position={[x, 0.47, 0.15]}>
          <boxGeometry args={[0.05, 0.94, 0.9]} />
          <meshStandardMaterial color="#1b1b20" metalness={0.85} roughness={0.25} />
        </mesh>
      ))}
      {/* window wall with mullions */}
      {Array.from({ length: 9 }, (_, i) => (
        <mesh key={i} position={[-12 + i * 3, 3, -6]}>
          <boxGeometry args={[0.06, 6, 0.06]} />
          <meshStandardMaterial color="#1f2025" metalness={0.8} roughness={0.3} />
        </mesh>
      ))}
      <mesh position={[0, 3, -6]}>
        <planeGeometry args={[26, 6]} />
        <meshPhysicalMaterial color="#9fb4d9" transparent opacity={0.06} roughness={0} metalness={0} />
      </mesh>
      {/* glass partition between the founder and the room (visible from outside during the huddle) */}
      <mesh position={[0, 1.6, 3.4]}>
        <planeGeometry args={[18, 3.2]} />
        <meshPhysicalMaterial color="#c7d2e6" transparent opacity={phase === "huddle" ? 0.12 : 0.0} roughness={0.05} />
      </mesh>
      {phase === "huddle" &&
        [-6, -3, 0, 3, 6].map((x) => (
          <mesh key={x} position={[x, 1.6, 3.4]}>
            <boxGeometry args={[0.04, 3.2, 0.04]} />
            <meshStandardMaterial color="#2b2c31" metalness={0.8} roughness={0.3} />
          </mesh>
        ))}
      {/* firm name */}
      <Html position={[0, 3.45, -5.9]} center transform distanceFactor={6} zIndexRange={[1, 0]}>
        <div className="firm">COPPERLINE VENTURES</div>
      </Html>
    </group>
  );
}

function TermSheetPaper({ terms }: { terms: Terms | null }) {
  const ref = useRef<THREE.Group>(null!);
  useFrame((_, dt) => {
    const target = terms ? new THREE.Vector3(0.2, 1.03, 0.65) : new THREE.Vector3(0, 1.03, -0.3);
    ref.current.position.lerp(target, Math.min(1, dt * 1.4));
    ref.current.visible = Boolean(terms);
  });
  return (
    <group ref={ref} position={[0, 1.03, -0.3]} rotation-y={-0.12}>
      <mesh rotation-x={-Math.PI / 2} castShadow>
        <planeGeometry args={[0.42, 0.56]} />
        <meshStandardMaterial color="#f4f2ee" roughness={0.9} />
      </mesh>
    </group>
  );
}

function CameraRig({ phase, speaker }: { phase: Phase; speaker: AgentId | null }) {
  const { camera } = useThree();
  const look = useRef(new THREE.Vector3(0, 1.4, -1));
  const start = useRef(performance.now());
  useFrame((_, dt) => {
    const intro = Math.min(1, (performance.now() - start.current) / 4500);
    const ease = 1 - Math.pow(1 - intro, 3);
    const outside = phase === "huddle";
    const si = speaker ? SEAT_ORDER.indexOf(speaker) : -1;
    const sx = 0 * si; // camera stays steady; only phase changes move it
    const pos = outside
      ? new THREE.Vector3(2.2, 2.3, 7.6)
      : new THREE.Vector3(sx * 0.12, 2.15 + (1 - ease) * 1.4, 6.3 + (1 - ease) * 3.4);
    const tgt = outside ? new THREE.Vector3(-3.6, 1.0, -2.2) : new THREE.Vector3(sx * 0.25, 1.12, -1.2);
    camera.position.lerp(pos, Math.min(1, dt * (outside ? 0.9 : 1.6)));
    look.current.lerp(tgt, Math.min(1, dt * 1.4));
    camera.lookAt(look.current);
  });
  return null;
}

export default function Room(props: { agents: Record<AgentId, AgentView>; phase: Phase; speaking: Speaking; terms: Terms | null }) {
  return (
    <Canvas shadows={!LITE} camera={{ position: [0, 4, 9.6], fov: 50 }} dpr={LITE ? 1 : [1, 1.75]} gl={{ antialias: !LITE }}>
      <color attach="background" args={["#050a16"]} />
      <fog attach="fog" args={["#050a16", 18, 60]} />
      <ambientLight intensity={0.5} />
      <spotLight position={[0, 7, 3]} angle={0.6} penumbra={0.9} intensity={38} castShadow shadow-mapSize={[1024, 1024]} color="#fff1d6" />
      <directionalLight position={[0, 3, 7]} intensity={1.1} color="#ffe9cc" />
      <directionalLight position={[-6, 5, -4]} intensity={0.6} color="#8fb0ff" />
      <Environment resolution={256} frames={1}>
        <Lightformer form="rect" intensity={2} position={[0, 5, 2]} scale={[10, 2, 1]} color="#fff3dc" />
        <Lightformer form="rect" intensity={1.2} position={[-6, 2, -4]} scale={[4, 6, 1]} color="#7aa2ff" />
        <Lightformer form="ring" intensity={1.5} position={[5, 3, 4]} scale={2} color="#38bdf8" />
      </Environment>
      <CameraRig phase={props.phase} speaker={props.speaking?.speaker ?? null} />
      <Skyline />
      <Boardroom phase={props.phase} />
      <Suspense fallback={null}>
        {SEAT_ORDER.map((id, i) => (
          <Investor key={id} id={id} index={i} view={props.agents[id]} phase={props.phase} speaking={props.speaking?.speaker === id} />
        ))}
      </Suspense>
      <TermSheetPaper terms={props.phase === "termsheet" || props.phase === "closed" ? props.terms : null} />
      {!LITE && (
        <EffectComposer>
          <Bloom intensity={0.9} luminanceThreshold={0.6} luminanceSmoothing={0.2} mipmapBlur />
          <Vignette offset={0.25} darkness={0.75} />
        </EffectComposer>
      )}
    </Canvas>
  );
}
