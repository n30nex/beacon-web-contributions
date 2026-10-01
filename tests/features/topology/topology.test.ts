import { describe, it, expect, vi } from "vitest";
import { buildTopology, reportFromEvent, LiveTraffic, project, DEFAULT_CAMERA, linkContext, loadTopology, REPORT_CAP } from "../../../src/features/topology/topology";
import { getNodesPage } from "../../../src/api/client";
import type { NodeSummary } from "../../../src/features/nodes/types";
import type { WsPacketObservation } from "../../../src/types/ws";
import type { ResolvedHop } from "../../../src/types/api";

vi.mock("../../../src/api/client", () => ({ getNodesPage: vi.fn() }));
const node = (id: string, region = "YOW", scope = "#on"): NodeSummary => ({ id, publicKey: id.repeat(64), name: id, nodeType: 2, nodeTypeName: "repeater", lat: null, lng: null, iatas: [{ iata: region, lastHeard: 1 }], knownNeighborCount: 1, neighborIds: [], defaultScope: scope });
const a = { ...node("a"), neighborIds: ["b", "b", "a", "missing"] }, b = { ...node("b", "YKF"), neighborIds: ["a"] }, c = node("c");
const graph = buildTopology([a, b, c]);
const hop = (id: string): ResolvedHop => ({ confidence: "high", nodes: [{ id, publicKey: id }] });
const event = (path: ResolvedHop[] = [hop("a"), hop("b"), hop("c")]): WsPacketObservation["data"] => ({ packetHash: "hash", packet: { payloadType: 5, payloadTypeName: "GRP_TXT", routeType: 1, routeTypeName: "FLOOD", isFirstObservation: true, observationCount: 1, scope: "#on" }, observation: { observerId: "obs", observerName: "Observer", iata: "YOW", heardAt: 1, rssi: -90, snr: 5, sourceBroker: "fixture", resolvedPath: path } });

describe("3D topology evidence and bounds", () => {
  it("keeps unlocated identities and only supplied neighbour edges, with stable positions", () => {
    expect(graph.nodes).toHaveLength(3);
    expect(graph.links).toEqual([["a", "b"]]);
    expect(buildTopology([c, b, a]).nodes).toEqual(graph.nodes);
    expect(new Set(graph.nodes.map(n => n.y)).size).toBeGreaterThan(1);
    expect(linkContext(graph.byId.get("a")!, graph.byId.get("b")!)).toEqual({ crossRegion: true, sharedDefault: "#on" });
    expect(linkContext(graph.byId.get("a")!, { ...graph.byId.get("b")!, defaultScope: "#ON" }).sharedDefault).toBeNull();
  });
  it("does not bridge ambiguous, unloaded, or missing hops, or append reporting observers", () => {
    expect(reportFromEvent(event(), graph, 100)?.segments).toEqual([["a", "b"], ["b", "c"]]);
    for (const middle of [{ confidence: "ambiguous", nodes: [hop("b").nodes[0]!, hop("c").nodes[0]!] } as ResolvedHop, hop("missing"), { confidence: "none", nodes: [] } as ResolvedHop]) {
      const report = reportFromEvent(event([hop("a"), middle, hop("c")]), graph, 100)!;
      expect(report.segments).toEqual([]); expect(report.partial).toBe(true);
    }
    const missing = event(); delete missing.observation.resolvedPath;
    expect(reportFromEvent(missing, graph, 100)?.segments).toEqual([]);
    const repeat = event(); repeat.packet.isRepeat = true;
    expect(reportFromEvent(repeat, graph, 100)).toBeNull();
    const unknown = event(); unknown.packet.payloadType = 99;
    expect(reportFromEvent(unknown, graph, 100)?.kind).toBe("other");
  });
  it("deduplicates packet/observer pairs in the live window and bounds report/animation memory", () => {
    const traffic = new LiveTraffic();
    const report = reportFromEvent(event(), graph, 100)!;
    expect(traffic.add(report)).toBe(true); expect(traffic.add({ ...report, at: 200 })).toBe(false);
    expect(traffic.add({ ...report, key: "hash|other", observerId: "other", at: 200 })).toBe(true);
    for (let i = 0; i < REPORT_CAP + 10; i++) traffic.add({ ...report, key: `event${i}`, at: 300 });
    expect(traffic.reports).toHaveLength(REPORT_CAP); expect(traffic.flows).toHaveLength(64); expect(traffic.cappedUntil).toBeGreaterThan(300);
    traffic.prune(60_301); expect(traffic.reports).toEqual([]); expect(traffic.flows).toEqual([]);
    expect(traffic.add({ ...report, at: 60_302 })).toBe(true);
  });
  it("uses depth perspective and a real orbit without invalid coordinates", () => {
    const point = { x: 100, y: 20, z: 50 };
    const front = project(point, DEFAULT_CAMERA, 1000, 700, 500);
    const side = project(point, { ...DEFAULT_CAMERA, yaw: 1 }, 1000, 700, 500);
    expect(front.x).not.toBe(side.x); expect(front.depth).not.toBe(side.depth);
    expect([front.x, front.y, front.scale, side.x, side.y].every(Number.isFinite)).toBe(true);
  });
  it("stops on repeating cursors, passes cancellation, and never fetches beyond ten pages", async () => {
    vi.mocked(getNodesPage).mockResolvedValue({ items: [a], nextCursor: 1, hasMore: true });
    const controller = new AbortController();
    const result = await loadTopology(undefined, controller.signal);
    expect(result).toEqual({ nodes: [a], capped: true }); expect(getNodesPage).toHaveBeenCalledTimes(2);
    vi.mocked(getNodesPage).mockClear().mockImplementation(async (_iatas, params) => ({ items: [a], nextCursor: (params?.cursor ?? 0) + 1, hasMore: true }));
    await loadTopology(["YOW"], controller.signal); expect(getNodesPage).toHaveBeenCalledTimes(10);
    controller.abort(); await expect(loadTopology(undefined, controller.signal)).rejects.toThrow();
    expect(getNodesPage).toHaveBeenCalledTimes(10);
  });
});
