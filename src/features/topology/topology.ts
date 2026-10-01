import type { ChartColors } from "../stats/chartTheme";
import { getNodesPage } from "../../api/client";
import type { NodeSummary } from "../nodes/types";
import type { ResolvedHop } from "../../types/api";
import type { WsPacketObservation } from "../../types/ws";

export const NODE_CAP = 2000;
export const LINK_CAP = 5000;
export const REPORT_CAP = 2000;
export const LIVE_WINDOW = 60_000;
export const FLOW_MS = 4200;
export type Point3 = { x: number; y: number; z: number };
export type TopologyNode = NodeSummary & Point3 & { region: string };
export type Topology = { nodes: TopologyNode[]; byId: Map<string, TopologyNode>; links: [string, string][]; regions: (Point3 & { code: string; count: number })[]; linksCapped: boolean };
export type PacketKind = "advert" | "text" | "trace" | "ack" | "other";
export type LiveReport = { key: string; hash: string; observerId: string; observerName: string; iata: string; at: number; heardAt: number; kind: PacketKind; scope: string; snr: number | null; segments: [string, string][]; partial: boolean };

// Ten sequential, cancellable pages; no query per node or live packet.
export async function loadTopology(iatas: string[] | undefined, signal: AbortSignal) {
  const nodes = new Map<string, NodeSummary>();
  const cursors = new Set<number>();
  let cursor: number | undefined;
  for (let page = 0; page < NODE_CAP / 200; page++) {
    signal.throwIfAborted();
    const result = await getNodesPage(iatas, { cursor, limit: 200, neighbors: true }, signal);
    for (const node of result.items) if (nodes.size < NODE_CAP) nodes.set(node.id, node);
    if (!result.hasMore) return { nodes: [...nodes.values()], capped: false };
    if (result.nextCursor == null || cursors.has(result.nextCursor)) break;
    cursor = result.nextCursor;
    cursors.add(cursor);
  }
  return { nodes: [...nodes.values()], capped: true };
}

export function buildTopology(input: NodeSummary[]): Topology {
  const groups = new Map<string, NodeSummary[]>();
  const unique = [...new Map(input.slice(0, NODE_CAP).map(n => [n.id, n])).values()];
  for (const node of unique) {
    const code = [...node.iatas].sort((a, b) => b.lastHeard - a.lastHeard || a.iata.localeCompare(b.iata))[0]?.iata || "?";
    if (!groups.has(code)) groups.set(code, []);
    groups.get(code)!.push(node);
  }
  const ordered = [...groups].sort(([a], [b]) => a.localeCompare(b));
  const columns = Math.max(1, Math.ceil(Math.sqrt(ordered.length)));
  const nodes: TopologyNode[] = [];
  const regions: Topology["regions"] = [];
  ordered.forEach(([code, members], regionIndex) => {
    const center = { x: (regionIndex % columns - (columns - 1) / 2) * 370, y: 0, z: (Math.floor(regionIndex / columns) - (Math.ceil(ordered.length / columns) - 1) / 2) * 370 };
    regions.push({ ...center, y: -135, code, count: members.length });
    members.sort((a, b) => b.knownNeighborCount - a.knownNeighborCount || a.id.localeCompare(b.id));
    members.forEach((node, i) => {
      const radius = i === 0 ? 0 : 35 + 110 * Math.cbrt(i / members.length);
      const vertical = 1 - 2 * ((i * 0.61803398875) % 1);
      const angle = i * Math.PI * (3 - Math.sqrt(5));
      const ring = Math.sqrt(1 - vertical * vertical);
      nodes.push({ ...node, region: code, x: center.x + Math.cos(angle) * radius * ring, y: center.y + vertical * radius, z: center.z + Math.sin(angle) * radius * ring });
    });
  });
  const byId = new Map(nodes.map(n => [n.id, n]));
  const links: [string, string][] = [];
  const seen = new Set<string>();
  let linksCapped = false;
  for (const node of nodes) for (const other of node.neighborIds ?? []) {
    if (node.id === other || !byId.has(other)) continue;
    const pair = [node.id, other].sort() as [string, string];
    const key = pair.join("|");
    if (seen.has(key)) continue;
    if (links.length >= LINK_CAP) { linksCapped = true; break; }
    seen.add(key);
    links.push(pair);
  }
  return { nodes, byId, links, regions, linksCapped };
}

