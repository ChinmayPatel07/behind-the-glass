import { useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Html, RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import type { AgentId, AgentView, Phase, Terms } from "./shared/types";
import { CAST, SEAT_ORDER } from "./cast";

const FOUNDER_POS = new THREE.Vector3(0, 1.1, 3.2);
const HUDDLE_CENTER = new THREE.Vector3(-3.6, 0, -2.6);

function seatPos(i: number) {
  const angles = [200, 222, 245, 270, 295, 318, 340].map((d) => (d * Math.PI) / 180);
  const a = angles[i];
  return new THREE.Vector3(Math.cos(a) * 3.0, 0, Math.sin(a) * 1.75 - 0.2);
}
function huddlePos(i: number) {
  const a = (i / 7) * Math.PI * 2;
  return new THREE.Vector3(HUDDLE_CENTER.x + Math.cos(a) * 1.1, 0, HUDDLE_CENTER.z + Math.sin(a) * 1.1);
}

interface AvatarProps {
  id: AgentId;
  index: number;
  view: AgentView;
  phase: Phase;
  speaking: string | null;
}

function Avatar({ id, index, view, phase, speaking }: AvatarProps) {
  const c = CAST[id];
  const root = useRef<THREE.Group>(null!);
  const torso = useRef<THREE.Group>(null!);
  const head = useRef<THREE.Group>(null!);
  const mouth = useRef<THREE.Mesh>(null!);
  const armL = useRef<THREE.Group>(null!);
  const armR = useRef<THREE.Group>(null!);
  const halo = useRef<THREE.Mesh>(null!);
  const huddling = phase === "huddle";
  const seated = !huddling;
  const target = useMemo(() => (huddling ? huddlePos(index) : seatPos(index)), [huddling, index]);
  const isSpeaking = speaking !== null;

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    const g = root.current;
    // walk to seat / huddle
    const before = g.position.clone();
    g.position.lerp(target, Math.min(1, dt * 1.6));
    const moving = before.distanceTo(g.position) > 0.004;
    // face: founder when seated, huddle center when huddling, direction of travel when walking
    const look = moving
      ? g.position.clone().add(g.position.clone().sub(before).setY(0).normalize())
      : huddling
        ? HUDDLE_CENTER.clone()
        : new THREE.Vector3(FOUNDER_POS.x, 0, FOUNDER_POS.z);
    const desired = Math.atan2(look.x - g.position.x, look.z - g.position.z);
    g.rotation.y = THREE.MathUtils.lerp(g.rotation.y, desired, Math.min(1, dt * 5));
    g.position.y = seated ? 0 : moving ? Math.abs(Math.sin(t * 9)) * 0.05 : 0;

    const gest = view.gesture;
    const lean = gest === "lean_in" || isSpeaking ? 0.22 : gest === "cross_arms" ? -0.1 : 0;
    torso.current.rotation.x = THREE.MathUtils.lerp(torso.current.rotation.x, lean, dt * 4);
    // head motion
    let hx = 0, hy = 0, hz = 0;
    if (gest === "nod") hx = Math.sin(t * 6) * 0.15;
    if (gest === "head_shake") hy = Math.sin(t * 7) * 0.25;
    if (gest === "skeptical_tilt") hz = 0.22;
    if (gest === "take_notes") hx = 0.35;
    if (view.thinking) hy = Math.sin(t * 1.5 + index) * 0.2;
    if (isSpeaking) hx += Math.sin(t * 3) * 0.05;
    head.current.rotation.set(
      THREE.MathUtils.lerp(head.current.rotation.x, hx, dt * 6),
      THREE.MathUtils.lerp(head.current.rotation.y, hy, dt * 6),
      THREE.MathUtils.lerp(head.current.rotation.z, hz, dt * 6),
    );
    mouth.current.scale.y = isSpeaking ? 0.4 + Math.abs(Math.sin(t * 14)) * 1.4 : 0.3;
    // arms
    const crossed = gest === "cross_arms";
    const talkArm = isSpeaking ? Math.sin(t * 4) * 0.4 - 0.6 : 0;
    armL.current.rotation.x = THREE.MathUtils.lerp(armL.current.rotation.x, crossed ? -1.3 : seated ? -0.9 : 0, dt * 5);
    armL.current.rotation.z = THREE.MathUtils.lerp(armL.current.rotation.z, crossed ? -0.9 : 0.1, dt * 5);
    armR.current.rotation.x = THREE.MathUtils.lerp(armR.current.rotation.x, crossed ? -1.3 : talkArm || (seated ? -0.9 : 0), dt * 5);
    armR.current.rotation.z = THREE.MathUtils.lerp(armR.current.rotation.z, crossed ? 0.9 : -0.1, dt * 5);
    const hm = halo.current.material as THREE.MeshBasicMaterial;
    hm.opacity = THREE.MathUtils.lerp(hm.opacity, isSpeaking ? 0.55 : view.thinking ? 0.18 + Math.sin(t * 4) * 0.1 : 0, dt * 6);
  });

  const stancePct = (view.stance + 100) / 2;
  const stanceColor = view.stance > 25 ? "#34d399" : view.stance < -25 ? "#f87171" : "#fbbf24";
  const bodyY = seated ? 0.95 : 1.05;

  return (
    <group ref={root} position={seatPos(index)}>
      {/* glow ring on the floor when speaking/thinking */}
      <mesh ref={halo} rotation-x={-Math.PI / 2} position-y={0.02}>
        <ringGeometry args={[0.45, 0.62, 40]} />
        <meshBasicMaterial color={c.color} transparent opacity={0} />
      </mesh>
      {seated && (
        <group position={[0, 0, -0.32]}>
          <RoundedBox args={[0.62, 0.08, 0.55]} position={[0, 0.55, 0.25]} radius={0.03}>
            <meshStandardMaterial color="#27272a" />
          </RoundedBox>
          <RoundedBox args={[0.62, 0.8, 0.08]} position={[0, 0.95, 0]} radius={0.03}>
            <meshStandardMaterial color="#27272a" />
          </RoundedBox>
        </group>
      )}
      <group ref={torso} position={[0, bodyY - 0.35, 0]}>
        {/* body */}
        <mesh position={[0, 0.35, 0]} castShadow>
          <capsuleGeometry args={[0.24, 0.42, 6, 16]} />
          <meshStandardMaterial color={c.suit} roughness={0.7} />
        </mesh>
        {/* shirt + tie stripe */}
        <mesh position={[0, 0.5, 0.2]}>
          <boxGeometry args={[0.14, 0.28, 0.06]} />
          <meshStandardMaterial color="#f5f5f4" />
        </mesh>
        <mesh position={[0, 0.48, 0.235]}>
          <boxGeometry args={[0.05, 0.22, 0.02]} />
          <meshStandardMaterial color={c.color} />
        </mesh>
        {/* arms */}
        {[
          [armL, -0.31],
          [armR, 0.31],
        ].map(([ref, x], i) => (
          <group key={i} ref={ref as React.RefObject<THREE.Group>} position={[x as number, 0.62, 0]}>
            <mesh position={[0, -0.24, 0]} castShadow>
              <capsuleGeometry args={[0.075, 0.36, 4, 10]} />
              <meshStandardMaterial color={c.suit} roughness={0.7} />
            </mesh>
            <mesh position={[0, -0.5, 0]}>
              <sphereGeometry args={[0.07, 12, 12]} />
              <meshStandardMaterial color={c.skin} />
            </mesh>
          </group>
        ))}
        {/* head */}
        <group ref={head} position={[0, 0.95, 0]}>
          <mesh castShadow>
            <sphereGeometry args={[0.21, 24, 24]} />
            <meshStandardMaterial color={c.skin} roughness={0.6} />
          </mesh>
          <mesh position={[0, 0.09, -0.03]} scale={[1.05, 0.75, 1.05]}>
            <sphereGeometry args={[0.215, 24, 24, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color={c.hair} roughness={0.9} />
          </mesh>
          {[-0.075, 0.075].map((x) => (
            <mesh key={x} position={[x, 0.02, 0.19]}>
              <sphereGeometry args={[0.022, 10, 10]} />
              <meshStandardMaterial color="#111" />
            </mesh>
          ))}
          {c.glasses &&
            [-0.075, 0.075].map((x) => (
              <mesh key={`g${x}`} position={[x, 0.02, 0.2]}>
                <torusGeometry args={[0.045, 0.008, 8, 20]} />
                <meshStandardMaterial color="#0a0a0a" />
              </mesh>
            ))}
          <mesh ref={mouth} position={[0, -0.08, 0.195]}>
            <boxGeometry args={[0.07, 0.025, 0.01]} />
            <meshStandardMaterial color="#5b2b2b" />
          </mesh>
        </group>
      </group>
      <Html position={[0, seated ? 2.35 : 2.45, 0]} center distanceFactor={7} zIndexRange={[10, 0]}>
        <div className="tag">
          <div className="tag-name" style={{ color: c.color }}>
            {c.name}
            {view.thinking && <span className="dots">…</span>}
          </div>
          <div className="tag-role">{c.role}</div>
          <div className="meter">
            <div className="meter-fill" style={{ width: `${stancePct}%`, background: stanceColor }} />
          </div>
        </div>
      </Html>
      {speaking && (
        <Html position={[0, seated ? 2.95 : 3.05, 0]} center distanceFactor={7} zIndexRange={[20, 10]}>
          <div className="bubble" style={{ borderColor: c.color }}>
            {speaking}
          </div>
        </Html>
      )}
    </group>
  );
}

function TermSheetPaper({ terms }: { terms: Terms | null }) {
  const ref = useRef<THREE.Group>(null!);
  useFrame((_, dt) => {
    const target = terms ? new THREE.Vector3(0, 0.79, 0.9) : new THREE.Vector3(0, 0.79, -1.4);
    ref.current.position.lerp(target, Math.min(1, dt * 1.2));
    ref.current.visible = Boolean(terms);
  });
  return (
    <group ref={ref} position={[0, 0.79, -1.4]}>
      <mesh rotation-x={-Math.PI / 2} castShadow>
        <planeGeometry args={[0.5, 0.68]} />
        <meshStandardMaterial color="#fafaf9" side={THREE.DoubleSide} />
      </mesh>
      {[0.2, 0.12, 0.04, -0.04, -0.12].map((z, i) => (
        <mesh key={i} rotation-x={-Math.PI / 2} position={[0, 0.002, -z]}>
          <planeGeometry args={[i === 0 ? 0.3 : 0.38, 0.018]} />
          <meshBasicMaterial color={i === 0 ? "#111" : "#a8a29e"} />
        </mesh>
      ))}
    </group>
  );
}

function CameraRig({ phase }: { phase: Phase }) {
  const { camera } = useThree();
  const lookAt = useRef(new THREE.Vector3(0, 1.2, -0.6));
  useFrame((_, dt) => {
    const outside = phase === "huddle";
    const pos = outside ? new THREE.Vector3(1.6, 2.4, 6.6) : new THREE.Vector3(0, 2.35, 5.4);
    const look = outside ? new THREE.Vector3(-2.8, 1.1, -2.2) : new THREE.Vector3(0, 1.25, -0.7);
    camera.position.lerp(pos, Math.min(1, dt * 1.2));
    lookAt.current.lerp(look, Math.min(1, dt * 1.2));
    camera.lookAt(lookAt.current);
  });
  return null;
}

function Office({ phase }: { phase: Phase }) {
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[30, 30]} />
        <meshStandardMaterial color="#1c1917" roughness={0.95} />
      </mesh>
      {/* table */}
      <mesh position={[0, 0.74, -0.2]} scale={[3.0, 1, 1.5]} castShadow receiveShadow>
        <cylinderGeometry args={[1, 1, 0.07, 64]} />
        <meshStandardMaterial color="#3f2d20" roughness={0.35} metalness={0.1} />
      </mesh>
      <mesh position={[0, 0.37, -0.2]}>
        <cylinderGeometry args={[0.25, 0.4, 0.7, 24]} />
        <meshStandardMaterial color="#18181b" />
      </mesh>
      {/* back wall with firm name */}
      <mesh position={[0, 2.2, -4.6]} receiveShadow>
        <planeGeometry args={[14, 4.4]} />
        <meshStandardMaterial color="#292524" />
      </mesh>
      <Html position={[0, 3.55, -4.55]} transform distanceFactor={4} occlude={false}>
        <div className="firm">COPPERLINE VENTURES</div>
      </Html>
      {/* glass wall between the founder's waiting area and the room */}
      <mesh position={[0, 1.6, 4.4]}>
        <planeGeometry args={[14, 3.2]} />
        <meshPhysicalMaterial color="#9ca3af" transparent opacity={phase === "huddle" ? 0.16 : 0.04} roughness={0.05} />
      </mesh>
      {/* plants */}
      {[-5.2, 5.2].map((x) => (
        <group key={x} position={[x, 0, -3.8]}>
          <mesh position={[0, 0.3, 0]}>
            <cylinderGeometry args={[0.25, 0.2, 0.6, 16]} />
            <meshStandardMaterial color="#44403c" />
          </mesh>
          <mesh position={[0, 1.0, 0]}>
            <sphereGeometry args={[0.55, 16, 16]} />
            <meshStandardMaterial color="#166534" roughness={0.9} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

export default function Room(props: {
  agents: Record<AgentId, AgentView>;
  phase: Phase;
  speaking: { speaker: AgentId; text: string } | null;
  terms: Terms | null;
}) {
  return (
    <Canvas shadows camera={{ position: [0, 2.35, 5.4], fov: 50 }} dpr={[1, 2]}>
      <color attach="background" args={["#0c0a09"]} />
      <fog attach="fog" args={["#0c0a09", 9, 20]} />
      <ambientLight intensity={0.45} />
      <directionalLight position={[3, 6, 4]} intensity={1.3} castShadow shadow-mapSize={[1024, 1024]} />
      <pointLight position={[0, 3.2, -0.3]} intensity={12} color="#fde68a" distance={8} />
      <CameraRig phase={props.phase} />
      <Office phase={props.phase} />
      {SEAT_ORDER.map((id, i) => (
        <Avatar
          key={id}
          id={id}
          index={i}
          view={props.agents[id]}
          phase={props.phase}
          speaking={props.speaking?.speaker === id ? props.speaking.text : null}
        />
      ))}
      <TermSheetPaper terms={props.phase === "termsheet" || props.phase === "closed" ? props.terms : null} />
      <ContactShadows position={[0, 0.01, 0]} opacity={0.5} scale={14} blur={2.4} far={4} />
    </Canvas>
  );
}
