const SPARK_W = 120;
const SPARK_H = 20;
const sparkSpacer = <div className="mt-1.5 h-[20px]" />;

export function Sparkline({ values, color, markPeak, times, gapMs }: { values: (number | null)[]; color: string; markPeak?: boolean; times?: number[]; gapMs?: number }) {
  const known = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (values.length < 2 || known.length < 2) return sparkSpacer;
  const max = Math.max(...known);
  const min = Math.min(...known);
  const range = max - min || 1;
  const timed = times?.length === values.length && times.every(Number.isFinite) && times.at(-1)! > times[0]! ? times : null;
  const x = (i: number) => timed ? (timed[i]! - timed[0]!) / (timed.at(-1)! - timed[0]!) * SPARK_W : (i / (values.length - 1)) * SPARK_W;
  const y = (v: number) => SPARK_H - 1 - ((v - min) / range) * (SPARK_H - 2);
  // A null hour breaks the line, so an outage shows as a gap rather than a straight join.
  const runs: string[][] = [[]];
  values.forEach((v, i) => {
    if (timed && gapMs && i > 0 && timed[i]! - timed[i - 1]! > gapMs) runs.push([]);
    if (v === null || !Number.isFinite(v)) runs.push([]);
    else runs[runs.length - 1]!.push(`${x(i)},${y(v)}`);
  });
  const peak = values.indexOf(max);
  return (
    <svg width="100%" height={SPARK_H} viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} preserveAspectRatio="none" className="mt-1.5 overflow-visible" aria-hidden>
      {runs.filter((run) => run.length > 1).map((run) => (
        <polyline key={run[0]} fill="none" stroke={color} strokeWidth="1.5" points={run.join(" ")} />
      ))}
      {markPeak && (
        // zero-length round-capped stroke: stays a circle under preserveAspectRatio="none"
        <line data-peak x1={x(peak)} x2={x(peak)} y1={y(max)} y2={y(max)} stroke={color} strokeWidth="5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      )}
    </svg>
  );
}

// One bar per run of hours that reported, so gaps read at a glance.
export function PresenceStrip({ hours, color }: { hours: boolean[]; color: string }) {
  if (hours.length === 0) return sparkSpacer;
  const slot = SPARK_W / hours.length;
  const bars: { start: number; length: number }[] = [];
  hours.forEach((on, i) => {
    const last = bars.at(-1);
    if (!on) return;
    if (last && last.start + last.length === i) last.length++;
    else bars.push({ start: i, length: 1 });
  });
  return (
    <svg width="100%" height={SPARK_H} viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} preserveAspectRatio="none" className="mt-1.5" aria-hidden>
      <line x1="0" x2={SPARK_W} y1={SPARK_H / 2} y2={SPARK_H / 2} stroke={color} strokeWidth="1" opacity="0.25" />
      {bars.map((bar) => (
        <rect key={bar.start} x={bar.start * slot} y={SPARK_H / 2 - 4} width={bar.length * slot} height="8" fill={color} />
      ))}
    </svg>
  );
}
