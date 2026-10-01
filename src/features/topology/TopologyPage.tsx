import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getIatas, getScopeCatalogues } from "../../api/client";
import type { WsManager } from "../../api/ws-manager";
import { useRegion } from "../../hooks/useRegion";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useChartColors, nodeTypeColor } from "../stats/chartTheme";
import { NODE_TYPES } from "../../lib/node-types";
import { buildTopology, LiveTraffic, loadTopology, reportFromEvent, type LiveReport, type PacketKind, flowColor, linkContext } from "./topology";
import { TopologyCanvas } from "./TopologyCanvas";

type Props = { wsManager: WsManager; active?: boolean; onViewNode: (id: string) => void; onViewObserver: (id: string) => void; onAnalyzePacket: (hash: string) => void };
const button = "min-h-11 rounded-lg border border-border bg-bg-surface px-3 text-xs text-text-bright hover:border-primary disabled:opacity-40";

export function TopologyPage(props: Props) {
  const { iatas, regionKey, isResolved } = useRegion();
  const [params, setParams] = useSearchParams();
  const requested = params.get("topoRegion") || "";
  const focus = /^[A-Za-z0-9_-]{1,16}$/.test(requested) && (!iatas || iatas.includes(requested)) ? requested : "";
  const selectedIatas = useMemo(() => focus ? [focus] : iatas, [focus, iatas]);
  const setFocus = (value: string) => { const next = new URLSearchParams(params); if (value) next.set("topoRegion", value); else next.delete("topoRegion"); next.delete("topoNode"); setParams(next); };
  return <TopologySession key={`${regionKey}|${focus}`} {...props} iatas={selectedIatas} allowedIatas={iatas} resolved={isResolved !== false} focus={focus} onFocus={setFocus} />;
}

