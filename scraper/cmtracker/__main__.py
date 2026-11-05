"""Kommandozeile: `python -m cmtracker catalog`."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from . import catalog, review
from .settings import DEFAULT_SCOPE_PATH, load_scope
from .sources import SourceError
from .storage import storage_from_env


def cmd_catalog(args: argparse.Namespace) -> int:
    scope = load_scope(args.scope)
    storage = storage_from_env()
    try:
        result = catalog.run(scope, storage)
    except (SourceError, catalog.ValidationError) as err:
        print(f"❌ {err}", file=sys.stderr, flush=True)
        _write_summary(f"# ❌ Katalog-Lauf abgebrochen\n\n{err}\n")
        return 1

    out_dir = Path(args.out)
    xlsx = review.write_excel(result, scope, out_dir / f"katalog_review_{result.data_date.isoformat()}.xlsx")
    summary = review.summary_markdown(result, scope)
    print(summary, flush=True)
    _write_summary(summary)
    print(f"📄 Review-Datei: {xlsx}", flush=True)
    return 0


def _write_summary(markdown: str) -> None:
    """In GitHub Actions erscheint der Text oben auf der Ergebnisseite des Laufs."""
    target = os.environ.get("GITHUB_STEP_SUMMARY")
    if target:
        with open(target, "a", encoding="utf-8") as fh:
            fh.write(markdown)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="cmtracker")
    sub = parser.add_subparsers(dest="command", required=True)
    p_cat = sub.add_parser("catalog", help="Katalog und Price Guide übernehmen")
    p_cat.add_argument("--scope", default=str(DEFAULT_SCOPE_PATH), help="Pfad zur scope.yaml")
    p_cat.add_argument("--out", default="out", help="Ordner für die Review-Datei")
    p_cat.set_defaults(func=cmd_catalog)
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
