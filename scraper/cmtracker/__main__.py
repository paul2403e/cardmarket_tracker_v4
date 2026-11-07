"""Kommandozeile.

  python -m cmtracker catalog [--game pokemon]          Katalog & Price Guide (alle Spiele)
  python -m cmtracker scrape  [--game pokemon] [--limit 20] [--max-minutes 330] [--final-attempt]
  python -m cmtracker discover                          Erkundung: Beispielseiten (Pokémon)
  python -m cmtracker selftest                          Server-Check: R2, FlareSolverr, Testmail
  python -m cmtracker day-status [--day JJJJ-MM-TT]     Ist der Tag vollständig gescrapt? (JSON, Exit 0 = ja)

Mit --publish-review werden die Review-Excel-Dateien 7 Tage lang in R2 unter review/ abgelegt.

Bei Problemen wird eine Mail gesendet (alerts.py); sonst bleibt es still.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path

from . import alerts, catalog, review
from .settings import GAMES_DIR, ConfigError, load_games, load_monitoring
from .sources import SourceError
from .storage import storage_from_env

OUT_DIR = "out"  # Ordner für Review-Dateien und die Marker-Datei "Mail bereits gesendet"
REVIEW_PREFIX = "review/"
REVIEW_KEEP_DAYS = 7


def publish_review(storage, path: Path | None, today: date | None = None) -> str | None:
    """Review-Excel nach R2 (review/date=JJJJ-MM-TT/…) und Dateien älter als 7 Tage löschen.

    Herunterladen: Cloudflare-Dashboard → R2 → Bucket → Ordner review → Datei → Download."""
    today = today or date.today()
    cutoff = (today - timedelta(days=REVIEW_KEEP_DAYS)).isoformat()
    for key in storage.list(REVIEW_PREFIX):
        part = key[len(REVIEW_PREFIX):].split("/", 1)[0]
        if part.startswith("date=") and part[5:] < cutoff:
            storage.delete(key)
    if path is None or not Path(path).exists():
        return None
    key = f"{REVIEW_PREFIX}date={today.isoformat()}/{Path(path).name}"
    storage.put(key, Path(path).read_bytes(),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    return key


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
        if args.publish_review:
            key = publish_review(storage, xlsx)
            if key:
                summary += f"\n📄 Review-Datei in R2: `{key}`\n"
        print(summary, flush=True)
        _write_summary(summary)
        print(f"📄 Review-Datei: {xlsx}", flush=True)
    return exit_code


def scrape_deadline(max_minutes: float, stop_at: str | None = None, now: datetime | None = None) -> float:
    """Ende des Zeitbudgets als Wanduhr-Zeitpunkt (time.time()).

    --stop-at 23:55 begrenzt zusätzlich auf eine Uhrzeit (Ortszeit), damit ein Lauf nicht über
    Mitternacht in den nächsten Tag hineinläuft – z. B. nach dem Aufwachen aus dem Energiesparmodus."""
    now = now or datetime.now()
    deadline = now.timestamp() + max_minutes * 60
    if stop_at:
        hh, mm = (int(x) for x in stop_at.split(":"))
        limit = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
        if limit > now:
            deadline = min(deadline, limit.timestamp())
        else:
            deadline = now.timestamp()
    return deadline


def cmd_day_status(args: argparse.Namespace) -> int:
    """Prüft anhand von status/<spiel>/date=<tag>.json, ob ein Tag für alle Spiele fertig ist."""
    from .sources import berlin_date

    try:
        storage = storage_from_env()
    except ConfigError as err:
        print(json.dumps({"error": str(err)}, ensure_ascii=False))
        return 2
    day = args.day or berlin_date(datetime.now().astimezone()).isoformat()
    out = {}
    for scope in load_games(args.games_dir, args.game):
        raw = storage.get(f"status/{scope.game_key}/date={day}.json")
        st = json.loads(raw) if raw else {}
        out[scope.game_key] = {
            "day": day,
            "exists": bool(raw),
            "complete": bool(st.get("complete")),
            "progress": (st.get("metrics") or {}).get("Produkte erledigt"),
        }
    print(json.dumps(out, ensure_ascii=False))
    return 0 if out and all(v["complete"] for v in out.values()) else 3


def cmd_scrape(args: argparse.Namespace) -> int:
    from . import quality, scrape
    from .fetcher import CardmarketSession, FetchError, LoginError

    deadline = scrape_deadline(args.max_minutes, args.stop_at)
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
            if time.time() >= deadline:
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
                    alerts.send_email(f"⚠️ Plausibilitätsprüfung {scope.game_name} {result.day:%d.%m.%Y}",
                                      report.email_body(), marker_dir=OUT_DIR)
                elif thresholds.get("daily_report", True):
                    # Tagesbericht auch ohne Auffälligkeiten (ohne Marker, damit Fehler-Mails trotzdem rausgehen)
                    alerts.send_email(f"✅ Tagesbericht {scope.game_name} {result.day:%d.%m.%Y} – alles ok",
                                      report.email_body())
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
                if xlsx and args.publish_review:
                    key = publish_review(storage, xlsx)
                    summary += f"\nAlle Varianten und gespeicherten Angebote dieses Laufs: `{key}` in R2 " \
                               "(Cloudflare-Dashboard → R2 → Bucket → review, 7 Tage verfügbar).\n"
                elif xlsx:
                    summary += f"\nReview-Datei: {xlsx}\n"
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


def cmd_selftest(args: argparse.Namespace) -> int:
    """Prüft nach der Einrichtung, ob alles erreichbar ist – ohne Cardmarket-Login (das zeigt der Testlauf)."""
    import requests

    from .fetcher import FLARESOLVERR_URL

    ok = True
    try:
        storage = storage_from_env()
        if not storage.is_persistent or not hasattr(storage, "_client"):
            raise ConfigError("R2-Zugangsdaten fehlen.")
        storage.list("status/")
        print(f"✅ R2: {storage.describe()} erreichbar", flush=True)
    except Exception as err:  # noqa: BLE001 – Selbsttest soll alles melden, nicht abbrechen
        ok = False
        print(f"❌ R2: {err}", flush=True)
    try:
        base = FLARESOLVERR_URL.rsplit("/v1", 1)[0]
        requests.get(base, timeout=10).raise_for_status()
        print("✅ FlareSolverr läuft", flush=True)
    except Exception as err:  # noqa: BLE001
        ok = False
        print(f"❌ FlareSolverr: {err}", flush=True)
    for name in ("CM_USERNAME", "CM_PASSWORD"):
        if not os.environ.get(name, "").strip():
            ok = False
            print(f"❌ {name} fehlt", flush=True)
    if alerts.send_email("Testmail vom Server", "Die Einrichtung des Servers hat geklappt – Mails kommen an."):
        print("✅ Testmail gesendet – bitte Posteingang prüfen", flush=True)
    else:
        ok = False
        print("❌ Testmail konnte nicht gesendet werden (SMTP_USER / SMTP_PASS prüfen)", flush=True)
    if os.environ.get("HC_PING_URL", "").strip():
        print("✅ healthchecks.io-Adresse gesetzt", flush=True)
    else:
        print("⚠️ HC_PING_URL fehlt – ohne sie meldet niemand, wenn der Server ganz ausfällt", flush=True)
    return 0 if ok else 1


def _fail(message: str, title: str = "Katalog-Lauf abgebrochen", alert: bool = True) -> int:
    print(f"❌ {message}", file=sys.stderr, flush=True)
    _write_summary(f"# ❌ {title}\n\n" + message.replace("\n", "  \n") + "\n")
    if alert:
        alerts.send_email(title, message, marker_dir=OUT_DIR)
    return 1


def _write_summary(markdown: str) -> None:
    """Nur falls doch einmal in GitHub Actions ausgeführt: Text oben auf der Ergebnisseite des Laufs."""
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
    p_cat.add_argument("--publish-review", action="store_true", help="Review-Datei 7 Tage in R2 ablegen")
    p_cat.set_defaults(func=cmd_catalog)

    p_scr = sub.add_parser("scrape", help="Angebote und Preise aller aktiven Produkte scrapen")
    p_scr.add_argument("--game", help="nur dieses Spiel (Schlüssel, z. B. pokemon)")
    p_scr.add_argument("--limit", type=int, default=None, help="höchstens so viele Produkte (Testlauf)")
    p_scr.add_argument("--max-minutes", type=float, default=330, help="Zeitbudget, danach sauber aufhören")
    p_scr.add_argument("--stop-at", help="spätestens um diese Uhrzeit (HH:MM, Ortszeit) sauber aufhören")
    p_scr.add_argument("--out", default="out", help="Ordner für die Review-Datei")
    p_scr.add_argument("--publish-review", action="store_true", help="Review-Datei 7 Tage in R2 ablegen")
    p_scr.add_argument("--reset-today", action="store_true",
                       help="heutige Scrape-Daten löschen und den Tag komplett neu scrapen")
    p_scr.add_argument("--final-attempt", action="store_true",
                       help="letzter geplanter Lauf des Tages: Mail, falls der Tag danach nicht vollständig ist")
    p_scr.set_defaults(func=cmd_scrape)

    p_disc = sub.add_parser("discover", help="Erkundung: Beispielseiten von Cardmarket laden")
    p_disc.set_defaults(func=cmd_discover)

    p_day = sub.add_parser("day-status", help="Ist der Tag vollständig gescrapt? (Exit 0 = ja, 3 = nein)")
    p_day.add_argument("--day", help="Tag JJJJ-MM-TT (Standard: heute, Berlin)")
    p_day.add_argument("--game", help="nur dieses Spiel")
    p_day.set_defaults(func=cmd_day_status)

    p_self = sub.add_parser("selftest", help="Server-Check: R2, FlareSolverr, Zugangsdaten, Testmail")
    p_self.set_defaults(func=cmd_selftest)

    args = parser.parse_args(argv)
    OUT_DIR = getattr(args, "out", "out")
    try:
        return args.func(args)
    except ValueError as err:  # z. B. unbekanntes Spiel oder fehlerhafte Spiel-Datei
        return _fail(str(err), title="Konfiguration fehlerhaft")


if __name__ == "__main__":
    sys.exit(main())