export function packetKind(type: number): PacketKind {
  return type === 4 ? "advert" : type === 2 || type === 5 ? "text" : type === 9 ? "trace" : type === 3 ? "ack" : "other";
}

// Only adjacent, single-candidate, high-confidence hops become an animated segment.
// Keep gaps in place: filtering unknown hops first would fabricate a radio link.
export function reportFromEvent(event: WsPacketObservation["data"], graph: Topology, at: number): LiveReport | null {
  const obs = event?.observation;
  if (!obs || !event.packet || event.packet.isRepeat || typeof event.packetHash !== "string" || !event.packetHash || typeof obs.observerId !== "string" || !obs.observerId || typeof obs.iata !== "string") return null;
  const path = obs.resolvedPath;
  const hops: (ResolvedHop | null | undefined)[] = Array.isArray(path) ? [obs.resolvedSource, ...path.slice(0, 64), obs.resolvedDestination] : [];
  const ids = hops.map(h => h?.confidence === "high" && h.nodes?.length === 1 && graph.byId.has(h.nodes[0]!.id) ? h.nodes[0]!.id : null);
  const segments: [string, string][] = [];
  for (let i = 1; i < ids.length; i++) {
    const a = ids[i - 1], b = ids[i];
    if (a && b && a !== b) segments.push([a, b]);
  }
  return { key: `${event.packetHash}|${obs.observerId}`, hash: event.packetHash, observerId: obs.observerId, observerName: typeof obs.observerName === "string" ? obs.observerName : obs.observerId.slice(0, 8), iata: obs.iata, at, heardAt: obs.heardAt, kind: packetKind(event.packet.payloadType), scope: typeof event.packet.scope === "string" ? event.packet.scope : "", snr: Number.isFinite(obs.snr) ? obs.snr : null, segments, partial: !Array.isArray(path) || path.length > 64 || hops.some(h => h != null && (h.confidence !== "high" || h.nodes?.length !== 1 || !graph.byId.has(h.nodes[0]!.id))) };
}

export class LiveTraffic {
  reports: LiveReport[] = [];
  flows: LiveReport[] = [];
  cappedUntil = 0;
  gapUntil = 0;
  markGap() { this.gapUntil = Date.now() + LIVE_WINDOW; }
  private seen = new Map<string, number>();
  add(report: LiveReport) {
    this.prune(report.at);
    if (this.seen.has(report.key)) return false;
    this.seen.set(report.key, report.at);
    if (this.seen.size > REPORT_CAP * 2) this.seen.delete(this.seen.keys().next().value!);
    this.reports.push(report);
    if (this.reports.length > REPORT_CAP) { this.reports.shift(); this.cappedUntil = report.at + LIVE_WINDOW; }
    if (report.segments.length) this.flows = [...this.flows.slice(-63), report];
    return true;
  }
  clearFlows() { this.flows = []; }
  prune(now: number) {
    this.reports = this.reports.filter(r => now - r.at < LIVE_WINDOW);
    this.flows = this.flows.filter(r => now - r.at < FLOW_MS);
    for (const [key, at] of this.seen) { if (now - at < LIVE_WINDOW) break; this.seen.delete(key); }
  }
}

export type Camera = { yaw: number; pitch: number; zoom: number };
export const DEFAULT_CAMERA: Camera = { yaw: -0.3, pitch: 0.55, zoom: 1.5 };
export function project(point: Point3, camera: Camera, width: number, height: number, extent: number) {
  const x = point.x * Math.cos(camera.yaw) - point.z * Math.sin(camera.yaw);
  const z = point.x * Math.sin(camera.yaw) + point.z * Math.cos(camera.yaw);
  const y = point.y * Math.cos(camera.pitch) - z * Math.sin(camera.pitch);
  const depth = point.y * Math.sin(camera.pitch) + z * Math.cos(camera.pitch);
  const perspective = 3 * extent / (3 * extent + depth);
  const scale = Math.min(width, height) / (extent * 2.6) * camera.zoom * perspective;
  return { x: width / 2 + x * scale, y: height / 2 - y * scale, depth, scale, visible: perspective > 0 };
}

export function flowColor(kind: PacketKind, c: ChartColors) {
  return { advert: c.green, text: c.secondary, trace: c.warn, ack: c.primary, other: c.textNormal }[kind];
}

export function linkContext(a: TopologyNode, b: TopologyNode) {
  return { crossRegion: a.region !== b.region, sharedDefault: a.defaultScope && a.defaultScope === b.defaultScope ? a.defaultScope : null };
}
