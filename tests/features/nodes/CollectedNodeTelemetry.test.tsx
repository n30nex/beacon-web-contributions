import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CollectedNodeTelemetry } from "../../../src/features/nodes/CollectedNodeTelemetry";
import { getCollectedNodeTelemetry } from "../../../src/api/client";

vi.mock("../../../src/api/client", () => ({ getCollectedNodeTelemetry: vi.fn() }));
const key = "ab".repeat(32);
const collector = "cd".repeat(32);
function mount() { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><CollectedNodeTelemetry publicKey={key} active /></QueryClientProvider>); }

describe("collector telemetry", () => {
  it("keeps environmental channels and collector attribution without inventing battery percent", async () => {
    vi.mocked(getCollectedNodeTelemetry).mockResolvedValue({ limit: 500, items: [
      { nodeKey: key, collectorKey: collector, radioKey: "ef".repeat(32), receivedAt: Date.now(), intervalHours: 1,
        values: { batteryMv: 4120 }, sensors: [{ channel: 2, kind: "temperature", value: 21.5, unit: "C" }] },
      { nodeKey: "12".repeat(32), collectorKey: collector, radioKey: "ef".repeat(32), receivedAt: Date.now(), values: { batteryMv: 9900 }, sensors: [] },
    ] });
    mount();
    await screen.findByText("21.5 C");
    expect(screen.getByText("Temperature · Ch 2")).toBeInTheDocument();
    expect(screen.getByText("4.12 V")).toBeInTheDocument();
    expect(screen.queryByText("9.9 V")).not.toBeInTheDocument();
    expect(screen.getAllByTitle(collector)).toHaveLength(2);
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });
});
