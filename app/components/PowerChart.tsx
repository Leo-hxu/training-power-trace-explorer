"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Sample } from "../lib/types";
import { totalPowerSeries } from "../lib/power-series";

const COLORS = ["#2563eb", "#0f9f6e", "#d97706", "#7c3aed", "#db2777", "#0891b2", "#65a30d", "#ea580c"];
const TOTAL_COLOR = "#172033";

type Point = Sample & { name: string; y: number };
type Range = [number, number];

function fmt(value: number | null | undefined, suffix: string, digits = 1) {
  return value === null || value === undefined ? "Not found" : `${value.toFixed(digits)}${suffix}`;
}

function niceMax(value: number) {
  const exponent = Math.pow(10, Math.floor(Math.log10(Math.max(value, 1))));
  return Math.ceil(value / exponent) * exponent;
}

export function PowerChart({
  samples,
  stages,
  loading,
}: {
  samples: Sample[];
  stages: { time_relative_s: number; stage: string }[];
  loading?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; range: Range } | null>(null);
  const [size, setSize] = useState({ width: 900, height: 420 });
  const [range, setRange] = useState<Range | null>(null);
  const [hover, setHover] = useState<{ point: Point; x: number; y: number } | null>(null);

  const gpuIds = useMemo(() => Array.from(new Set(samples.map((sample) => String(sample.gpu_id)))).sort(), [samples]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  useEffect(() => {
    setHidden(new Set());
    setRange(null);
  }, [gpuIds.join("|")]);

  const series = useMemo(() => {
    const map = new Map<string, Point[]>();
    for (const gpu of gpuIds) map.set(`GPU ${gpu}`, []);
    for (const sample of samples) {
      map.get(`GPU ${sample.gpu_id}`)?.push({ ...sample, name: `GPU ${sample.gpu_id}`, y: sample.power_w });
    }
    map.set("Total", totalPowerSeries(samples).map((sample) => ({ ...sample, name: "Total", y: sample.power_w })));
    for (const points of map.values()) points.sort((a, b) => a.time_relative_s - b.time_relative_s);
    return map;
  }, [samples, gpuIds]);

  const fullRange = useMemo<Range>(() => {
    if (!samples.length) return [0, 1];
    const values = samples.map((sample) => sample.time_relative_s);
    const min = Math.min(...values);
    const max = Math.max(...values);
    return min === max ? [min, min + 1] : [min, max];
  }, [samples]);
  const xRange = range ?? fullRange;

  useEffect(() => {
    if (!hostRef.current) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: Math.max(520, entry.contentRect.width), height: Math.max(360, entry.contentRect.height) });
    });
    observer.observe(hostRef.current);
    return () => observer.disconnect();
  }, []);

  const geometry = useMemo(() => {
    const margin = { left: 62, right: 22, top: 22, bottom: 48 };
    const plotWidth = Math.max(1, size.width - margin.left - margin.right);
    const plotHeight = Math.max(1, size.height - margin.top - margin.bottom);
    const visiblePoints = Array.from(series.entries())
      .filter(([name]) => !hidden.has(name))
      .flatMap(([, points]) => points.filter((point) => point.time_relative_s >= xRange[0] && point.time_relative_s <= xRange[1]));
    const maxY = niceMax(Math.max(100, ...visiblePoints.map((point) => point.y * 1.08)));
    const sx = (value: number) => margin.left + ((value - xRange[0]) / Math.max(0.000001, xRange[1] - xRange[0])) * plotWidth;
    const sy = (value: number) => margin.top + plotHeight - (value / maxY) * plotHeight;
    return { margin, plotWidth, plotHeight, maxY, sx, sy };
  }, [series, hidden, size, xRange]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(size.width * ratio);
    canvas.height = Math.floor(size.height * ratio);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.scale(ratio, ratio);
    context.clearRect(0, 0, size.width, size.height);
    const { margin, plotWidth, plotHeight, maxY, sx, sy } = geometry;

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size.width, size.height);
    context.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    context.textBaseline = "middle";
    for (let index = 0; index <= 5; index += 1) {
      const y = margin.top + (plotHeight / 5) * index;
      const value = maxY * (1 - index / 5);
      context.strokeStyle = index === 5 ? "#cfd7e6" : "#edf0f5";
      context.lineWidth = 1;
      context.beginPath(); context.moveTo(margin.left, y); context.lineTo(margin.left + plotWidth, y); context.stroke();
      context.fillStyle = "#667085";
      context.textAlign = "right";
      context.fillText(`${Math.round(value)}`, margin.left - 10, y);
    }
    for (let index = 0; index <= 6; index += 1) {
      const x = margin.left + (plotWidth / 6) * index;
      const value = xRange[0] + ((xRange[1] - xRange[0]) / 6) * index;
      context.strokeStyle = "#f1f3f7";
      context.beginPath(); context.moveTo(x, margin.top); context.lineTo(x, margin.top + plotHeight); context.stroke();
      context.fillStyle = "#667085";
      context.textAlign = "center";
      context.fillText(`${value.toFixed(value < 10 ? 1 : 0)}s`, x, margin.top + plotHeight + 20);
    }
    context.save();
    context.translate(16, margin.top + plotHeight / 2);
    context.rotate(-Math.PI / 2);
    context.fillStyle = "#344054";
    context.font = "600 11px Inter, system-ui, sans-serif";
    context.textAlign = "center";
    context.fillText("POWER (WATTS)", 0, 0);
    context.restore();
    context.fillStyle = "#344054";
    context.font = "600 11px Inter, system-ui, sans-serif";
    context.textAlign = "center";
    context.fillText("RELATIVE TIME", margin.left + plotWidth / 2, size.height - 10);

    context.save();
    context.beginPath();
    context.rect(margin.left, margin.top, plotWidth, plotHeight);
    context.clip();
    for (const marker of stages) {
      if (marker.time_relative_s < xRange[0] || marker.time_relative_s > xRange[1]) continue;
      const x = sx(marker.time_relative_s);
      context.strokeStyle = "rgba(148, 163, 184, .55)";
      context.setLineDash([3, 4]);
      context.beginPath(); context.moveTo(x, margin.top); context.lineTo(x, margin.top + plotHeight); context.stroke();
      context.setLineDash([]);
      context.save();
      context.translate(x + 4, margin.top + 8);
      context.rotate(Math.PI / 2);
      context.fillStyle = "#7c879b";
      context.font = "600 9px ui-monospace, monospace";
      context.textAlign = "left";
      context.fillText(marker.stage, 0, 0);
      context.restore();
    }
    Array.from(series.entries()).forEach(([name, points], seriesIndex) => {
      if (hidden.has(name) || points.length < 2) return;
      const color = name === "Total" ? TOTAL_COLOR : COLORS[seriesIndex % COLORS.length];
      context.strokeStyle = color;
      context.lineWidth = name === "Total" ? 2.5 : 1.55;
      context.globalAlpha = name === "Total" ? 1 : 0.78;
      context.beginPath();
      let drawing = false;
      for (const point of points) {
        if (point.time_relative_s < xRange[0] || point.time_relative_s > xRange[1]) continue;
        const x = sx(point.time_relative_s);
        const y = sy(point.y);
        if (!drawing) { context.moveTo(x, y); drawing = true; } else context.lineTo(x, y);
      }
      context.stroke();
    });
    context.globalAlpha = 1;
    context.restore();
  }, [geometry, hidden, series, size, stages, xRange]);

  useEffect(() => { draw(); }, [draw]);

  function nearestPoint(clientX: number, clientY: number) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const { margin, plotWidth, plotHeight, sx, sy } = geometry;
    if (x < margin.left || x > margin.left + plotWidth || y < margin.top || y > margin.top + plotHeight) return null;
    let best: { point: Point; distance: number } | null = null;
    for (const [name, points] of series.entries()) {
      if (hidden.has(name)) continue;
      for (const point of points) {
        if (point.time_relative_s < xRange[0] || point.time_relative_s > xRange[1]) continue;
        const distance = Math.hypot(sx(point.time_relative_s) - x, sy(point.y) - y);
        if (!best || distance < best.distance) best = { point, distance };
      }
    }
    return best && best.distance < 34 ? { point: best.point, x, y } : null;
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (dragRef.current) {
      const rect = event.currentTarget.getBoundingClientRect();
      const dx = event.clientX - dragRef.current.x;
      const duration = dragRef.current.range[1] - dragRef.current.range[0];
      const shift = -(dx / Math.max(1, geometry.plotWidth)) * duration;
      let start = dragRef.current.range[0] + shift;
      let end = dragRef.current.range[1] + shift;
      if (start < fullRange[0]) { end += fullRange[0] - start; start = fullRange[0]; }
      if (end > fullRange[1]) { start -= end - fullRange[1]; end = fullRange[1]; }
      setRange([Math.max(fullRange[0], start), Math.min(fullRange[1], end)]);
      setHover(null);
      return;
    }
    setHover(nearestPoint(event.clientX, event.clientY));
  }

  function handleWheel(event: React.WheelEvent<HTMLCanvasElement>) {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const position = Math.min(1, Math.max(0, (event.clientX - rect.left - geometry.margin.left) / geometry.plotWidth));
    const current = xRange;
    const duration = current[1] - current[0];
    const nextDuration = Math.min(fullRange[1] - fullRange[0], Math.max((fullRange[1] - fullRange[0]) / 250, duration * (event.deltaY > 0 ? 1.18 : 0.82)));
    const focus = current[0] + duration * position;
    let start = focus - nextDuration * position;
    let end = start + nextDuration;
    if (start < fullRange[0]) { start = fullRange[0]; end = start + nextDuration; }
    if (end > fullRange[1]) { end = fullRange[1]; start = end - nextDuration; }
    setRange([start, end]);
  }

  function toggleSeries(name: string) {
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  return (
    <div className="chart-shell">
      <div className="chart-legend" aria-label="Power line visibility">
        {Array.from(series.keys()).map((name, index) => (
          <button key={name} type="button" className={hidden.has(name) ? "is-hidden" : ""} onClick={() => toggleSeries(name)}>
            <i style={{ background: name === "Total" ? TOTAL_COLOR : COLORS[index % COLORS.length] }} />{name}
          </button>
        ))}
        <span className="chart-hint">Scroll to zoom · drag to pan</span>
      </div>
      <div className="chart-canvas-host" ref={hostRef}>
        <canvas
          ref={canvasRef}
          aria-label="Interactive GPU power trace plot"
          onWheel={handleWheel}
          onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); dragRef.current = { x: event.clientX, range: xRange }; }}
          onPointerMove={handlePointerMove}
          onPointerUp={() => { dragRef.current = null; }}
          onPointerCancel={() => { dragRef.current = null; }}
          onPointerLeave={() => { if (!dragRef.current) setHover(null); }}
          onDoubleClick={() => setRange(null)}
        />
        {loading ? <div className="chart-loading"><span className="loading-spinner" /> Loading samples…</div> : null}
        {!loading && samples.length === 0 ? <div className="chart-loading">No samples are available for this range.</div> : null}
        {range ? <button className="reset-zoom" type="button" onClick={() => setRange(null)}>↺ Reset zoom</button> : null}
        {hover ? (
          <div className="chart-tooltip" style={{ left: Math.min(size.width - 230, hover.x + 16), top: Math.max(12, hover.y - 48) }}>
            <strong>{hover.point.name}</strong><span>{fmt(hover.point.time_relative_s, " s", 3)} · {fmt(hover.point.y, " W")}</span>
            <dl>
              <div><dt>Timestamp</dt><dd>{hover.point.timestamp}</dd></div>
              <div><dt>GPU util</dt><dd>{fmt(hover.point.gpu_util_pct, "%")}</dd></div>
              <div><dt>Memory util</dt><dd>{fmt(hover.point.memory_util_pct, "%")}</dd></div>
              <div><dt>SM clock</dt><dd>{fmt(hover.point.sm_clock_mhz, " MHz", 0)}</dd></div>
              <div><dt>Temperature</dt><dd>{fmt(hover.point.temperature_c, " °C")}</dd></div>
            </dl>
          </div>
        ) : null}
      </div>
    </div>
  );
}
