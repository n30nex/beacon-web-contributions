import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getNodesPage, getObserver, getObserverDirectoryPage } from "../../api/client";
import { SelectDropdown } from "../../components/SelectDropdown";
import { nodeSearchParams } from "../nodes/node-search";
import { AtlasCard, type AtlasActions } from "./AtlasCard";
import { ATLAS_LIMIT, atlasPinKey, parseAtlas, type AtlasPin, type AtlasRange } from "./atlas";
import { useSavedAtlas } from "./useSavedAtlas";
import { AtlasObserverCard } from "./AtlasObserverCard";
import type { NodeSummary } from "../nodes/types";
import type { ObserverDirectoryItem } from "../observers/types";

export function MyAtlasPage({ active = true, ...actions }: AtlasActions & { active?: boolean }) {
  const { t } = useTranslation();
  const { saved, update, storageFailed } = useSavedAtlas();
  const [linkedKey] = useState(() => { const key = new URLSearchParams(window.location.search).get("atlasAdd") ?? ""; return /^[a-f\d]{64}$/i.test(key) ? key.toLowerCase() : ""; });
  const [searchOpen, setSearchOpen] = useState(!!linkedKey || saved.cards.length === 0);
  const [text, setText] = useState(linkedKey);
  const [field, setField] = useState(linkedKey ? "pubkey" : "name");
  const [query, setQuery] = useState({ text: "", field: "name" });
  const [heardKey, setHeardKey] = useState<string | null>(null);
  useEffect(() => { const timer = setTimeout(() => setQuery({ text: text.trim(), field }), 300); return () => clearTimeout(timer); }, [text, field]);
  const valid = query.text.length >= 2 && (query.field !== "pubkey" || /^[a-f\d]{2,64}$/i.test(query.text));
  const ready = query.text === text.trim() && query.field === field && valid;
  const search = useQuery({ queryKey: ["atlas-search", query.field, query.text], queryFn: ({ signal }) => getNodesPage(undefined, { ...nodeSearchParams(query.field, query.text), limit: 8 }, signal), enabled: active && searchOpen && ready && query.field !== "observer", staleTime: 30_000, retry: false });
  const observerMode = query.field === "observer";
  const [addingObserver, setAddingObserver] = useState<string | null>(null);
  const [addError, setAddError] = useState(false);
  const observerSearch = useQuery({queryKey:["atlas-observer-search",query.text],queryFn:({signal})=>getObserverDirectoryPage({name:query.text,sort:"name",limit:8},signal),enabled:active && searchOpen && ready && observerMode,staleTime:30_000,retry:false});
  const results = observerMode ? observerSearch : search;
  const entries: {id:string; name:string; key:string; node?:NodeSummary; observer?:ObserverDirectoryItem}[] = observerMode
    ? (observerSearch.data?.items ?? []).map(observer=>({id:observer.id,name:observer.displayName || observer.id.slice(0,8),key:observer.id,observer}))
    : (search.data?.items ?? []).map(node=>({id:node.id,name:node.name || node.publicKey.slice(0,12).toUpperCase(),key:node.publicKey,node}));
  const addObserver = async (row: ObserverDirectoryItem) => {
    setAddingObserver(row.id);setAddError(false);
    try {
      const observer = await getObserver(row.id);
      if (observer.id !== row.id) throw new Error("Observer identity changed");
      const pin: AtlasPin = {kind:"observer",id:observer.id,publicKey:observer.publicKey || "",name:observer.displayName || ""};
      if (!parseAtlas(JSON.stringify({version:2,cards:[pin]})).cards.length) throw new Error("Invalid observer identity");
      update(value=>parseAtlas(JSON.stringify({...value,cards:[...value.cards,pin]})));
    } catch {setAddError(true);} finally {setAddingObserver(null);}
  };
  const move = (pin:AtlasPin,direction:-1|1) => update(value=>{
    const cards=[...value.cards], from=cards.findIndex(card=>atlasPinKey(card)===atlasPinKey(pin)), to=from+direction;
    if(from<0 || to<0 || to>=cards.length) return value;
    [cards[from],cards[to]]=[cards[to]!,cards[from]!];return {...value,cards};
  });
  const full = saved.cards.length >= ATLAS_LIMIT;
  const empty = saved.cards.length === 0;
  return <section className="w-full min-w-0 overflow-y-auto" aria-label={t("tabs.MyAtlas")}>
    <div className="mx-auto max-w-[1600px] space-y-3 p-3 md:p-4">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <svg aria-hidden="true" viewBox="0 0 40 40" width="44" height="44" className="shrink-0 text-primary" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m5 10 10-4 10 4 10-4v24l-10 4-10-4-10 4Z" /><path d="M15 6v24M25 10v24M9 23l10-8 10 4" /><circle cx="19" cy="15" r="3" fill="var(--color-bg-base)" /><circle cx="29" cy="19" r="2" fill="var(--color-secondary)" /></svg>
          <div><h1 className="text-lg font-semibold tracking-tight text-text-bright">{t("tabs.MyAtlas")}</h1><p className="mt-1 text-sm">{t("atlas.subtitle")}</p></div>
        </div>
        <div role="group" aria-label={t("atlas.range")} className="flex rounded-sm border border-border bg-bg-surface p-1">
          {(["24h", "3d"] as AtlasRange[]).map(range => <button type="button" key={range} aria-pressed={saved.range === range} className={`min-h-10 rounded-md px-4 text-xs font-medium ${saved.range === range ? "bg-primary/15 text-primary" : "hover:bg-bg-raised"}`} onClick={() => update(value => ({ ...value, range }))}>{t(`atlas.ranges.${range}`)}</button>)}
        </div>
      </header>
      <details open={searchOpen} onToggle={event => setSearchOpen(event.currentTarget.open)} className="rounded-sm border border-border bg-bg-surface px-4 py-2">
        <summary className="min-h-11 cursor-pointer content-center text-sm text-text-bright">{t("atlas.addNodes")} <span className="ml-2 text-xs font-mono text-text-normal">{t("atlas.savedCount", { count: saved.cards.length, limit: ATLAS_LIMIT })}</span></summary>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <div className="flex min-w-0 flex-1 basis-72 items-center gap-2">
            <SelectDropdown label={t("atlas.searchBy")} hideAll value={field} options={[{ value: "name", label: t("atlas.name") }, { value: "pubkey", label: t("atlas.publicKey") }, {value:"observer",label:t("atlas.searchObservers")}]} onChange={setField} align="left" />
            <input type="search" maxLength={160} aria-label={t(field === "observer" ? "atlas.observerSearch" : "atlas.search")} aria-describedby="atlas-search-help" value={text} onChange={event => setText(event.target.value)} placeholder={t(field === "pubkey" ? "atlas.keyPlaceholder" : "atlas.namePlaceholder")} className="min-h-11 min-w-0 flex-1 rounded-sm border border-border bg-bg-base px-3 text-sm text-text-bright placeholder:text-text-muted" />
          </div>
        </div>
        <p id="atlas-search-help" className="mt-2 text-xs">{t(full ? "atlas.limitReached" : "atlas.searchHelp", { limit: ATLAS_LIMIT, min:2 })}</p>
        {ready && <div className="mt-3">
          {results.isPending ? <p role="status">{t("common.loading")}</p> : results.isError ? <p role="status">{t("common.loadFailed")} <button type="button" onClick={() => void results.refetch()} className="min-h-11 underline">{t("atlas.retry")}</button></p> : <>
            {!entries.length && <p role="status" className="text-sm">{t("atlas.noMatches")}</p>}
            {!entries.length && query.field === "pubkey" && /^[a-f\d]{64}$/i.test(query.text) && <button type="button" className="my-2 min-h-11 rounded border border-primary/30 bg-primary/10 px-3 text-xs text-primary disabled:opacity-40" disabled={full || saved.cards.some(pin => pin.publicKey === query.text.toLowerCase())} onClick={() => update(value => parseAtlas(JSON.stringify({ ...value, cards: [...value.cards, { kind: "node", id: "", publicKey: query.text, name: "" }] })))}>{t("nodeTelemetry.addCard")}</button>}
            {addError && <p role="alert" className="text-warn">{t("atlas.observerAddFailed")}</p>}
            <ul className="grid gap-2 md:grid-cols-2">{entries.map(entry=>{
              const selected=saved.cards.some(pin=>entry.observer ? pin.kind === "observer" && pin.id === entry.id : pin.kind !== "observer" && pin.publicKey === entry.key.toLowerCase());
              return <li key={entry.key} className="flex min-w-0 items-center justify-between gap-2 rounded-sm border border-border p-2 pl-3">
                <div className="min-w-0"><p className="break-words text-sm text-text-bright">{entry.name}</p><p className="truncate font-mono text-[10px]">{entry.key.slice(0,16).toUpperCase()} · {entry.observer ? t("atlas.observerCard") : t(`atlas.roles.${entry.node!.nodeType}`)}</p></div>
                <button type="button" disabled={selected || full || addingObserver !== null} aria-label={t(selected ? "atlas.addedName" : "atlas.addName",{name:entry.name})} className="min-h-11 shrink-0 rounded border border-primary/30 bg-primary/10 px-3 text-xs text-primary disabled:border-border disabled:bg-bg-raised disabled:text-text-muted" onClick={()=>entry.observer ? void addObserver(entry.observer) : update(value=>parseAtlas(JSON.stringify({...value,cards:[...value.cards,{kind:"node",id:entry.node!.id,publicKey:entry.node!.publicKey,name:entry.node!.name || ""}]})))}>{t(selected ? "atlas.added" : "atlas.add")}</button>
              </li>;
            })}</ul>
            {results.data?.hasMore && <p className="mt-2 text-xs">{t("atlas.refine")}</p>}
          </>}
        </div>}
      </details>
      <p className={`text-xs ${storageFailed ? "text-warn" : "text-text-normal"}`} role="status">{t(storageFailed ? "atlas.storageFailed" : "atlas.localOnly")}</p>
      <p className="text-[10px] text-text-muted">{t("charts.gapLegend")}</p>
      {empty ? <section className="rounded-sm border border-dashed border-border px-5 py-12 text-center"><h2 className="text-lg font-medium text-text-bright">{t("atlas.emptyTitle")}</h2><p className="mx-auto mt-2 max-w-lg text-sm">{t("atlas.emptyDescription",{limit:ATLAS_LIMIT})}</p><div aria-hidden="true" className="mx-auto mt-6 flex h-10 max-w-48 items-end justify-center gap-1 opacity-40">{[3, 5, 4, 8, 6, 10, 7, 9, 6, 11, 8, 10].map((height, index) => <span key={index} className="w-3 rounded-t bg-primary" style={{ height: height * 3 }} />)}</div></section> : <div className="grid items-stretch gap-3 md:grid-cols-2 xl:grid-cols-3">
        {saved.cards.map((pin, index) => pin.kind === "observer" ? <AtlasObserverCard key={atlasPinKey(pin)} pin={pin} range={saved.range} active={active} onViewObserver={actions.onViewObserver} onResolved={id=>update(value=>({...value,cards:value.cards.map(card=>atlasPinKey(card)===atlasPinKey(pin)?{...card,id}:card)}))} onRemove={()=>update(value=>({...value,cards:value.cards.filter(card=>atlasPinKey(card)!==atlasPinKey(pin))}))} reorder={<><button type="button" className="p-1 text-primary disabled:opacity-40" aria-label={t("atlas.moveEarlier")} disabled={index===0} onClick={()=>move(pin,-1)}>↑</button><button type="button" className="p-1 text-primary disabled:opacity-40" aria-label={t("atlas.moveLater")} disabled={index===saved.cards.length-1} onClick={()=>move(pin,1)}>↓</button></>} /> : <AtlasCard key={atlasPinKey(pin)} pin={pin} range={saved.range} active={active} first={index === 0} last={index === saved.cards.length - 1} heardOpen={heardKey === atlasPinKey(pin)} onHeardToggle={() => setHeardKey(value => value === atlasPinKey(pin) ? null : atlasPinKey(pin))} onRemove={() => update(value => ({ ...value, cards: value.cards.filter(node => atlasPinKey(node) !== atlasPinKey(pin)) }))} onMove={direction => update(value => {
          const nodes = [...value.cards]; const from = nodes.findIndex(node => atlasPinKey(node) === atlasPinKey(pin)); const to = from + direction;
          if (from < 0 || to < 0 || to >= nodes.length) return value;
          [nodes[from], nodes[to]] = [nodes[to]!, nodes[from]!];
          return { ...value, cards: nodes };
        })} {...actions} />)}
      </div>}
    </div>
  </section>;
}
