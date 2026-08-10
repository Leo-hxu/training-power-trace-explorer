import type { Sample } from "./types";

type TimeBucket = {
  samples: Sample[];
  samplesByGpu: Map<string, Sample[]>;
};

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function totalBucketWidth(samples: Sample[]): number {
  const byGpu = new Map<string, Sample[]>();
  for (const sample of samples) {
    const rows = byGpu.get(sample.gpu_id);
    if (rows) rows.push(sample);
    else byGpu.set(sample.gpu_id, [sample]);
  }

  const intervals: number[] = [];
  for (const rows of byGpu.values()) {
    const ordered = [...rows].sort((left, right) => left.time_relative_s - right.time_relative_s);
    for (let index = 1; index < ordered.length; index += 1) {
      const interval = ordered[index].time_relative_s - ordered[index - 1].time_relative_s;
      if (Number.isFinite(interval) && interval > 0) intervals.push(interval);
    }
  }

  return Math.max(0.000001, median(intervals) ?? 1);
}

function bucketKey(time: number, width: number) {
  return Math.round(time / width);
}

function buildTimeBuckets(samples: Sample[], width = totalBucketWidth(samples)) {
  const buckets = new Map<number, TimeBucket>();
  for (const sample of samples) {
    const key = bucketKey(sample.time_relative_s, width);
    const bucket = buckets.get(key) ?? { samples: [], samplesByGpu: new Map<string, Sample[]>() };
    bucket.samples.push(sample);
    const gpuSamples = bucket.samplesByGpu.get(sample.gpu_id);
    if (gpuSamples) gpuSamples.push(sample);
    else bucket.samplesByGpu.set(sample.gpu_id, [sample]);
    buckets.set(key, bucket);
  }
  return [...buckets.entries()]
    .sort(([left], [right]) => left - right)
    .map(([key, bucket]) => ({ key, bucket }));
}

function bucketTotal(bucket: TimeBucket) {
  let total = 0;
  for (const rows of bucket.samplesByGpu.values()) {
    total += rows.reduce((sum, row) => sum + row.power_w, 0) / rows.length;
  }
  return total;
}

/**
 * Adds a common total-power value to every GPU sample in the same inferred
 * sampling interval. GPU logger timestamps often differ by a few milliseconds,
 * so exact timestamp equality cannot be used for aggregation.
 */
export function withComputedTotalPower(samples: Sample[]): Sample[] {
  if (!samples.length) return samples;
  const width = totalBucketWidth(samples);
  const totals = new Map<number, number>();
  for (const { key, bucket } of buildTimeBuckets(samples, width)) totals.set(key, bucketTotal(bucket));

  return samples.map((sample) => ({
    ...sample,
    total_power_w: totals.get(bucketKey(sample.time_relative_s, width)) ?? sample.power_w,
  }));
}

/** Returns one aggregate Total point for each inferred sampling interval. */
export function totalPowerSeries(samples: Sample[]): Sample[] {
  return buildTimeBuckets(samples).map(({ bucket }) => {
    const representative = bucket.samples[0];
    const total = bucketTotal(bucket);
    return {
      ...representative,
      gpu_id: "Total",
      time_relative_s: bucket.samples.reduce((sum, sample) => sum + sample.time_relative_s, 0) / bucket.samples.length,
      power_w: total,
      total_power_w: total,
      sm_clock_mhz: null,
      gpu_util_pct: null,
      memory_util_pct: null,
      memory_used_mb: null,
      memory_total_mb: null,
      temperature_c: null,
      stage: null,
    };
  });
}
