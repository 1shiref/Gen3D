import { useEffect, useMemo, useState } from "react";
import { TransformControls, Html } from "@react-three/drei";
import * as THREE from "three";
import { Move, Rotate3D, Scale3D } from "lucide-react";
import { useMeshEditStore } from "@/stores/meshEditStore";
import { useViewerStore } from "@/stores/viewerStore";
import { FEATURES, featurePreview } from "@/lib/mesh-edit/features";
import { holeBaseQuaternion, holeOrientation } from "@/lib/mesh-edit/operations";

type Axis = "x" | "y" | "z";

/** Per-axis [min,max] of the seated model (centered X/Z, base at y=0). */
function axisRange(axis: Axis, b: { x: number; y: number; z: number }): [number, number] {
  if (axis === "x") return [-b.x / 2, b.x / 2];
  if (axis === "z") return [-b.z / 2, b.z / 2];
  return [0, b.y];
}

/** Shared translucent material for the live "what you'll get" ghost. */
const GHOST_COLOR = "#f59e0b";

/**
 * In-viewport handles + live preview for every "Edit in 3D" draft. Dispatches on the
 * feature's `draftKind`:
 *  - rotate / scale / scaleAxes / resize: a live full-geometry ghost + a gizmo that drives the param.
 *  - mirror / seat: a live full-geometry ghost (the axis dropdown drives it; no drag handle).
 *  - hole: a translucent red ghost bore, transformable in-view (move/rotate/scale).
 *  - split: a translucent, draggable cut plane (locked to the cut axis).
 */
export default function DraftHandles() {
  const draftFeature = useMeshEditStore((s) => s.draft?.feature);
  const kind = draftFeature ? FEATURES[draftFeature]?.draftKind : undefined;
  if (!draftFeature || !kind) return null;

  switch (kind) {
    case "rotate":
    case "scale":
    case "scaleAxes":
    case "resize":
      return <TransformGhost withGizmo />;
    case "mirror":
    case "seat":
      return <TransformGhost withGizmo={false} />;
    case "hole":
      return <HoleHandles />;
    case "split":
      return <SplitHandles />;
    default:
      return null;
  }
}

/** The current display geometry being edited (reactive). */
function useCurrentGeometry(): THREE.BufferGeometry | null {
  return useMeshEditStore((s) => s.workingGeometry ?? s.baseGeometry);
}

/** A small screen-space measurement label anchored at a point in the scene. */
function Label({ position, text }: { position: [number, number, number]; text: string }) {
  return (
    <Html position={position} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
      <div className="px-1.5 py-0.5 rounded bg-black/80 text-white text-[10px] font-medium whitespace-nowrap select-none">
        {text}
      </div>
    </Html>
  );
}

