from __future__ import annotations

import unittest

from backend.metrics import compute_metrics, rolling_average, total_power_series


class MetricsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.records = [
            {"time_relative_s": 0.0, "timestamp": "0", "gpu_id": "0", "power_w": 100.0},
            {"time_relative_s": 0.0, "timestamp": "0", "gpu_id": "1", "power_w": 120.0},
            {"time_relative_s": 1.0, "timestamp": "1", "gpu_id": "0", "power_w": 200.0},
            {"time_relative_s": 1.0, "timestamp": "1", "gpu_id": "1", "power_w": 220.0},
            {"time_relative_s": 2.5, "timestamp": "2.5", "gpu_id": "0", "power_w": 300.0},
            {"time_relative_s": 2.5, "timestamp": "2.5", "gpu_id": "1", "power_w": 320.0},
        ]

    def test_total_power_groups_gpus_by_timestamp(self) -> None:
        totals = total_power_series(self.records)
        self.assertEqual([row["total_power_w"] for row in totals], [220.0, 420.0, 620.0])

    def test_energy_uses_observed_intervals(self) -> None:
        metrics = compute_metrics(self.records)
        expected_ws = ((220 + 420) / 2 * 1.0) + ((420 + 620) / 2 * 1.5)
        self.assertAlmostEqual(metrics["total_energy_wh"], expected_ws / 3600)
        self.assertAlmostEqual(metrics["sampling_interval_observed_median_s"], 1.25)

    def test_rolling_average_is_per_gpu_and_time_windowed(self) -> None:
        averaged = rolling_average(self.records, 1.0)
        gpu_zero = [row for row in averaged if row["gpu_id"] == "0"]
        self.assertEqual([row["power_w"] for row in gpu_zero], [100.0, 150.0, 300.0])


if __name__ == "__main__":
    unittest.main()

