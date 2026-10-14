import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as api from "../../../src/api/client";
import { MyAtlasPage } from "../../../src/features/atlas/MyAtlasPage";
import { PreviewAtlasExtras } from "../../../src/features/atlas/PreviewAtlasExtras";
import { ATLAS_KEY } from "../../../src/features/atlas/atlas";
import type { Node } from "../../../src/features/nodes/types";

vi.mock("../../../src/api/client", async original => ({ ...(await original<typeof import("../../../src/api/client")>()), getNodeNeighbors: vi.fn(), getNodesPage: vi.fn(), getNode: vi.fn(), getNodeObservations: vi.fn(), getCollectedNodeTelemetry: vi.fn() }));
const key = "ab".repeat(32);
let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); window.history.replaceState({}, "", "/");
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.mocked(api.getNodesPage).mockResolvedValue({ items: [], hasMore: false });
  vi.mocked(api.getCollectedNodeTelemetry).mockResolvedValue({ limit: 500, items: [{ nodeKey: key, collectorKey: "cd".repeat(32), radioKey: "ef".repeat(32), receivedAt: Date.now(), values: { batteryMv: 4150 }, sensors: [] }] });
  vi.mocked(api.getNodeNeighbors).mockResolvedValue([]);
});
afterEach(() => client.clear());
it("retains collector links and battery cards before a node advertises", async () => {
  window.history.replaceState({}, "", `/?tab=MyAtlas&atlasAdd=${key}`);
  render(<QueryClientProvider client={client}><MyAtlasPage onViewNode={vi.fn()} onViewObserver={vi.fn()} onAnalyzePacket={vi.fn()} /></QueryClientProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "Add repeater telemetry card" }));
  expect(await screen.findByText("4.15 V")).toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem(ATLAS_KEY)!).pins[0]).toEqual({ kind: "node", id: "", publicKey: key, name: "" });
  expect(api.getNode).not.toHaveBeenCalled(); expect(api.getNodeObservations).not.toHaveBeenCalled();
});
it("fetches neighbours only when their list is opened", async () => {
  const node = { id: "11111111-1111-4111-8111-111111111111", publicKey: key, knownNeighborCount: 0 } as Node;
  render(<QueryClientProvider client={client}><PreviewAtlasExtras node={node} publicKey={key} active onViewNode={vi.fn()} /></QueryClientProvider>);
  expect(api.getNodeNeighbors).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText(/Known neighbours/));
  await waitFor(() => expect(api.getNodeNeighbors).toHaveBeenCalledWith(node.id));
});
