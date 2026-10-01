import { useEffect, useEffectEvent, useRef } from "react";
import { useTranslation } from "react-i18next";
import { nodeTypeColor, type ChartColors } from "../stats/chartTheme";
import { DEFAULT_CAMERA, FLOW_MS, project, flowColor, linkContext, type LiveTraffic, type Point3, type Topology } from "./topology";

function createRenderer(canvas: HTMLCanvasElement, graph: Topology, traffic: LiveTraffic, colors: ChartColors, select: (id: string) => void) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  let camera = { ...DEFAULT_CAMERA };
  let width = 1, height = 1, frame = 0, previousFrame = 0;
  let running = true, motion = true, selected = "", dirty = true;
  let projected: { id: string; x: number; y: number; depth: number }[] = [];
  let related = new Set<string>();
  const pointers = new Map<number, { x: number; y: number }>();
  let moved = false, start = { x: 0, y: 0 };
  const extent = Math.max(220, ...graph.nodes.map(n => Math.hypot(n.x, n.y, n.z)));
  const p = (point: Point3) => project(point, camera, width, height, extent);
  const line = (a: Point3, b: Point3) => { const from = p(a), to = p(b); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); };
  const wake = () => { dirty = true; if (!frame && running && !document.hidden) frame = requestAnimationFrame(draw); };

  function draw(now: number) {
    frame = 0;
    if (!running || document.hidden) return;
    const flows = motion ? traffic.flows.filter(r => Date.now() - r.at < FLOW_MS) : [];
    // A fixed 30 fps ceiling and capped pixel ratio bound work on phones and large meshes.
    if (!dirty && flows.length && now - previousFrame < 32) { if (flows.length) frame = requestAnimationFrame(draw); return; }
    previousFrame = now;
    dirty = false;
    ctx!.clearRect(0, 0, width, height);
    ctx!.fillStyle = colors.bgBase;
    ctx!.fillRect(0, 0, width, height);
    ctx!.lineWidth = 1;
    ctx!.strokeStyle = colors.borderSubtle;
    ctx!.globalAlpha = 0.65;
    ctx!.beginPath();
    for (let i = -6; i <= 6; i++) {
      const v = extent * i / 6;
      line({ x: v, y: -160, z: -extent }, { x: v, y: -160, z: extent });
      line({ x: -extent, y: -160, z: v }, { x: extent, y: -160, z: v });
    }
    ctx!.stroke();
    ctx!.globalAlpha = 0.32;
    ctx!.strokeStyle = colors.primary;
    for (const region of graph.regions) {
      ctx!.beginPath();
      for (let i = 0; i <= 32; i++) {
        const q = p({ x: region.x + Math.cos(i * Math.PI / 16) * 155, y: region.y, z: region.z + Math.sin(i * Math.PI / 16) * 155 });
        if (i === 0) ctx!.moveTo(q.x, q.y); else ctx!.lineTo(q.x, q.y);
      }
      ctx!.stroke();
    }
    for (const [a, b] of graph.links) {
      const lit = selected === a || selected === b;
      const context = linkContext(graph.byId.get(a)!, graph.byId.get(b)!);
      ctx!.globalAlpha = selected ? (lit ? 0.7 : 0.035) : 0.16;
      ctx!.strokeStyle = context.sharedDefault ? colors.green : context.crossRegion ? colors.primary : lit ? colors.textBright : colors.textMuted;
      ctx!.setLineDash(context.crossRegion ? [3, 4] : []);
      ctx!.lineWidth = lit ? 1.6 : 0.7;
      ctx!.beginPath(); line(graph.byId.get(a)!, graph.byId.get(b)!); ctx!.stroke();
    }
    ctx!.setLineDash([]);
    projected = graph.nodes.map(n => ({ id: n.id, ...p(n) })).sort((a, b) => b.depth - a.depth);
    for (const q of projected) {
      if (q.x < -10 || q.x > width + 10 || q.y < -10 || q.y > height + 10) continue;
      const n = graph.byId.get(q.id)!;
      const lit = related.has(n.id);
      const radius = n.id === selected ? 6 : Math.min(4.8, 2 + Math.log2(1 + n.knownNeighborCount) * 0.4);
      ctx!.globalAlpha = selected && !lit ? 0.16 : n.stale ? 0.4 : 0.9;
      ctx!.fillStyle = nodeTypeColor(n.nodeTypeName, colors);
      ctx!.beginPath();
      if (n.nodeTypeName === "companion") { ctx!.moveTo(q.x, q.y - radius); ctx!.lineTo(q.x + radius, q.y + radius); ctx!.lineTo(q.x - radius, q.y + radius); ctx!.closePath(); }
      else if (n.nodeTypeName === "room_server" || n.nodeTypeName === "sensor") ctx!.rect(q.x - radius, q.y - radius, radius * 2, radius * 2);
      else ctx!.arc(q.x, q.y, radius, 0, Math.PI * 2);
      ctx!.fill();
      if (n.isObserver || n.id === selected) { ctx!.strokeStyle = n.id === selected ? colors.textBright : colors.primary; ctx!.lineWidth = 1.2; ctx!.beginPath(); ctx!.arc(q.x, q.y, radius + 3, 0, Math.PI * 2); ctx!.stroke(); }
    }
    // Observed paths are transient overlays, never inserted into the stored-neighbour graph.
    for (const report of flows) {
      const progress = Math.min(1, (Date.now() - report.at) / FLOW_MS);
      const segmentIndex = Math.min(report.segments.length - 1, Math.floor(progress * report.segments.length));
      const pair = report.segments[segmentIndex];
      if (!pair) continue;
      const a = graph.byId.get(pair[0]), b = graph.byId.get(pair[1]);
      if (!a || !b) continue;
      const from = p(a), to = p(b);
      const fraction = progress * report.segments.length - segmentIndex;
      const x = from.x + (to.x - from.x) * fraction, y = from.y + (to.y - from.y) * fraction;
      ctx!.strokeStyle = flowColor(report.kind, colors);
      ctx!.globalAlpha = 0.55;
      ctx!.lineWidth = 1.5;
      ctx!.beginPath(); ctx!.moveTo(from.x, from.y); ctx!.lineTo(to.x, to.y); ctx!.stroke();
      ctx!.globalAlpha = 0.2; ctx!.fillStyle = flowColor(report.kind, colors);
      ctx!.beginPath(); ctx!.arc(x, y, 8, 0, Math.PI * 2); ctx!.fill();
      ctx!.globalAlpha = 1; ctx!.beginPath(); ctx!.arc(x, y, 2.8, 0, Math.PI * 2); ctx!.fill();
    }
    ctx!.globalAlpha = 1;
    ctx!.font = "600 11px Inter, sans-serif";
    ctx!.textAlign = "center";
    for (const region of graph.regions) {
      const q = p({ ...region, z: region.z + 165 });
      const label = `${region.code} · ${region.count}`;
      const w = ctx!.measureText(label).width + 16;
      ctx!.fillStyle = colors.bgRaised; ctx!.fillRect(q.x - w / 2, q.y - 10, w, 20);
      ctx!.fillStyle = colors.textBright; ctx!.fillText(label, q.x, q.y + 4);
    }
    const selectedPoint = projected.find(n => n.id === selected);
    if (selectedPoint) {
      const label = (graph.byId.get(selected)!.name || selected.slice(0, 8)).slice(0, 40);
      ctx!.font = "600 12px Inter, sans-serif";
      const w = ctx!.measureText(label).width + 16;
      ctx!.fillStyle = colors.bgSurface; ctx!.fillRect(selectedPoint.x - w / 2, selectedPoint.y - 34, w, 22);
      ctx!.fillStyle = colors.textBright; ctx!.fillText(label, selectedPoint.x, selectedPoint.y - 19);
    }
    if (flows.length) frame = requestAnimationFrame(draw);
  }

  function resize() {
    const box = canvas.getBoundingClientRect(); width = box.width; height = box.height;
    const ratio = Math.min(window.devicePixelRatio || 1, width < 600 ? 1.25 : 1.5);
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    ctx!.setTransform(ratio, 0, 0, ratio, 0, 0); wake();
  }
  function zoom(factor: number) { camera.zoom = Math.max(0.35, Math.min(8, camera.zoom * factor)); wake(); }
  function down(e: PointerEvent) { start = { x: e.clientX, y: e.clientY }; moved = false; pointers.set(e.pointerId, start); canvas.setPointerCapture(e.pointerId); }
  function move(e: PointerEvent) {
    const old = pointers.get(e.pointerId); if (!old) return;
    const other = [...pointers].find(([id]) => id !== e.pointerId)?.[1];
    if (other) { const before = Math.hypot(old.x - other.x, old.y - other.y); const after = Math.hypot(e.clientX - other.x, e.clientY - other.y); if (before > 5) zoom(after / before); moved = true; }
    else { camera.yaw += (e.clientX - old.x) * 0.008; camera.pitch = Math.max(-1.2, Math.min(1.2, camera.pitch + (e.clientY - old.y) * 0.008)); }
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 5) moved = true;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); wake();
  }
  function up(e: PointerEvent) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (moved || e.type === "pointercancel") return;
    const box = canvas.getBoundingClientRect(), x = e.clientX - box.left, y = e.clientY - box.top;
    const hit = [...projected].reverse().find(n => Math.hypot(n.x - x, n.y - y) <= 10);
    if (hit) select(hit.id);
  }
  function wheel(e: WheelEvent) { e.preventDefault(); zoom(Math.exp(-Math.sign(e.deltaY) * 0.12)); }
  function key(e: KeyboardEvent) {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "=", "-", "Home"].includes(e.key)) return;
    e.preventDefault();
    if (e.key === "Home") camera = { ...DEFAULT_CAMERA };
    else if (e.key === "+" || e.key === "=") zoom(1.2);
    else if (e.key === "-") zoom(1 / 1.2);
    else { camera.yaw += e.key === "ArrowLeft" ? -0.15 : e.key === "ArrowRight" ? 0.15 : 0; camera.pitch = Math.max(-1.2, Math.min(1.2, camera.pitch + (e.key === "ArrowUp" ? -0.15 : e.key === "ArrowDown" ? 0.15 : 0))); }
    wake();
  }
  function visibility() { pointers.clear(); if (document.hidden) { cancelAnimationFrame(frame); frame = 0; } else wake(); }
  const observer = new ResizeObserver(resize); observer.observe(canvas); resize();
  canvas.addEventListener("pointerdown", down); canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("wheel", wheel, { passive: false }); canvas.addEventListener("keydown", key);
  document.addEventListener("visibilitychange", visibility);
  return {
    update(id: string, animate: boolean, active: boolean) {
      selected = id; motion = animate; running = active;
      related = new Set([id]);
      for (const [a, b] of graph.links) { if (a === id) related.add(b); if (b === id) related.add(a); }
      if (!running) { cancelAnimationFrame(frame); frame = 0; } else wake();
    },
    zoom, reset() { camera = { ...DEFAULT_CAMERA }; wake(); },
    dispose() {
      running = false; cancelAnimationFrame(frame); observer.disconnect();
      canvas.removeEventListener("pointerdown", down); canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up); canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("wheel", wheel); canvas.removeEventListener("keydown", key);
      document.removeEventListener("visibilitychange", visibility);
    },
  };
}