function TopologySession({ wsManager, active = true, onViewNode, onViewObserver, onAnalyzePacket, iatas, allowedIatas, resolved, focus, onFocus }: Props & { iatas: string[] | undefined; allowedIatas: string[] | undefined; resolved: boolean; focus: string; onFocus: (value: string) => void }) {
  const { t } = useTranslation();
  const colors = useChartColors();
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [paused, setPaused] = useState(false);
  const [animate, setAnimate] = useState(true);
  const [search, setSearch] = useState("");
  const [copied, setCopied] = useState(false);
  const [params, setParams] = useSearchParams();
  const selected = params.get("topoNode") || "";
  const select = useCallback((id: string) => setParams(prev => { const next = new URLSearchParams(prev); next.set("topoNode", id); return next; }), [setParams]);
  const data = useQuery({ queryKey: ["topology", iatas ?? "*"], queryFn: ({ signal }) => loadTopology(iatas, signal), enabled: active && resolved, staleTime: 120_000, refetchOnWindowFocus: false });
  const regions = useQuery({ queryKey: ["iatas"], queryFn: getIatas, staleTime: 300_000, enabled: active && resolved });
  const catalogues = useQuery({ queryKey: ["scope-catalogues"], queryFn: getScopeCatalogues, enabled: active && resolved, staleTime: 300_000, refetchOnWindowFocus: false, retry: false });
  const graph = useMemo(() => buildTopology(data.data?.nodes ?? []), [data.data]);
  const [traffic] = useState(() => new LiveTraffic());
  const [live, setLive] = useState<{ reports: LiveReport[]; tick: number; now: number; gap: boolean; capped: boolean }>(() => ({ reports: [], tick: 0, now: Date.now(), gap: false, capped: false }));
  const subscribe = useCallback((notify: () => void) => wsManager.onStatusChange(notify), [wsManager]);
  const status = useSyncExternalStore(subscribe, () => wsManager.getStatus());

  useEffect(() => {
    if (!active || paused || !resolved || !data.data) return;
    const packet = wsManager.onPacketObservation(event => {
      if (document.hidden || (iatas && !iatas.includes(event?.observation?.iata))) return;
      const report = reportFromEvent(event, graph, Date.now());
      if (report) traffic.add(report);
    });
    const lagged = wsManager.onLagged(() => traffic.markGap());
    const visibility = () => { wsManager.setResolvePath(!document.hidden); if (document.hidden) { traffic.markGap(); traffic.clearFlows(); } };
    visibility();
    document.addEventListener("visibilitychange", visibility);
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      const now = Date.now(); traffic.prune(now);
      setLive(previous => ({ reports: [...traffic.reports], tick: previous.tick + 1, now, gap: traffic.gapUntil > now, capped: traffic.cappedUntil > now }));
    }, 500);
    return () => { packet(); lagged(); clearInterval(timer); document.removeEventListener("visibilitychange", visibility); wsManager.setResolvePath(false); traffic.clearFlows(); traffic.markGap(); };
  }, [active, paused, resolved, data.data, graph, iatas, traffic, wsManager]);

  const counts = useMemo(() => {
    const observers = new Map<string, { name: string; count: number; iata: string }>();
    const kinds: Record<PacketKind, number> = { advert: 0, text: 0, trace: 0, ack: 0, other: 0 };
    for (const report of live.reports) { const old = observers.get(report.observerId); observers.set(report.observerId, { name: report.observerName, count: (old?.count ?? 0) + 1, iata: report.iata }); kinds[report.kind]++; }
    return { observers: [...observers].sort((a, b) => b[1].count - a[1].count), kinds, paths: live.reports.filter(r => r.segments.length).length };
  }, [live.reports]);
  const matches = useMemo(() => graph.nodes.filter(n => !search || `${n.name ?? ""} ${n.publicKey}`.toLowerCase().includes(search.toLowerCase())).slice(0, 30), [graph.nodes, search]);
  const node = graph.byId.get(selected);
  const catalogue = catalogues.data?.find(c => c.iata === (node?.region || focus));
  const catalogueStale = catalogue && (!!catalogue.lastError || !catalogue.checkedAt || live.now > catalogue.freshUntil);
  const neighbours = node ? graph.links.filter(([a, b]) => a === node.id || b === node.id).map(([a, b]) => graph.byId.get(a === node.id ? b : a)!).slice(0, 12) : [];
  const share = async () => { try { await navigator.clipboard.writeText(window.location.href); setCopied(true); } catch { setCopied(false); } };
  const togglePause = () => { traffic.markGap(); setPaused(value => !value); setLive(previous => ({ ...previous, gap: true })); };
  return <section className="h-full min-w-0 overflow-y-auto p-3 md:p-5" aria-label={t("topology.title")}>
    <div className="mx-auto max-w-[1800px] space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="font-mono text-[10px] tracking-[0.2em] text-primary">{t("topology.eyebrow")}</p><h1 className="mt-1 text-2xl font-semibold text-text-bright">{t("topology.title")}</h1></div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`mr-1 flex items-center gap-2 text-xs ${paused || status !== "connected" ? "text-warn" : "text-green"}`} role="status"><span className="h-2 w-2 rounded-full bg-current" />{t(paused ? "topology.paused" : status === "connected" ? "topology.live" : "topology.reconnecting")}</span>
          <select className={`${button} max-w-52`} aria-label={t("topology.region")} value={focus} onChange={e => onFocus(e.target.value)}><option value="">{t("topology.allRegions")}</option>{(regions.data ?? []).filter(r => !allowedIatas || allowedIatas.includes(r.iata)).map(r => <option key={r.iata} value={r.iata}>{r.iata}{r.displayName ? ` · ${r.displayName}` : ""}</option>)}</select>
          <button className={button} onClick={togglePause}>{t(paused ? "topology.resume" : "topology.pause")}</button>
          <button className={button} onClick={share}>{t(copied ? "topology.copied" : "topology.copy")}</button>
        </div>
      </header>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {[[graph.nodes.length, "nodes"], [graph.links.length, "links"], [live.reports.length, "reports"], [counts.observers.length, "observers"]].map(([value, label]) => <div key={label} className="rounded-lg border border-border bg-bg-surface px-4 py-3"><div className="font-mono text-2xl text-text-bright">{Number(value).toLocaleString()}</div><p className="mt-1 text-[11px] text-text-normal">{t(`topology.${label}`)}</p></div>)}
      </div>
      {data.isError && <p role="alert" className="text-sm text-danger">{t("topology.loadError")} <button className={button} onClick={() => data.refetch()}>{t("topology.refresh")}</button></p>}
      {data.isLoading && <p role="status" className="text-sm text-text-normal">{t("topology.loading")}</p>}
      {(data.data?.capped || graph.linksCapped || live.capped) && <p className="text-xs text-warn">{t("topology.bounded")}</p>}
      {live.gap && <p className="text-xs text-warn">{t("topology.gap")}</p>}
      <div className="grid min-w-0 items-start gap-3 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-3">
          <TopologyCanvas graph={graph} traffic={traffic} colors={colors} selected={selected} onSelect={select} motion={animate && !reducedMotion && !paused} active={active} tick={live.tick} />
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-bg-surface px-3 py-2">
            <div className="flex flex-wrap gap-3 text-[11px] text-text-normal">{NODE_TYPES.map(type => <span key={type.name} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: nodeTypeColor(type.name, colors) }} />{t(`topology.types.${type.name}`)}</span>)}<span>{t("topology.observerRing")}</span><span className="text-primary">┄ {t("topology.crossRegion")}</span><span className="text-green">━ {t("topology.sharedDefault")}</span></div>
            <label className="flex min-h-8 items-center gap-2 text-xs text-text-normal"><input type="checkbox" checked={animate && !reducedMotion} disabled={reducedMotion} onChange={e => setAnimate(e.target.checked)} />{t(reducedMotion ? "topology.reducedMotion" : "topology.motion")}</label>
          </div>
          <div className="rounded-lg border border-border bg-bg-surface p-3">
            <div className="flex justify-between text-xs text-text-normal"><span>{t("topology.mix")}</span><span>{t("topology.paths", { count: counts.paths })}</span></div>
            <div className="my-3 flex h-2 overflow-hidden rounded bg-bg-raised">{Object.entries(counts.kinds).map(([kind, count]) => <div key={kind} style={{ width: `${100 * count / Math.max(1, live.reports.length)}%`, background: flowColor(kind as PacketKind, colors) }} />)}</div>
            <div className="flex flex-wrap gap-4 text-[11px] text-text-normal">{Object.entries(counts.kinds).map(([kind, count]) => <span key={kind}><span style={{ color: flowColor(kind as PacketKind, colors) }}>●</span> {t(`topology.kinds.${kind}`)} <b className="text-text-bright">{count}</b></span>)}</div>
          </div>
        </div>
        <aside className="min-w-0 space-y-3">
          <div className="rounded-xl border border-border bg-bg-surface p-3">
            <h2 className="mb-2 text-sm font-semibold text-text-bright">{t("topology.find")}</h2>
            <input className="min-h-11 w-full rounded border border-border bg-bg-base px-3 text-sm text-text-bright" aria-label={t("topology.search")} placeholder={t("topology.search")} value={search} onChange={e => setSearch(e.target.value)} />
            <div className="mt-2 max-h-44 overflow-y-auto">{matches.map(n => <button key={n.id} className={`flex min-h-9 w-full items-center justify-between gap-2 rounded px-2 text-left text-xs ${selected === n.id ? "bg-primary/15 text-primary" : "text-text-normal hover:bg-bg-raised"}`} onClick={() => select(n.id)} aria-pressed={selected === n.id}><span className="truncate">{n.name || n.publicKey.slice(0, 10)}</span><span className="shrink-0 font-mono text-[10px]">{n.region}</span></button>)}{!matches.length && <p className="py-3 text-xs text-text-muted">{t("topology.noNodes")}</p>}</div>
            {node && <div className="mt-3 space-y-2 border-t border-border pt-3"><h3 className="break-words text-sm text-text-bright">{node.name || node.publicKey.slice(0, 12)}</h3><p className="text-xs text-text-normal">{t("topology.neighbours", { count: node.knownNeighborCount })}</p><div className="flex flex-wrap gap-2"><button className={button} onClick={() => onViewNode(node.id)}>{t("topology.nodeDetails")}</button>{node.observerId && <button className={button} onClick={() => onViewObserver(node.observerId!)}>{t("topology.observerDetails")}</button>}<button className={button} onClick={() => setParams(prev => { const next = new URLSearchParams(prev); next.delete("topoNode"); return next; })}>{t("topology.clear")}</button></div>
              {node.defaultScope && <p className="text-xs text-green">{t("topology.defaultScope")}: {node.defaultScope}</p>}
              <div className="max-h-40 overflow-y-auto">{neighbours.map(neighbour => { const context = linkContext(node, neighbour); const listed = context.sharedDefault && catalogues.data?.some(c => (c.iata === node.region || c.iata === neighbour.region) && c.scopes.some(scope => scope.name === context.sharedDefault)); return <button key={neighbour.id} className="flex min-h-10 w-full items-center justify-between gap-2 border-t border-border-subtle text-left text-xs text-text-normal" onClick={() => select(neighbour.id)}><span className="truncate">{neighbour.name || neighbour.publicKey.slice(0, 8)}</span><span className={`shrink-0 font-mono text-[10px] ${context.sharedDefault ? "text-green" : "text-primary"}`} title={listed ? t("topology.cataloguedLink") : undefined}>{context.sharedDefault || `${node.region} ↔ ${neighbour.region}`}{listed ? " · MM" : ""}</span></button>; })}</div>
            </div>}
          </div>
          {(focus || node) && <div className="rounded-xl border border-border bg-bg-surface p-3"><h2 className="text-sm font-semibold text-text-bright">MeshMapper · {node?.region || focus}</h2>
            {catalogue ? <><p className={`my-2 text-xs ${catalogueStale ? "text-warn" : "text-text-normal"}`}>{t(catalogueStale ? "topology.catalogueStale" : "topology.catalogueFresh")}</p><p className="text-[11px] text-text-normal">{t("topology.catalogueCounts", { count: catalogue.scoped, total: catalogue.repeaters })}</p><div className="mt-2 max-h-32 overflow-y-auto">{catalogue.scopes.map(scope => <div key={scope.name} className="flex justify-between gap-2 py-1 text-xs"><span className={scope.name === node?.defaultScope ? "text-green" : "text-text-normal"}>{scope.name}{scope.monitored ? " ◉" : ""}</span><span className="font-mono text-text-muted">{scope.repeaters}</span></div>)}</div><p className="mt-2 text-[10px] text-text-muted">{t("topology.catalogueChecked")}: {catalogue.checkedAt ? new Date(catalogue.checkedAt).toLocaleString() : "—"}</p></> : <p className="mt-2 text-xs text-text-muted">{t(catalogues.isLoading ? "topology.loading" : catalogues.isError ? "topology.catalogueError" : "topology.noCatalogue")}</p>}
            <p className="mt-2 text-[10px] text-text-muted">{t("topology.catalogueMeaning")}</p>
          </div>}
          <div className="rounded-xl border border-border bg-bg-surface p-3"><h2 className="mb-2 text-sm font-semibold text-text-bright">{t("topology.reporting")}</h2><div className="max-h-48 space-y-2 overflow-y-auto">{counts.observers.slice(0, 20).map(([id, observer]) => <button key={id} className="relative flex min-h-10 w-full items-center justify-between gap-2 overflow-hidden rounded bg-bg-base px-2 text-left text-xs text-text-bright" onClick={() => onViewObserver(id)}><span className="absolute inset-y-0 left-0 bg-primary/15" style={{ width: `${100 * observer.count / (counts.observers[0]?.[1].count || 1)}%` }} /><span className="relative truncate">{observer.name}</span><span className="relative shrink-0 font-mono text-primary">{observer.count}</span></button>)}{!counts.observers.length && <p className="py-2 text-xs text-text-muted">{t("topology.listening")}</p>}</div></div>
          <div className="rounded-xl border border-border bg-bg-surface p-3"><h2 className="mb-2 text-sm font-semibold text-text-bright">{t("topology.latest")}</h2><div className="max-h-64 divide-y divide-border-subtle overflow-y-auto">{live.reports.slice(-10).reverse().map(report => <button key={report.key} className="flex min-h-12 w-full items-center gap-2 py-2 text-left text-xs text-text-normal" onClick={() => onAnalyzePacket(report.hash)}><span style={{ color: flowColor(report.kind, colors) }}>●</span><span className="min-w-0 flex-1"><span className="block font-mono text-text-bright">{report.hash.slice(0, 8)} <span className="text-primary">{report.iata}</span> <span className="text-green">{report.scope}</span></span><span className="block truncate">{report.observerName}</span></span><span className="max-w-24 text-right text-[10px]">{t(report.segments.length ? report.partial ? "topology.partialPath" : "topology.path" : "topology.noPath")}</span></button>)}</div></div>
        </aside>
      </div>
      <details className="rounded-lg border border-border px-3 py-2 text-xs text-text-normal"><summary className="min-h-8 cursor-pointer content-center">{t("topology.about")}</summary><p className="max-w-4xl pb-3 leading-relaxed">{t("topology.definition")}</p><button className={button} disabled={data.isFetching || !active || !resolved} onClick={() => data.refetch()}>{t("topology.refresh")}</button></details>
    </div>
  </section>;
}
