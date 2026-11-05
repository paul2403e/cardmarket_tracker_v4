"""Kommandozeile: `python -m cmtracker catalog`."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from . import catalog, review
from .settings import DEFAULT_SCOPE_PATH, ConfigError, load_scope
from .sources import SourceError
from .storage import storage_from_env


def cmd_catalog(args: argparse.Namespace) -> int:
    from botocore.exceptions import BotoCoreError, ClientError

    scope = load_scope(args.scope)
    try:
        storage = storage_from_env()
        result = catalog.run(scope, storage)
    except (ConfigError, SourceError, catalog.ValidationError) as err:
        return _fail(str(err))
    except (ClientError, BotoCoreError) as err:
        return _fail(
            "Zugriff auf Cloudflare R2 fehlgeschlagen. Häufigste Ursachen: falscher Access Key / Secret, "
            "Token ohne Berechtigung 'Object Read & Write' für diesen Bucket, oder falscher Bucket-Name.\n"
            f"Technische Meldung: {err}"
        )

    out_dir = Path(args.out)
    xlsx = review.write_excel(result, scope, out_dir / f"katalog_review_{result.data_date.isoformat()}.xlsx")
    summary = review.summary_markdown(result, scope)
    print(summary, flush=True)
    _write_summary(summary)
    print(f"📄 Review-Datei: {xlsx}", flush=True)
    return 0


def cmd_discover(args: argparse.Namespace) -> int:
    from . import discovery
    from .fetcher import FetchError, LoginError

    scope = load_scope(args.scope)
    try:
        storage = storage_from_env()
    except ConfigError as err:
        return _fail(str(err), title="Erkundung abgebrochen")
    if not storage.is_persistent:
        return _fail("Die Erkundung braucht R2, damit die Beispielseiten privat abgelegt werden können.",
                     title="Erkundung abgebrochen")
    try:
        key, summary = discovery.run(scope, storage)
    except (LoginError, FetchError, SourceError) as err:
        return _fail(str(err), title="Erkundung abgebrochen")
    summary += (
        f"\n**Beispielseiten (persönliche Daten entfernt):** `{key}` im R2-Bucket.  \n"
        "Herunterladen: Cloudflare-Dashboard → R2 → Bucket öffnen → Ordner `debug/discovery` → Datei → Download.\n"
    )
    print(summary, flush=True)
    _write_summary(summary)
    return 0


def _fail(message: str, title: str = "Katalog-Lauf abgebrochen") -> int:
    print(f"❌ {message}", file=sys.stderr, flush=True)
    _write_summary(f"# ❌ {title}\n\n" + message.replace("\n", "  \n") + "\n")
    return 1


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
    p_disc = sub.add_parser("discover", help="Erkundung: Beispielseiten von Cardmarket laden")
    p_disc.add_argument("--scope", default=str(DEFAULT_SCOPE_PATH), help="Pfad zur scope.yaml")
    p_disc.set_defaults(func=cmd_discover)
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
