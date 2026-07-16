from __future__ import annotations

import bisect
import math
import statistics
from collections import defaultdict, deque
from typing import Any, Iterable


def percentile(values: list[float], p: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    rank = (len(ordered) - 1) * p
    lower = math.floor(rank)
    upper = math.ceil(rank)
    if lower == upper:
        return ordered[lower]
    weight = rank - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def total_power_series(records: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[float, dict[str, Any]] = {}
    for record in records:
        time_s = float(record["time_relative_s"])
        bucket = grouped.setdefault(
            time_s,
            {
                "time_relative_s": time_s,
                "timestamp": record.get("timestamp"),
                "total_power_w": 0.0,
                "gpu_count": 0,
            },
        )
        power = record.get("power_w")
        if power is not None:
            bucket["total_power_w"] += float(power)
            bucket["gpu_count"] += 1
    return sorted(grouped.values(), key=lambda row: row["time_relative_s"])


def _sampling_intervals(series: list[dict[str, Any]]) -> list[float]:
    times = [float(row["time_relative_s"]) for row in series]
    return [b - a for a, b in zip(times, times[1:]) if b - a > 0]


def _integrate_energy(series: list[dict[str, Any]]) -> float:
    energy_ws = 0.0
    for left, right in zip(series, series[1:]):
        dt = float(right["time_relative_s"]) - float(left["time_relative_s"])
        if dt <= 0:
            continue
        mean_power = (float(left["total_power_w"]) + float(right["total_power_w"])) / 2
        energy_ws += mean_power * dt
    return energy_ws / 3600


def _interpolate_at(times: list[float], values: list[float], target: float) -> float | None:
    if not times or target < times[0] or target > times[-1]:
        return None
    index = bisect.bisect_left(times, target)
    if index == 0:
        return values[0]
    if index >= len(times):
        return values[-1]
    if times[index] == target:
        return values[index]
    left_t, right_t = times[index - 1], times[index]
    if right_t == left_t:
        return values[index]
    weight = (target - left_t) / (right_t - left_t)
    return values[index - 1] + weight * (values[index] - values[index - 1])


def ramp_metrics(series: list[dict[str, Any]], delta_s: float) -> dict[str, float | None]:
    times = [float(row["time_relative_s"]) for row in series]
    values = [float(row["total_power_w"]) for row in series]
    ramps: list[float] = []
    for time_s, value in zip(times, values, strict=False):
        past = _interpolate_at(times, values, time_s - delta_s)
        if past is not None:
            ramps.append((value - past) / delta_s)
    upward = [value for value in ramps if value >= 0]
    downward = [-value for value in ramps if value < 0]
    threshold = percentile(upward, 0.95) if upward else None
    duration_min = max((times[-1] - times[0]) / 60, 1 / 60) if len(times) > 1 else 1 / 60
    event_count = sum(1 for value in upward if threshold is not None and value >= threshold)
    return {
        "p95_up_w_per_s": percentile(upward, 0.95),
        "p99_up_w_per_s": percentile(upward, 0.99),
        "p99_down_w_per_s": percentile(downward, 0.99),
        "event_frequency_per_min": event_count / duration_min,
    }


def compute_metrics(records: list[dict[str, Any]]) -> dict[str, Any]:
    series = total_power_series(records)
    totals = [float(row["total_power_w"]) for row in series]
    intervals = _sampling_intervals(series)
    gpu_ids = {str(row.get("gpu_id")) for row in records}
    duration_s = (
        float(series[-1]["time_relative_s"]) - float(series[0]["time_relative_s"])
        if len(series) > 1
        else 0.0
    )
    mean_total = statistics.fmean(totals) if totals else None
    ramp_1 = ramp_metrics(series, 1.0)
    ramp_5 = ramp_metrics(series, 5.0)
    ramp_10 = ramp_metrics(series, 10.0)
    return {
        "duration_observed_s": duration_s,
        "sampling_interval_observed_median_s": statistics.median(intervals) if intervals else None,
        "sampling_interval_observed_p95_s": percentile(intervals, 0.95),
        "mean_total_power_w": mean_total,
        "p95_total_power_w": percentile(totals, 0.95),
        "p99_total_power_w": percentile(totals, 0.99),
        "max_total_power_w": max(totals) if totals else None,
        "total_energy_wh": _integrate_energy(series),
        "mean_power_per_gpu_w": (mean_total / len(gpu_ids)) if mean_total is not None and gpu_ids else None,
        "ramp_up_p95_1s_w_per_s": ramp_1["p95_up_w_per_s"],
        "ramp_up_p99_1s_w_per_s": ramp_1["p99_up_w_per_s"],
        "ramp_down_p99_1s_w_per_s": ramp_1["p99_down_w_per_s"],
        "ramp_event_frequency_1s": ramp_1["event_frequency_per_min"],
        "ramp_metrics": {"1s": ramp_1, "5s": ramp_5, "10s": ramp_10},
        "num_samples": len(records),
        "num_gpus_observed": len(gpu_ids),
    }


def rolling_average(records: list[dict[str, Any]], window_s: float) -> list[dict[str, Any]]:
    if window_s <= 0:
        return [dict(row) for row in records]
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        grouped[str(record.get("gpu_id"))].append(dict(record))
    result: list[dict[str, Any]] = []
    for rows in grouped.values():
        rows.sort(key=lambda item: float(item["time_relative_s"]))
        window: deque[tuple[float, float]] = deque()
        running_sum = 0.0
        for row in rows:
            time_s = float(row["time_relative_s"])
            power = float(row["power_w"])
            window.append((time_s, power))
            running_sum += power
            while window and window[0][0] < time_s - window_s:
                running_sum -= window.popleft()[1]
            row["power_w"] = running_sum / len(window)
            result.append(row)
    return sorted(result, key=lambda item: (float(item["time_relative_s"]), str(item.get("gpu_id"))))


def peak_preserving_downsample(records: list[dict[str, Any]], target_points_per_gpu: int) -> list[dict[str, Any]]:
    if target_points_per_gpu <= 0:
        return records
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        grouped[str(record.get("gpu_id"))].append(record)
    sampled: list[dict[str, Any]] = []
    for rows in grouped.values():
        rows.sort(key=lambda item: float(item["time_relative_s"]))
        if len(rows) <= target_points_per_gpu:
            sampled.extend(rows)
            continue
        interior_target = max(1, target_points_per_gpu - 2)
        bucket_size = max(1, math.ceil((len(rows) - 2) / max(1, interior_target / 2)))
        selected = [rows[0]]
        for start in range(1, len(rows) - 1, bucket_size):
            bucket = rows[start : min(len(rows) - 1, start + bucket_size)]
            if not bucket:
                continue
            low = min(bucket, key=lambda item: float(item["power_w"]))
            high = max(bucket, key=lambda item: float(item["power_w"]))
            selected.extend(sorted({id(low): low, id(high): high}.values(), key=lambda item: float(item["time_relative_s"])))
        selected.append(rows[-1])
        if len(selected) > target_points_per_gpu:
            stride = len(selected) / target_points_per_gpu
            selected = [selected[min(len(selected) - 1, int(i * stride))] for i in range(target_points_per_gpu)]
        sampled.extend(selected)
    return sorted(sampled, key=lambda item: (float(item["time_relative_s"]), str(item.get("gpu_id"))))