export function TopologyCanvas({ graph, traffic, colors, selected, onSelect, motion, active, tick }: { graph: Topology; traffic: LiveTraffic; colors: ChartColors; selected: string; onSelect: (id: string) => void; motion: boolean; active: boolean; tick: number }) {
  const { t } = useTranslation();
  const canvas = useRef<HTMLCanvasElement>(null);
  const selectNode = useEffectEvent(onSelect);
  const renderer = useRef<ReturnType<typeof createRenderer>>(null);
  useEffect(() => {
    if (!canvas.current) return;
    renderer.current = createRenderer(canvas.current, graph, traffic, colors, id => selectNode(id));
    return () => { renderer.current?.dispose(); renderer.current = null; };
  }, [graph, traffic, colors]);
  useEffect(() => { renderer.current?.update(selected, motion, active); }, [selected, motion, active, tick, graph, colors]);
  return <div className="relative min-w-0 overflow-hidden rounded-xl border border-border bg-bg-base">
    <canvas ref={canvas} tabIndex={0} aria-label={t("topology.canvas")} className="block h-[52vh] min-h-80 w-full touch-none cursor-grab focus-visible:outline-offset-[-3px] lg:h-[calc(100dvh-350px)] lg:max-h-[650px]" />
    <div className="absolute left-3 top-3 pointer-events-none rounded border border-border bg-bg-surface/90 px-2 py-1 font-mono text-[10px] text-text-normal">{t("topology.projection")}</div>
    <div className="absolute bottom-3 right-3 flex gap-1">
      <button className="min-h-11 min-w-11 rounded border border-border bg-bg-surface text-text-bright" aria-label={t("topology.zoomIn")} onClick={() => renderer.current?.zoom(1.3)}>+</button>
      <button className="min-h-11 min-w-11 rounded border border-border bg-bg-surface text-text-bright" aria-label={t("topology.zoomOut")} onClick={() => renderer.current?.zoom(1 / 1.3)}>−</button>
      <button className="min-h-11 rounded border border-border bg-bg-surface px-3 text-xs text-text-bright" onClick={() => renderer.current?.reset()}>{t("topology.fit")}</button>
    </div>
    <p className="pointer-events-none absolute bottom-3 left-3 max-w-[45%] text-[10px] text-text-normal">{t("topology.controls")}</p>
  </div>;
}
