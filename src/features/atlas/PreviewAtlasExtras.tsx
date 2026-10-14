import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getNodeNeighbors } from "../../api/client";
import { Timestamp } from "../../components/Timestamp";
import { CollectedNodeTelemetry } from "../nodes/CollectedNodeTelemetry";
import { NodeTelemetry } from "../nodes/NodeTelemetry";
import type { Node } from "../nodes/types";
import type { AtlasSample } from "./atlas";

// Preview-only additions stay outside the portable Atlas cards submitted upstream.
export function PreviewAtlasExtras({ node, publicKey, active, sample, updatedAt, onViewNode }: {
  node?: Node; publicKey: string; active: boolean; sample?: AtlasSample; updatedAt?: number; onViewNode?: (id: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const neighbors = useQuery({ queryKey: ["node-neighbors", node?.id], queryFn: () => getNodeNeighbors(node!.id), enabled: active && open && !!node, staleTime: 120_000, retry: false });
  if (!node) return <CollectedNodeTelemetry publicKey={publicKey} active={active} compact />;
  return <div className="space-y-2">
    <NodeTelemetry node={node} active={active} compact />
    <details className="text-xs" onToggle={e => setOpen(e.currentTarget.open)}>
      <summary className="min-h-7 cursor-pointer content-center text-primary">{t("atlas.neighbors")} · {node.knownNeighborCount}</summary>
      <p className="text-[10px] text-text-muted">{t("atlas.neighborSource")}</p>
      {neighbors.isPending && open ? <p role="status">{t("common.loading")}</p> : neighbors.isError ? <p className="text-warn">{t("common.loadFailed")}</p> : <ul className="max-h-32 overflow-y-auto">{neighbors.data?.map(n => <li key={`${n.id}/${n.iata}`}><button type="button" className="flex min-h-8 w-full items-center justify-between gap-2 border-t border-border-subtle text-left" onClick={() => onViewNode?.(n.id)}><span className="truncate">{n.name || n.publicKey.slice(0, 12)}</span><span className="shrink-0 text-[10px] text-text-muted">{n.iata} · <Timestamp value={n.lastSeen} /></span></button></li>)}</ul>}
    </details>
    {sample && <details className="text-xs">
      <summary className="min-h-7 cursor-pointer content-center text-text-normal">{t("atlas.statistics")}</summary>
      <p>{t("atlas.definition")}</p><p>{t("atlas.signalDefinition")}</p>
      {sample.truncated && <p className="text-warn">{t("atlas.capped")}</p>}
      <dl className="grid grid-cols-2 gap-2"><dt>{t("atlas.hops")}</dt><dd>{sample.hops ?? "—"}</dd><dt>{t("atlas.radio")}</dt><dd>{node.radio || "—"}</dd><dt>{t("atlas.scope")}</dt><dd>{node.defaultScope || "—"}</dd></dl>
      <p className="break-all font-mono text-[10px]">{node.publicKey}</p>
      <details><summary className="min-h-7 cursor-pointer content-center">{t("atlas.chartValues")}</summary><div className="max-h-40 overflow-auto"><table className="w-full"><thead><tr><th>{t("atlas.hour")}</th><th>{t("atlas.reports")}</th></tr></thead><tbody>{sample.counts.map((count, i) => <tr key={i}><td>{new Date(sample.since + i * 3_600_000).toLocaleString(i18n.language)}</td><td className="text-right">{count}</td></tr>)}</tbody></table></div></details>
      {updatedAt != null && <p>{t("atlas.updated")} <Timestamp value={updatedAt} /></p>}
    </details>}
  </div>;
}
