import { describe, it, expect, vi, afterEach } from "vitest";
import type { ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TopologyPage } from "../../../src/features/topology/TopologyPage";
import type { WsManager } from "../../../src/api/ws-manager";
import type { WsPacketObservation } from "../../../src/types/ws";
import { getScopeCatalogues, getNodesPage, getKnownRoutesPage } from "../../../src/api/client";
import i18n from "../../../src/i18n";

vi.mock("../../../src/features/topology/TopologyCanvas", () => ({ TopologyCanvas: ({ controls, settings }: { controls: ReactNode; settings: ReactNode }) => <div>{controls}{settings}canvas</div> }));
vi.mock("../../../src/hooks/useRegion", () => { const region = { iatas: ["YOW"], regionKey: "YOW", isResolved: true }; return { useRegion: () => region }; });
vi.mock("../../../src/features/stats/chartTheme", () => ({ useChartColors: () => ({}), nodeTypeColor: () => "#fff" }));
vi.mock("../../../src/api/client", () => ({ getIatas: vi.fn(async () => [{ iata: "YOW" }]), getScopeCatalogues: vi.fn(async () => []), getNodesPage: vi.fn(async () => ({ items: [], nextCursor: null, hasMore: false })), getKnownRoutesPage: vi.fn(async () => ({ items: [], nextCursor: null, hasMore: false })) }));

afterEach(() => vi.useRealTimers());
describe("Topology live lifecycle", () => {
  it("pauses, filters regions, cleans subscriptions, and degrades without catalogue support", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    let receive: ((event: WsPacketObservation["data"]) => void) | undefined;
    const unsubscribe = vi.fn(), resolve = vi.fn();
    const manager = { getStatus: () => "connected", onStatusChange: () => vi.fn(), onLagged: () => vi.fn(), setResolvePath: resolve, onPacketObservation: vi.fn(fn => { receive = fn; return unsubscribe; }) } as unknown as WsManager;
    vi.mocked(getScopeCatalogues).mockRejectedValueOnce(new Error("older server"));
    const props = { wsManager: manager, onViewNode: vi.fn(), onViewObserver: vi.fn(), onAnalyzePacket: vi.fn() };
    const { unmount } = render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={["/?tab=Topology&topoRegion=YOW"]}><TopologyPage {...props} /></MemoryRouter></QueryClientProvider>);
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(getScopeCatalogues).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Find a node" }));
    await screen.findByText("MeshMapper metadata is unavailable.");
    expect(resolve).toHaveBeenCalledWith(true);
    const event = { packetHash: "abcdef012345", packet: { payloadType: 99 }, observation: { observerId: "reporter", observerName: "Live observer", iata: "YKF" } } as WsPacketObservation["data"];
    act(() => { receive!(event); vi.advanceTimersByTime(600); });
    expect(screen.queryByText("abcdef01")).not.toBeInTheDocument();
    act(() => { receive!({ ...event, observation: { ...event.observation, iata: "YOW" } }); vi.advanceTimersByTime(600); });
    expect(screen.queryByRole("button", { name: /abcdef01/ })).not.toBeInTheDocument();
    const activity = screen.getByText("Live activity").closest("details")!;
    activity.open = true; fireEvent(activity, new Event("toggle"));
    fireEvent.click(screen.getByRole("button", { name: /abcdef01/ })); expect(props.onAnalyzePacket).toHaveBeenCalledWith("abcdef012345");
    fireEvent.click(screen.getByRole("button", { name: "Pause", exact: true })); expect(unsubscribe).toHaveBeenCalledTimes(1); expect(resolve).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByRole("button", { name: "Resume" })); expect(resolve).toHaveBeenLastCalledWith(true);
    unmount(); expect(unsubscribe).toHaveBeenCalledTimes(2); expect(resolve).toHaveBeenLastCalledWith(false);
  });
  it("refreshes route evidence when switching back to a cached window", async () => {
    vi.mocked(getKnownRoutesPage).mockClear();
    const manager = { getStatus: () => "connected", onStatusChange: () => vi.fn(), onLagged: () => vi.fn(), setResolvePath: vi.fn(), onPacketObservation: () => vi.fn() } as unknown as WsManager;
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><TopologyPage wsManager={manager} onViewNode={vi.fn()} onViewObserver={vi.fn()} onAnalyzePacket={vi.fn()} /></MemoryRouter></QueryClientProvider>);
    await waitFor(() => expect(getKnownRoutesPage).toHaveBeenCalledTimes(1));
    const range = screen.getByRole("combobox", { name: "Route history" });
    fireEvent.change(range, { target: { value: "24h" } });
    await waitFor(() => expect(getKnownRoutesPage).toHaveBeenCalledTimes(2));
    fireEvent.change(range, { target: { value: "15m" } });
    await waitFor(() => expect(getKnownRoutesPage).toHaveBeenCalledTimes(3));
  });
  it("does not fetch a retained inactive view and translates the controls", async () => {
    await i18n.changeLanguage("fr"); vi.mocked(getNodesPage).mockClear();
    const manager = { getStatus: () => "connected", onStatusChange: () => vi.fn(), onPacketObservation: vi.fn() } as unknown as WsManager;
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><TopologyPage active={false} wsManager={manager} onViewNode={vi.fn()} onViewObserver={vi.fn()} onAnalyzePacket={vi.fn()} /></MemoryRouter></QueryClientProvider>);
    expect(screen.getByRole("heading", { name: "Topologie" })).toBeInTheDocument(); expect(getNodesPage).not.toHaveBeenCalled(); expect(manager.onPacketObservation).not.toHaveBeenCalled();
  });
});
