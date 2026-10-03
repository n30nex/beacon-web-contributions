import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getCollectedNodeTelemetry } from "../../api/client";
import { Sparkline } from "../../components/Sparkline";
import { Timestamp } from "../../components/Timestamp";

const statusUnits: Record<string, string> = { batteryMv: "V", uptimeSeconds: "s", lastRssiDbm: "dBm", lastSnrDb: "dB", noiseFloorDbm: "dBm", queueLength: "", receivedPackets: "", sentPackets: "" };

export function CollectedNodeTelemetry({ publicKey, active }: { publicKey: string; active: boolean }) {
  const { t, i18n } = useTranslation();
  const key = publicKey.toLowerCase();
  const data = useQuery({ queryKey: ["collected-node-telemetry", key], queryFn: ({ signal }) => getCollectedNodeTelemetry(key, signal),
    enabled: active && /^[0-9a-f]{64}$/.test(key), staleTime: 300_000, retry: false, refetchInterval: 300_000, refetchIntervalInBackground: false });
  const samples = (data.data?.items ?? []).filter(sample => sample.nodeKey === key).sort((a,b) => a.receivedAt-b.receivedAt);
  if (!samples.length) return data.isError ? <section aria-label={t("nodeTelemetry.collected")} className="mb-3 text-xs text-warn">
    <p role="status">{t("nodeTelemetry.loadError")} <button type="button" className="min-h-11 underline" onClick={() => void data.refetch()}>{t("atlas.retry")}</button></p>
  </section> : null;
  const metrics = new Map<string, { label: string; collector: string; unit: string; times: number[]; values: number[]; gapMs: number }>();
  for (const sample of samples) {
    const readings = [
      ...Object.entries(sample.values ?? {}).filter(([name]) => name in statusUnits).map(([name, value]) => ({ name, unit: statusUnits[name]!, value: name === "batteryMv" ? value / 1000 : value, channel: null })),
      ...(sample.sensors ?? []).map(sensor => ({ name: sensor.kind === "voltage" && sensor.channel === 1 ? "batteryMv" : sensor.kind, value: sensor.value, unit: sensor.unit, channel: sensor.kind === "voltage" && sensor.channel === 1 ? null : sensor.channel })),
    ];
    for (const reading of readings) {
      if (!Number.isFinite(reading.value)) continue;
      const id = `${sample.collectorKey}/${reading.channel ?? "status"}/${reading.name}`;
      const metric = metrics.get(id) ?? { label: `${t(`nodeTelemetry.metrics.${reading.name}`, { defaultValue: reading.name.replaceAll("_", " ") })}${reading.channel != null ? ` · ${t("nodeTelemetry.channel", { channel: reading.channel })}` : ""}`, collector: sample.collectorKey, unit: reading.unit, times: [], values: [], gapMs: 1.5 * Math.max(1, Math.min(72, sample.intervalHours ?? 1)) * 3_600_000 + 120_000 };
      if (metric.times.at(-1) !== sample.receivedAt) { metric.times.push(sample.receivedAt); metric.values.push(reading.value); }
      metrics.set(id, metric);
    }
  }
  return <section aria-label={t("nodeTelemetry.collected")} className="mb-3 space-y-2">
    <div className="flex flex-wrap justify-between gap-2 text-xs text-text-muted"><span>{t("nodeTelemetry.collected")}</span><Timestamp value={samples.at(-1)!.receivedAt} /></div>
    {data.isError && <p role="status" className="text-xs text-warn">{t("atlas.refreshFailed")}</p>}
    {metrics.size > 24 && <p className="text-xs text-text-muted">{t("nodeTelemetry.limit")}</p>}
    <div className="grid grid-cols-2 gap-2">{[...metrics].sort((a,b) => b[1].times.at(-1)!-a[1].times.at(-1)!).slice(0,24).map(([id, metric]) => <div key={id} className="min-w-0 rounded border border-border bg-bg-base p-2">
      <p className="text-[10px] text-text-muted">{metric.label}</p>
      <p className="font-mono text-sm text-text-bright">{metric.values.at(-1)!.toLocaleString(i18n.language, { maximumFractionDigits: 2 })} {metric.unit}</p>
      <Sparkline values={metric.values} times={metric.times} gapMs={metric.gapMs} color="var(--color-green)" />
      <p className="text-[9px] text-text-muted" title={metric.collector}>{t("nodeTelemetry.collector", { key: metric.collector.slice(0, 8) })} · <Timestamp value={metric.times.at(-1)!} /></p>
    </div>)}</div>
  </section>;
}
