from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PROJECT_ROOT = Path("/scratch/hx2493/project/llm_example_run")
DEMO_PROJECT_ROOT = REPO_ROOT / "demo_project"

SOURCE_DIRECTORY_NAMES = (
    "traces",
    "logs_train",
    "slurm",
    "trace2flex_pilot_v1",
    "trace2flex_pilot_l40s_v1",
    "trace2flex_pilot_h200_v2",
    "trace2flex_pilot_h100_v1",
    "trace2flex_pilot_a100_v1",
    "PowerTraces",
)


@dataclass(frozen=True)
class Settings:
    project_root: Path
    cache_dir: Path
    source_directories: tuple[Path, ...]
    allow_open_folder: bool


def get_settings() -> Settings:
    configured_root = os.environ.get("TRACE_EXPLORER_PROJECT_ROOT")
    if configured_root:
        project_root = Path(configured_root).expanduser().resolve()
    elif DEFAULT_PROJECT_ROOT.exists():
        project_root = DEFAULT_PROJECT_ROOT
    else:
        project_root = DEMO_PROJECT_ROOT

    configured_cache = os.environ.get("TRACE_EXPLORER_CACHE_DIR")
    cache_dir = (
        Path(configured_cache).expanduser().resolve()
        if configured_cache
        else project_root / "trace_explorer_cache"
    )

    extra_roots = [
        Path(value).expanduser().resolve()
        for value in os.environ.get("TRACE_EXPLORER_EXTRA_DIRS", "").split(os.pathsep)
        if value.strip()
    ]
    sources = [project_root / name for name in SOURCE_DIRECTORY_NAMES]
    sources.extend(extra_roots)

    return Settings(
        project_root=project_root,
        cache_dir=cache_dir,
        source_directories=tuple(sources),
        allow_open_folder=os.environ.get("TRACE_EXPLORER_ALLOW_OPEN_FOLDER") == "1",
    )

