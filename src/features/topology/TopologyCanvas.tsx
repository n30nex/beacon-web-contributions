import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import type { IataCode } from "../../types/api";
import { useTranslation } from "react-i18next";
import type { ChartColors } from "../stats/chartTheme";
import type { PathDisplay, LiveTraffic, Topology } from "./topology";
import { createRenderer, type CameraView } from "./topology-renderer";

export function TopologyCanvas({ graph, traffic, colors, selected, onSelect, region, onRegion, isolated, onIsolate, regions, controls, settings, motion, active, tick }: { graph: Topology; traffic: LiveTraffic; colors: ChartColors; selected: string; onSelect: (id: string) => void; region: string; onRegion: (code: string) => void; isolated: string; onIsolate: (code: string) => void; regions: IataCode[]; controls: ReactNode; settings: ReactNode; motion: boolean; active: boolean; tick: number }) {
  const { t } = useTranslation();
  const canvas = useRef<HTMLCanvasElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const displayMenu = useRef<HTMLDetailsElement>(null);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const change = () => setExpanded(document.fullscreenElement === panel.current);
    document.addEventListener("fullscreenchange", change);
    return () => document.removeEventListener("fullscreenchange", change);
  }, []);
  const selectNode = useEffectEvent(onSelect);
  const selectRegion = useEffectEvent((code: string) => { if (!code && isolated) onIsolate(""); else onRegion(code); });
  const [display, setDisplay] = useState<PathDisplay>("all");
  useEffect(() => {
    const close = (event: PointerEvent) => { if (displayMenu.current && !displayMenu.current.contains(event.target as Node)) displayMenu.current.open = false; };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  const renderer = useRef<ReturnType<typeof createRenderer>>(null);
  const cameraView = useRef<CameraView | undefined>(undefined);
  useEffect(() => {
    if (!canvas.current) return;
    renderer.current = createRenderer(canvas.current, graph, traffic, colors, id => selectNode(id), code => selectRegion(code), cameraView.current);
    return () => { if (graph.nodes.length) cameraView.current = renderer.current?.view(); renderer.current?.dispose(); renderer.current = null; };
  }, [graph, traffic, colors]);
  useEffect(() => { renderer.current?.update(selected, region, selected || display !== "selected" ? display : "all", motion, active); }, [selected, region, display, motion, active, tick, graph, colors]);
  const button = "min-h-11 rounded border border-border bg-bg-surface px-3 text-xs text-text-bright hover:border-primary";
  const choices = [...new Map([...graph.regions.map(r => ({ iata: r.code } as IataCode)), ...regions].map(r => [r.iata, r])).values()].sort((a, b) => a.iata.localeCompare(b.iata));
  return <div ref={panel} className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-bg-base ${expanded ? "h-dvh" : "h-full"}`}>
    <div className="relative z-10 flex flex-wrap items-center gap-2 border-b border-border bg-bg-surface p-2">
      <select className={`${button} min-w-0 max-w-48`} aria-label={t("topology.region")} value={isolated || region} onChange={e => onIsolate(e.target.value)}><option value="">{t("topology.allRegions")}</option>{choices.map(r => <option key={r.iata} value={r.iata} disabled={r.iata === "?"}>{r.iata}{r.displayName ? ` · ${r.displayName}` : ""}</option>)}</select>
      {region && region !== "?" && !isolated && <button className={button} onClick={() => onIsolate(region)}>{t("topology.isolate", { region })}</button>}
      {isolated && <button className={button} onClick={() => onIsolate("")}>{t("topology.showAllRegions")}</button>}
      {controls}
      <details ref={displayMenu} className="ml-auto sm:relative" onKeyDown={e => { if (e.key === "Escape" && e.currentTarget.open) { e.preventDefault(); e.currentTarget.open = false; e.currentTarget.querySelector("summary")?.focus(); } }}>
        <summary className={`${button} cursor-pointer content-center`}>{t("topology.display")}</summary>
        <div className="absolute left-2 right-2 top-full z-20 mt-2 max-h-[min(60dvh,440px)] space-y-3 overflow-y-auto rounded-xl border border-border bg-bg-surface p-3 shadow-xl sm:left-auto sm:right-0 sm:w-72">
          <label className="block space-y-1 text-xs text-text-normal"><span>{t("topology.linkView")}</span><select className={`${button} block w-full`} value={selected || display !== "selected" ? display : "all"} onChange={e => setDisplay(e.target.value as PathDisplay)}><option value="all">{t("topology.allPaths")}</option><option value="bundled">{t("topology.bundledPaths")}</option><option value="selected" disabled={!selected}>{t("topology.selectedPaths")}</option></select></label>
          <div className="flex gap-2"><button className={button} onClick={() => renderer.current?.angle(true)}>{t("topology.topView")}</button><button className={button} onClick={() => renderer.current?.angle(false)}>{t("topology.threeDView")}</button></div>
          {settings}
          <p className="text-[11px] leading-relaxed text-text-muted">{t("topology.controlsPan")}</p>
        </div>
      </details>
      {document.fullscreenEnabled && <button className={button} onClick={() => { const action = expanded ? document.exitFullscreen() : panel.current?.requestFullscreen(); action?.catch(() => {}); }}>{t(expanded ? "topology.collapse" : "topology.expand")}</button>}
    </div>
    <div className="relative min-h-0 flex-1">
      <canvas ref={canvas} tabIndex={0} aria-label={t("topology.canvas")} className="absolute inset-0 block h-full w-full touch-none cursor-move focus-visible:outline-offset-[-3px]" />
      <div className="absolute bottom-3 right-3 flex gap-1 rounded-lg bg-bg-base/90 p-1"><button className={`${button} min-w-11`} aria-label={t("topology.zoomIn")} onClick={() => renderer.current?.zoom(1.3)}>+</button><button className={`${button} min-w-11`} aria-label={t("topology.zoomOut")} onClick={() => renderer.current?.zoom(1 / 1.3)}>−</button><button className={button} onClick={() => renderer.current?.fit()}>{t("topology.fit")}</button></div>
    </div>
  </div>;
}
