import { useMemo } from "react";
import type { InferenceRequestTimelinePoint } from "./public-data";

type TimelinePoint = {
  time: number;
  windowS: number;
  arrivals: number | null;
  activeRequests: number | null;
  promptTokens: number | null;
  outputTokens: number | null;
  requestTokens: number | null;
};

const WIDTH = 1120;
const HEIGHT = 356;
const MARGIN = { left: 66, right: 24, top: 24, bottom: 40 };
const ARRIVAL_HEIGHT = 104;
const PANEL_GAP = 58;
const TOKEN_HEIGHT = 104;

function asNumber(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundedMax(value: number, floor = 1) {
  const safe = Math.max(floor, value);
  const magnitude = 10 ** Math.floor(Math.log10(safe));
  return Math.ceil(safe / magnitude) * magnitude;
}

function timeLabel(value: number) {
  if (value >= 60) return `${(value / 60).toFixed(value >= 600 ? 0 : 1)} min`;
  return `${value.toFixed(value < 10 ? 1 : 0)} s`;
}

function linePoints(points: TimelinePoint[], value: (point: TimelinePoint) => number | null, x: (time: number) => number, y: (value: number) => number) {
  return points
    .filter((point) => value(point) !== null)
    .map((point) => `${x(point.time).toFixed(2)},${y(value(point)!).toFixed(2)}`)
    .join(" ");
}

function pointLabel(point: TimelinePoint) {
  const details = [
    `${timeLabel(point.time)}`,
    point.arrivals === null ? null : `${point.arrivals} arrivals`,
    point.activeRequests === null ? null : `${point.activeRequests} active`,
    point.requestTokens === null ? null : `${Math.round(point.requestTokens).toLocaleString()} mean tokens`,
  ].filter(Boolean);
  return details.join(" · ");
}

/**
 * Renders request arrivals and request-size telemetry beneath an inference
 * power trace. Both panels share the power trace's full relative-time range,
 * so workload changes can be read directly against GPU power changes.
 */
export function InferenceRequestTimeline({
  timeline,
  powerTimeRange,
  synthetic = false,
}: {
  timeline?: InferenceRequestTimelinePoint[];
  powerTimeRange?: [number, number];
  synthetic?: boolean;
}) {
  const chart = useMemo(() => {
    const points: TimelinePoint[] = (timeline ?? [])
      .map((point) => {
        const promptTokens = asNumber(point.mean_prompt_tokens);
        const outputTokens = asNumber(point.mean_output_tokens);
        const statedTotal = asNumber(point.mean_request_tokens);
        return {
          time: asNumber(point.time_relative_s),
          windowS: Math.max(0.1, asNumber(point.window_s) ?? 1),
          arrivals: asNumber(point.requests_arrived),
          activeRequests: asNumber(point.active_requests),
          promptTokens,
          outputTokens,
          requestTokens: statedTotal ?? (promptTokens === null && outputTokens === null ? null : (promptTokens ?? 0) + (outputTokens ?? 0)),
        };
      })
      .filter((point): point is TimelinePoint & { time: number } => point.time !== null)
      .sort((left, right) => left.time - right.time);

    const hasArrivals = points.some((point) => point.arrivals !== null);
    const hasRequestSize = points.some((point) => point.requestTokens !== null);
    const timelineStart = points[0]?.time ?? 0;
    const timelineEnd = points[points.length - 1]?.time ?? timelineStart + 1;
    const requestedStart = powerTimeRange?.[0];
    const requestedEnd = powerTimeRange?.[1];
    const start = Number.isFinite(requestedStart) ? requestedStart! : timelineStart;
    const endCandidate = Number.isFinite(requestedEnd) ? requestedEnd! : timelineEnd;
    const end = endCandidate > start ? endCandidate : start + 1;
    const arrivalMax = roundedMax(Math.max(0, ...points.map((point) => point.arrivals ?? 0)));
    const tokenMax = roundedMax(Math.max(0, ...points.map((point) => point.requestTokens ?? 0)), 100);
    return { points, hasArrivals, hasRequestSize, start, end, arrivalMax, tokenMax };
  }, [powerTimeRange, timeline]);

  const chartWidth = WIDTH - MARGIN.left - MARGIN.right;
  const arrivalTop = MARGIN.top + 20;
  const tokenTop = arrivalTop + ARRIVAL_HEIGHT + PANEL_GAP;
  const chartBottom = tokenTop + TOKEN_HEIGHT;
  const x = (time: number) => MARGIN.left + ((time - chart.start) / (chart.end - chart.start)) * chartWidth;
  const arrivalY = (value: number) => arrivalTop + ARRIVAL_HEIGHT - (value / chart.arrivalMax) * ARRIVAL_HEIGHT;
  const tokenY = (value: number) => tokenTop + TOKEN_HEIGHT - (value / chart.tokenMax) * TOKEN_HEIGHT;
  const tickTimes = Array.from({ length: 5 }, (_, index) => chart.start + ((chart.end - chart.start) * index) / 4);
  const averageWindow = chart.points.length
    ? chart.points.reduce((sum, point) => sum + point.windowS, 0) / chart.points.length
    : 1;
  const barWidth = Math.max(2, Math.min(28, (averageWindow / (chart.end - chart.start)) * chartWidth * 0.74));

  if (!chart.points.length || (!chart.hasArrivals && !chart.hasRequestSize)) {
    return <section className="inference-timeline-card inference-timeline-empty">
      <div className="timeline-heading"><div><p className="eyebrow">Inference request telemetry</p><h2>Serving demand over time</h2></div><span>Optional data</span></div>
      <p>This run has no request-arrival or request-size timeline. Include request-event data to align serving demand with the GPU power trace.</p>
    </section>;
  }

  return <section className="inference-timeline-card" aria-labelledby="inference-timeline-title">
    <div className="timeline-heading">
      <div><p className="eyebrow">Inference request telemetry</p><h2 id="inference-timeline-title">Serving demand over time</h2><p>The x-axis matches the full relative-time range of the GPU power trace above.</p></div>
      <div className="timeline-heading-side">
        {synthetic ? <span className="timeline-synthetic-badge">Synthetic demo</span> : null}
        <div className="timeline-legend" aria-label="Inference request chart legend">
          <span><i className="legend-arrivals" /> Arrivals</span>
          <span><i className="legend-prompt" /> Prompt tokens</span>
          <span><i className="legend-output" /> Output tokens</span>
          <span><i className="legend-total" /> Total request size</span>
        </div>
      </div>
    </div>
    <div className="inference-timeline-svg-wrap">
      <svg className="inference-timeline-svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Request arrivals and request token size aligned to the inference power trace timeline">
        <defs>
          <linearGradient id="arrival-bar-gradient" x1="0" x2="0" y1="0" y2="1"><stop stopColor="#28a77b" /><stop offset="1" stopColor="#16795d" /></linearGradient>
        </defs>
        {[0, 0.5, 1].map((fraction) => <g key={`arrival-grid-${fraction}`}>
          <line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={arrivalY(chart.arrivalMax * fraction)} y2={arrivalY(chart.arrivalMax * fraction)} className="timeline-grid-line" />
          <text x={MARGIN.left - 10} y={arrivalY(chart.arrivalMax * fraction) + 4} className="timeline-y-label" textAnchor="end">{Math.round(chart.arrivalMax * fraction)}</text>
        </g>)}
        {[0, 0.5, 1].map((fraction) => <g key={`token-grid-${fraction}`}>
          <line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={tokenY(chart.tokenMax * fraction)} y2={tokenY(chart.tokenMax * fraction)} className="timeline-grid-line" />
          <text x={MARGIN.left - 10} y={tokenY(chart.tokenMax * fraction) + 4} className="timeline-y-label" textAnchor="end">{Math.round(chart.tokenMax * fraction).toLocaleString()}</text>
        </g>)}
        {tickTimes.map((time) => <g key={`x-grid-${time}`}>
          <line x1={x(time)} x2={x(time)} y1={arrivalTop} y2={chartBottom} className="timeline-x-grid-line" />
          <text x={x(time)} y={chartBottom + 25} className="timeline-x-label" textAnchor="middle">{timeLabel(time)}</text>
        </g>)}
        <text x={MARGIN.left} y={arrivalTop - 9} className="timeline-panel-label">REQUESTS ARRIVED / WINDOW</text>
        <text x={MARGIN.left} y={tokenTop - 9} className="timeline-panel-label">MEAN REQUEST SIZE (TOKENS)</text>
        {chart.hasArrivals && chart.points.map((point, index) => point.arrivals === null ? null : <rect key={`arrival-${index}`} x={x(point.time) - barWidth / 2} y={arrivalY(point.arrivals)} width={barWidth} height={Math.max(1, arrivalTop + ARRIVAL_HEIGHT - arrivalY(point.arrivals))} rx="1.5" fill="url(#arrival-bar-gradient)">
          <title>{pointLabel(point)}</title>
        </rect>)}
        {chart.hasRequestSize && <>
          <polyline points={linePoints(chart.points, (point) => point.promptTokens, x, tokenY)} className="timeline-line timeline-line-prompt" />
          <polyline points={linePoints(chart.points, (point) => point.outputTokens, x, tokenY)} className="timeline-line timeline-line-output" />
          <polyline points={linePoints(chart.points, (point) => point.requestTokens, x, tokenY)} className="timeline-line timeline-line-total" />
          {chart.points.map((point, index) => point.requestTokens === null ? null : <circle key={`token-${index}`} cx={x(point.time)} cy={tokenY(point.requestTokens)} r="2.5" className="timeline-token-point"><title>{pointLabel(point)}</title></circle>)}
        </>}
        <text x={MARGIN.left + chartWidth / 2} y={HEIGHT - 7} className="timeline-axis-label" textAnchor="middle">RELATIVE TIME</text>
      </svg>
    </div>
    <p className="timeline-footnote">{synthetic ? "Illustrative deterministic request telemetry for this demo; it is not a measured production request log. " : ""}Bars show arrivals per reported time window. Hover a bar or point for the available arrival, active-request, and token values.</p>
  </section>;
}