/** A translucent overlay mesh, owning + disposing its ghost geometry. */
function Ghost({ geometry }: { geometry: THREE.BufferGeometry | null }) {
  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (!geometry) return null;
  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial
        color={GHOST_COLOR}
        transparent
        opacity={0.35}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

// ─── Transform ghost (+ optional gizmo) ────────────────────────────────────────
function TransformGhost({ withGizmo }: { withGizmo: boolean }) {
  const feature = useMeshEditStore((s) => s.draft!.feature);
  const params = useMeshEditStore((s) => s.draft!.params);
  const update = useMeshEditStore((s) => s.updateDraftParam);
  const bounds = useViewerStore((s) => s.modelBounds);
  const cur = useCurrentGeometry();
  const [obj, setObj] = useState<THREE.Object3D | null>(null);

  const kind = FEATURES[feature]?.draftKind;
  const axis = (params.axis as Axis) ?? (params.downAxis as Axis) ?? "y";

  // Live ghost = the feature's own result (matrix ops are cheap). Re-memoized on param change.
  const ghost = useMemo(
    () => (cur ? featurePreview(cur, feature, params) : null),
    [cur, feature, JSON.stringify(params)],
  );

  if (!cur) return null;

  // Gizmo proxy sits at the model center so the handles land on the model.
  const center: [number, number, number] = bounds ? [0, bounds.y / 2, 0] : [0, 0, 0];

  // Map the proxy's transform → the feature's numeric param (proxy is the source during a drag).
  const onChange = () => {
    if (!obj) return;
    if (kind === "rotate") {
      const rad = axis === "x" ? obj.rotation.x : axis === "y" ? obj.rotation.y : obj.rotation.z;
      update("deg", Number(((rad * 180) / Math.PI).toFixed(1)));
    } else if (kind === "scale") {
      // Uniform: follow whichever axis the user pulled furthest from 1 (incl. the center handle).
      const dev = (["x", "y", "z"] as const).reduce((a, ax) =>
        Math.abs(obj.scale[ax] - 1) > Math.abs(obj.scale[a] - 1) ? ax : a, "x" as "x" | "y" | "z");
      update("factor", Number(obj.scale[dev].toFixed(3)));
    } else if (kind === "scaleAxes") {
      update("sx", Number(obj.scale.x.toFixed(3)));
      update("sy", Number(obj.scale.y.toFixed(3)));
      update("sz", Number(obj.scale.z.toFixed(3)));
    } else if (kind === "resize") {
      const ai = axis === "x" ? "x" : axis === "y" ? "y" : "z";
      const curSize = bounds ? bounds[ai] : 1;
      update("mm", Number((obj.scale[ai] * curSize).toFixed(1)));
    }
  };

  // Controlled proxy transform derived from the params (keeps gizmo and ghost in sync).
  const rotation: [number, number, number] =
    kind === "rotate"
      ? [
          axis === "x" ? ((params.deg as number) * Math.PI) / 180 : 0,
          axis === "y" ? ((params.deg as number) * Math.PI) / 180 : 0,
          axis === "z" ? ((params.deg as number) * Math.PI) / 180 : 0,
        ]
      : [0, 0, 0];

  let scale: [number, number, number] = [1, 1, 1];
  if (kind === "scale") {
    const f = (params.factor as number) || 1;
    scale = [f, f, f];
  } else if (kind === "scaleAxes") {
    scale = [(params.sx as number) || 1, (params.sy as number) || 1, (params.sz as number) || 1];
  } else if (kind === "resize") {
    const ai = axis === "x" ? "x" : axis === "y" ? "y" : "z";
    const curSize = bounds ? bounds[ai] : 1;
    const f = curSize > 0 ? ((params.mm as number) || curSize) / curSize : 1;
    scale = [axis === "x" ? f : 1, axis === "y" ? f : 1, axis === "z" ? f : 1];
  }

  // Live measurement label describing what Apply will do.
  let labelText = "";
  if (kind === "rotate") labelText = `${Math.round((params.deg as number) || 0)}° · ${axis.toUpperCase()}`;
  else if (kind === "scale") labelText = `×${((params.factor as number) || 1).toFixed(2)}`;
  else if (kind === "scaleAxes")
    labelText = `×${((params.sx as number) || 1).toFixed(2)}, ${((params.sy as number) || 1).toFixed(2)}, ${((params.sz as number) || 1).toFixed(2)}`;
  else if (kind === "resize") labelText = `${((params.mm as number) || 0).toFixed(1)} mm · ${axis.toUpperCase()}`;
  else if (kind === "mirror") labelText = `mirror · ${axis.toUpperCase()}`;
  const labelY = bounds ? bounds.y + Math.max(bounds.y * 0.12, 4) : 4;

  return (
    <>
      <Ghost geometry={ghost} />
      {labelText && <Label position={[0, labelY, 0]} text={labelText} />}
      {withGizmo && (
        <>
          <mesh ref={setObj} position={center} rotation={rotation} scale={scale} visible={false}>
            <boxGeometry args={[1, 1, 1]} />
          </mesh>
          {obj && (
            <TransformControls
              object={obj}
              mode={kind === "rotate" ? "rotate" : "scale"}
              // rotate/resize lock to the chosen axis; scale (uniform) + scaleAxes use all handles.
              showX={kind === "rotate" || kind === "resize" ? axis === "x" : true}
              showY={kind === "rotate" || kind === "resize" ? axis === "y" : true}
              showZ={kind === "rotate" || kind === "resize" ? axis === "z" : true}
              onObjectChange={onChange}
            />
          )}
        </>
      )}
    </>
  );
}

// ─── Split: draggable cut plane ────────────────────────────────────────────────
function SplitHandles() {
  const params = useMeshEditStore((s) => s.draft!.params);
  const update = useMeshEditStore((s) => s.updateDraftParam);
  const bounds = useViewerStore((s) => s.modelBounds);
  const [obj, setObj] = useState<THREE.Object3D | null>(null);
  const axis = (params.axis as Axis) ?? "z";

  // Seed the split cut to the model midpoint the first time (0 = "even" sentinel).
  useEffect(() => {
    if (!bounds) return;
    if ((params.cut as number) === 0) {
      const [min, max] = axisRange(axis, bounds);
      update("cut", (min + max) / 2);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!bounds) return null;

  const cut = (params.cut as number) || (axisRange(axis, bounds)[0] + axisRange(axis, bounds)[1]) / 2;
  const planePos: [number, number, number] =
    axis === "x" ? [cut, bounds.y / 2, 0] : axis === "z" ? [0, bounds.y / 2, cut] : [0, cut, 0];
  const rot: [number, number, number] =
    axis === "x" ? [0, Math.PI / 2, 0] : axis === "y" ? [-Math.PI / 2, 0, 0] : [0, 0, 0];
  const planeW = axis === "x" ? bounds.z : bounds.x;
  const planeH = axis === "y" ? bounds.z : bounds.y;

  const onChange = () => {
    if (!obj) return;
    update("cut", axis === "x" ? obj.position.x : axis === "y" ? obj.position.y : obj.position.z);
  };

  return (
    <>
      <mesh ref={setObj} position={planePos} rotation={rot}>
        <planeGeometry args={[planeW * 1.15, planeH * 1.15]} />
        <meshBasicMaterial color="#22d3ee" transparent opacity={0.25} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {obj && (
        <TransformControls
          object={obj}
          mode="translate"
          showX={axis === "x"}
          showY={axis === "y"}
          showZ={axis === "z"}
          onObjectChange={onChange}
        />
      )}
      <Label
        position={[planePos[0], planePos[1] + planeH * 0.6, planePos[2]]}
        text={`cut @ ${cut.toFixed(1)} mm · ${axis.toUpperCase()}${params.addPins === true ? "" : " · no pins"}`}
      />
    </>
  );
}

// ─── Hole: ghost bore, transformable in-view (move / rotate / scale) ────────────
/** Sizes frozen at the start of a scale drag so the gizmo's live scale doesn't
 *  compound with the geometry that's also growing from the updated params. */
interface ScaleBase { dia: number; w: number; h: number; depth: number }

const HOLE_MODES = [
  { mode: "translate" as const, label: "Move", icon: Move },
  { mode: "rotate" as const, label: "Rotate", icon: Rotate3D },
  { mode: "scale" as const, label: "Scale", icon: Scale3D },
];

function HoleHandles() {
  const params = useMeshEditStore((s) => s.draft!.params);
  const update = useMeshEditStore((s) => s.updateDraftParam);
  const bounds = useViewerStore((s) => s.modelBounds);
  const [obj, setObj] = useState<THREE.Object3D | null>(null);
  const [mode, setMode] = useState<"translate" | "rotate" | "scale">("translate");
  // Non-null only while a scale drag is in progress (freezes the ghost size).
  const [scaleBase, setScaleBase] = useState<ScaleBase | null>(null);
  const axis = (params.axis as Axis) ?? "z";
  const baseQ = useMemo(() => holeBaseQuaternion(axis), [axis]);

  if (!bounds) return null;

  const shape = (params.shape as string) ?? "cylinder";
  const depth = (params.depth as number) ?? 0;
  const rx = (params.rx as number) ?? 0;
  const ry = (params.ry as number) ?? 0;
  const rz = (params.rz as number) ?? 0;

  // While scaling, draw from the frozen base size; otherwise track the live params.
  const dia = scaleBase ? scaleBase.dia : ((params.diameter as number) ?? 5);
  const w = scaleBase ? scaleBase.w : ((params.width as number) ?? 5);
  const h = scaleBase ? scaleBase.h : ((params.height as number) ?? 5);
  const length = depth > 0 ? depth : Math.max(bounds.x, bounds.y, bounds.z) * 2 + 10;

  const pos: [number, number, number] = [
    (params.x as number) ?? 0,
    (params.y as number) ?? bounds.y / 2,
    (params.z as number) ?? 0,
  ];
  const q = holeOrientation(axis, rx, ry, rz);

  const onChange = () => {
    if (!obj) return;
    if (mode === "translate") {
      update("x", Number(obj.position.x.toFixed(2)));
      update("y", Number(obj.position.y.toFixed(2)));
      update("z", Number(obj.position.z.toFixed(2)));
    } else if (mode === "rotate") {
      // Strip the base orientation back out so params hold only the user's tilt.
      const tilt = obj.quaternion.clone().multiply(baseQ.clone().invert());
      const e = new THREE.Euler().setFromQuaternion(tilt, "XYZ");
      update("rx", Number(((e.x * 180) / Math.PI).toFixed(1)));
      update("ry", Number(((e.y * 180) / Math.PI).toFixed(1)));
      update("rz", Number(((e.z * 180) / Math.PI).toFixed(1)));
    } else if (scaleBase) {
      if (shape === "box") {
        update("width", Number((scaleBase.w * obj.scale.x).toFixed(2)));
        update("height", Number((scaleBase.h * obj.scale.z).toFixed(2)));
      } else {
        // Radial scale = the two axes perpendicular to the bore (local X/Z).
        update("diameter", Number((scaleBase.dia * Math.max(obj.scale.x, obj.scale.z)).toFixed(2)));
      }
      // Axial scale only deepens a blind hole; a through-hole stays through.
      if (scaleBase.depth > 0) update("depth", Number((scaleBase.depth * obj.scale.y).toFixed(2)));
    }
  };

  // Freeze sizes + reset proxy scale to 1 when a scale drag begins; bake on release.
  const onMouseDown = () => {
    if (mode !== "scale" || !obj) return;
    obj.scale.set(1, 1, 1);
    setScaleBase({
      dia: (params.diameter as number) ?? 5,
      w: (params.width as number) ?? 5,
      h: (params.height as number) ?? 5,
      depth,
    });
  };
  const onMouseUp = () => {
    if (!obj) return;
    obj.scale.set(1, 1, 1);
    if (scaleBase) setScaleBase(null);
  };

  const depthText = depth > 0 ? `${depth.toFixed(1)} mm deep` : "through";
  const sizeText = shape === "box" ? `${w.toFixed(1)} × ${h.toFixed(1)}` : `Ø${dia.toFixed(1)}`;
  const tiltText = rx || ry || rz ? ` · tilt ${Math.round(rx)},${Math.round(ry)},${Math.round(rz)}°` : "";

  return (
    <>
      <mesh ref={setObj} position={pos} quaternion={[q.x, q.y, q.z, q.w]}>
        {shape === "box" ? (
          <boxGeometry args={[w, length, h]} />
        ) : (
          <cylinderGeometry args={[dia / 2, dia / 2, length, 32]} />
        )}
        <meshBasicMaterial color="#ef4444" transparent opacity={0.35} depthWrite={false} />
      </mesh>
      {obj && (
        <TransformControls
          object={obj}
          mode={mode}
          onObjectChange={onChange}
          onMouseDown={onMouseDown}
          onMouseUp={onMouseUp}
        />
      )}
      {/* Move / Rotate / Scale switch anchored above the bore. */}
      <Html position={[pos[0], pos[1] + bounds.y * 0.12 + 9, pos[2]]} center zIndexRange={[30, 0]}>
        <div className="flex gap-0.5 p-0.5 rounded bg-black/80 select-none">
          {HOLE_MODES.map(({ mode: m, label, icon: Icon }) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              title={label}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                mode === m ? "bg-primary text-primary-foreground" : "text-white/80 hover:bg-white/10"
              }`}
            >
              <Icon className="w-3 h-3" /> {label}
            </button>
          ))}
        </div>
      </Html>
      <Label position={[pos[0], pos[1] + bounds.y * 0.12 + 4, pos[2]]} text={`${sizeText} · ${axis.toUpperCase()} · ${depthText}${tiltText}`} />
    </>
  );
}
