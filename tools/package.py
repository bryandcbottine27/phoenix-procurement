#!/usr/bin/env python3
"""Build the two approved Phoenix Procurement package zips.

Both zips are full project snapshots. The demo package carries the demo dist file.
The production package carries the production dist file and production APP_CONFIG
values inside its staged copy only.
"""
from __future__ import annotations

import shutil
import tempfile
import zipfile
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEMO_ZIP = ROOT / "Phoenix Procurement DEMO FULL.zip"
PROD_ZIP = ROOT / "Phoenix Procurement PRODUCTION FULL.zip"
APPROVED_ZIPS = {DEMO_ZIP.name, PROD_ZIP.name}
DEMO_DIST = "phoenix-procurement-DEMO.html"
PROD_DIST = "phoenix-procurement-PRODUCTION.html"


def rel_parts(path: Path) -> tuple[str, ...]:
    return path.relative_to(ROOT).parts


def is_root_zip(path: Path) -> bool:
    parts = rel_parts(path)
    return len(parts) == 1 and path.suffix.lower() == ".zip"


def is_secret_or_key(path: Path) -> bool:
    name = path.name.lower()
    rel = path.relative_to(ROOT).as_posix().lower()
    return (
        name in {".env"}
        or name.startswith(".env.")
        or name.endswith((".key", ".pem", ".pfx"))
        or ("service-account" in name and name.endswith(".json"))
        or ("connection" in name and name.endswith(".json"))
        or rel == "backend/local.settings.json"
    )


def should_exclude(path: Path) -> bool:
    parts = rel_parts(path)
    lowered = tuple(part.lower() for part in parts)
    rel = path.relative_to(ROOT).as_posix().lower()
    name = path.name.lower()

    if ".git" in lowered:
        return True
    if "__pycache__" in lowered:
        return True
    if "node_modules" in lowered:
        return True
    if rel == "backend/dist" or rel.startswith("backend/dist/"):
        return True
    if rel == "backend/local.settings.json":
        return True
    if "scratchpadall_functions.txt" in name:
        return True
    if rel.startswith("backend/secrets/"):
        return True
    if is_root_zip(path):
        return True
    if path.is_file() and is_secret_or_key(path):
        return True
    if path.is_file() and name.endswith(".pyc"):
        return True
    return False


def copy_snapshot(destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    for current, dirs, files in os.walk(ROOT):
        current_path = Path(current)
        dirs[:] = [name for name in dirs if not should_exclude(current_path / name)]
        if current_path != ROOT:
            (destination / current_path.relative_to(ROOT)).mkdir(parents=True, exist_ok=True)
        for name in files:
            source = current_path / name
            if should_exclude(source):
                continue
            target = destination / source.relative_to(ROOT)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)


def replace_required(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    if old not in text:
        raise RuntimeError(f"Expected text not found in {path.relative_to(path.parents[1])}: {old}")
    path.write_text(text.replace(old, new), encoding="utf-8")


def keep_only_dist(stage: Path, filename: str) -> None:
    dist_dir = stage / "dist"
    for item in dist_dir.glob("*"):
        if item.name != filename:
            if item.is_dir():
                shutil.rmtree(item)
            else:
                item.unlink()


def make_production(stage: Path) -> None:
    demo_dist = stage / "dist" / DEMO_DIST
    prod_dist = stage / "dist" / PROD_DIST
    if not demo_dist.exists():
        raise RuntimeError(f"Missing demo dist file needed to stage production: {demo_dist}")
    demo_dist.rename(prod_dist)

    for path in [stage / "src" / "core.js", prod_dist]:
        replace_required(path, "demoMode: true,", "demoMode: false,")
        replace_required(path, "authMode: 'demo',", "authMode: 'internal',")
        replace_required(path, "dataMode: 'firebase',", "dataMode: 'api',")

    build_py = stage / "build.py"
    replace_required(build_py, "phoenix-procurement-DEMO.html", "phoenix-procurement-PRODUCTION.html")
    keep_only_dist(stage, PROD_DIST)


def make_demo(stage: Path) -> None:
    demo_dist = stage / "dist" / DEMO_DIST
    if not demo_dist.exists():
        raise RuntimeError(f"Missing demo dist file: {demo_dist}")
    keep_only_dist(stage, DEMO_DIST)


def write_zip(source_dir: Path, zip_path: Path) -> None:
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as archive:
        for file_path in sorted(path for path in source_dir.rglob("*") if path.is_file()):
            archive.write(file_path, file_path.relative_to(source_dir).as_posix())


def main() -> None:
    for zip_path in [DEMO_ZIP, PROD_ZIP]:
        if zip_path.exists():
            zip_path.unlink()

    with tempfile.TemporaryDirectory(prefix="phoenix-package-") as tmp:
        tmp_root = Path(tmp)
        demo_stage = tmp_root / "demo"
        prod_stage = tmp_root / "production"
        copy_snapshot(demo_stage)
        copy_snapshot(prod_stage)
        make_demo(demo_stage)
        make_production(prod_stage)
        write_zip(demo_stage, DEMO_ZIP)
        write_zip(prod_stage, PROD_ZIP)

    root_zips = {path.name for path in ROOT.glob("*.zip")}
    if root_zips != APPROVED_ZIPS:
        raise RuntimeError(f"Unexpected root zip set: {sorted(root_zips)}")
    print(f"Wrote {DEMO_ZIP.name}")
    print(f"Wrote {PROD_ZIP.name}")


if __name__ == "__main__":
    main()
