"""Kommandozeile.

  python -m cmtracker catalog [--game pokemon]          Katalog & Price Guide (alle Spiele)
  python -m cmtracker scrape  [--game pokemon] [--limit 20] [--max-minutes 330] [--final-attempt]
  python -m cmtracker discover                          Erkundung: Beispielseiten (Pokémon)

Bei Problemen wird eine Mail gesendet (alerts.py); sonst bleibt es still.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

from . import alerts, catalog, review
from .settings import GAMES_DIR, ConfigError, load_games, load_monitoring
from .sources import SourceError
from .storage import storage_from_env

OUT_DIR = "out"  # Ordner für Review-Dateien und die Marker-Datei "Mail bereits gesendet"


def cmd_catalog(args: argparse.Namespace) -> int:
    from botocore.exceptions import BotoCoreError, ClientError

    try:
        storage = storage_from_env()
    except ConfigError as err:
        return _fail(str(err))
    thresholds = load_monitoring()
    exit_code = 0
    for scope in load_games(args.games_dir, args.game):
        try:
            result = catalog.run(scope, storage, thresholds=thresholds)
        except (SourceError, catalog.ValidationError) as err:
            exit_code = _fail(f"{scope.game_name}: {err}")
            continue
        except (ClientError, BotoCoreError) as err:
            return _fail(
                "Zugriff auf Cloudflare R2 fehlgeschlagen. Häufigste Ursachen: falscher Access Key / Secret, "
                "Token ohne Berechtigung 'Object Read & Write' für diesen Bucket, oder falscher Bucket-Name.\n"
                f"Technische Meldung: {err}"
            )
        if result.issues:
            alerts.send_email(f"Katalog {scope.game_name}: Auffälligkeiten",
                              "\n".join(f"- {i}" for i in result.issues), marker_dir=OUT_DIR)
        xlsx = review.write_excel(
            result, scope, Path(args.out) / f"katalog_review_{scope.game_key}_{result.data_date.isoformat()}.xlsx",
            game_name_url=scope.cardmarket_path)
        summary = review.summary_markdown(result, scope)
        print(summary, flush=True)
        _write_summary(summary)
        print(f"📄 Review-Datei: {xlsx}", flush=True)
    return exit_code


def cmd_scrape(args: argparse.Namespace) -> int:
    from . import quality, scrape
    from .fetcher import CardmarketSession, FetchError, LoginError

    deadline = time.monotonic() + args.max_minutes * 60
    try:
        storage = storage_from_env()
    except ConfigError as err:
        return _fail(str(err), title="Scrape abgebrochen")
    if not storage.is_persistent:
        return _fail("Der Scrape braucht R2 (Katalog und Ergebnisse liegen dort).", title="Scrape abgebrochen")
    scopes = load_games(args.games_dir, args.game)
    thresholds = load_monitoring()
    try:
        session = CardmarketSession(os.environ.get("CM_USERNAME", ""), os.environ.get("CM_PASSWORD", ""),
                                    game_path=scopes[0].cardmarket_path)
    except LoginError as err:
        return _fail(str(err), title="Scrape abgebrochen")
    exit_code = 0
    try:
        for scope in scopes:
            if time.monotonic() >= deadline:
                break
            print(f"🛒 Scrape {scope.game_name} …", flush=True)
            try:
                result = scrape.run(scope, storage, session, deadline=deadline, limit=args.limit,
                                    reset=args.reset_today)
            except (LoginError, FetchError, RuntimeError) as err:
                exit_code = _fail(f"{scope.game_name}: {err}", title="Scrape abgebrochen")
                continue
            summary = scrape.summary_markdown(result, scope)
            keys = scrape.Keys(scope.game_key, result.day)

            if result.emergency:
                alerts.send_email(f"Notbremse beim Scrapen ({scope.game_name})",
                                  f"{result.stopped_reason}\n\nBis dahin erledigt: "
                                  f"{result.products_done_before + result.products_done_now} von "
                                  f"{result.products_total} Produkten.", marker_dir=OUT_DIR)
                exit_code = 1

            if result.day_complete and not result.nothing_to_do:
                report = quality.check_day(scope, storage, keys, thresholds)
                quality.write_status(storage, keys, report)
                alerts.ping_healthcheck()
                summary += quality_markdown(report)
                if report.needs_alert:
                    alerts.send_email(f"Plausibilitätsprüfung {scope.game_name} {result.day:%d.%m.%Y}",
                                      report.email_body(), marker_dir=OUT_DIR)
            elif not result.day_complete:
                done = result.products_done_before + result.products_done_now
                report = quality.QualityReport(game=scope.game_key, day=result.day.isoformat(), complete=False,
                                               metrics={"Produkte erledigt": f"{done} von {result.products_total}"})
                quality.write_status(storage, keys, report)
                if args.final_attempt and not result.emergency:
                    alerts.send_email(f"Tag nicht vollständig gescrapt ({scope.game_name} {result.day:%d.%m.%Y})",
                                      f"Auch nach dem letzten Lauf des Tages sind erst {done} von "
                                      f"{result.products_total} Produkten erledigt.\n{result.stopped_reason or ''}",
                                      marker_dir=OUT_DIR)

            if not result.nothing_to_do:
                from . import scrape_review
                xlsx = scrape_review.write_scrape_excel(
                    result, scope, storage, Path(args.out) / f"scrape_review_{scope.game_key}_{result.run_id}.xlsx")
                if xlsx:
                    summary += "\nAlle Varianten, gespeicherten Angebote und Bestandszahlen dieses Laufs stehen in " \
                               "der Excel-Datei unter **Artifacts** auf dieser Seite (7 Tage verfügbar).\n"
            print(summary, flush=True)
            _write_summary(summary)
            if result.emergency:
                break
    finally:
        session.close()
    return exit_code


def quality_markdown(report) -> str:
    lines = ["", "## Plausibilitätsprüfung", ""]
    if not report.needs_alert:
        lines.append("✅ Keine Auffälligkeiten.")
    for issue in report.issues:
        lines.append(f"- 🚨 {issue}")
    if report.not_found:
        lines.append(f"- 🚨 Produktseite nicht gefunden: {len(report.not_found)}")
    if report.url_changes:
        lines.append(f"- ℹ️ Produkt-URL geändert: {len(report.url_changes)}")
    lines += ["", "| Kennzahl | Wert |", "|---|---:|"] + [f"| {k} | {v} |" for k, v in report.metrics.items()]
    return "\n".join(lines) + "\n"


def cmd_discover(args: argparse.Namespace) -> int:
    from . import discovery
    from .fetcher import FetchError, LoginError

    scope = load_games(args.games_dir, "pokemon")[0]
    try:
        storage = storage_from_env()
    except ConfigError as err:
        return _fail(str(err), title="Erkundung abgebrochen", alert=False)
    if not storage.is_persistent:
        return _fail("Die Erkundung braucht R2, damit die Beispielseiten privat abgelegt werden können.",
                     title="Erkundung abgebrochen", alert=False)
    try:
        key, summary = discovery.run(scope, storage)
    except (LoginError, FetchError, SourceError) as err:
        return _fail(str(err), title="Erkundung abgebrochen", alert=False)
    summary += (
        f"\n**Beispielseiten (persönliche Daten entfernt):** `{key}` im R2-Bucket.  \n"
        "Herunterladen: Cloudflare-Dashboard → R2 → Bucket öffnen → Ordner `debug/discovery` → Datei → Download.\n"
    )
    print(summary, flush=True)
    _write_summary(summary)
    return 0


def _fail(message: str, title: str = "Katalog-Lauf abgebrochen", alert: bool = True) -> int:
    print(f"❌ {message}", file=sys.stderr, flush=True)
    _write_summary(f"# ❌ {title}\n\n" + message.replace("\n", "  \n") + "\n")
    if alert:
        alerts.send_email(title, message, marker_dir=OUT_DIR)
    return 1


def _write_summary(markdown: str) -> None:
    """In GitHub Actions erscheint der Text oben auf der Ergebnisseite des Laufs."""
    target = os.environ.get("GITHUB_STEP_SUMMARY")
    if target:
        with open(target, "a", encoding="utf-8") as fh:
            fh.write(markdown + "\n")


def main(argv: list[str] | None = None) -> int:
    global OUT_DIR
    parser = argparse.ArgumentParser(prog="cmtracker")
    parser.add_argument("--games-dir", default=str(GAMES_DIR), help="Ordner mit den Spiel-Dateien")
    sub = parser.add_subparsers(dest="command", required=True)

    p_cat = sub.add_parser("catalog", help="Katalog und Price Guide übernehmen")
    p_cat.add_argument("--game", help="nur dieses Spiel (Schlüssel, z. B. pokemon)")
    p_cat.add_argument("--out", default="out", help="Ordner für die Review-Dateien")
    p_cat.set_defaults(func=cmd_catalog)

    p_scr = sub.add_parser("scrape", help="Angebote und Preise aller aktiven Produkte scrapen")
    p_scr.add_argument("--game", help="nur dieses Spiel (Schlüssel, z. B. pokemon)")
    p_scr.add_argument("--limit", type=int, default=None, help="höchstens so viele Produkte (Testlauf)")
    p_scr.add_argument("--max-minutes", type=float, default=330, help="Zeitbudget, danach sauber aufhören")
    p_scr.add_argument("--out", default="out", help="Ordner für die Review-Datei")
    p_scr.add_argument("--reset-today", action="store_true",
                       help="heutige Scrape-Daten löschen und den Tag komplett neu scrapen")
    p_scr.add_argument("--final-attempt", action="store_true",
                       help="letzter geplanter Lauf des Tages: Mail, falls der Tag danach nicht vollständig ist")
    p_scr.set_defaults(func=cmd_scrape)

    p_disc = sub.add_parser("discover", help="Erkundung: Beispielseiten von Cardmarket laden")
    p_disc.set_defaults(func=cmd_discover)

    args = parser.parse_args(argv)
    OUT_DIR = getattr(args, "out", "out")
    try:
        return args.func(args)
    except ValueError as err:  # z. B. unbekanntes Spiel oder fehlerhafte Spiel-Datei
        return _fail(str(err), title="Konfiguration fehlerhaft")


if __name__ == "__main__":
    sys.exit(main())
