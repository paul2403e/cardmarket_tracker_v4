"""Tests für Plausibilitätsprüfung, Mail-Warnungen und Katalog-Auffälligkeiten."""

from __future__ import annotations

import json
import time
from datetime import date, datetime, timezone

import pandas as pd
import pytest

from cmtracker import alerts, catalog, quality, scrape
from cmtracker.settings import load_monitoring
from cmtracker.storage import LocalStorage, df_to_parquet

from test_catalog import SCOPE as CAT_SCOPE, fake_fetch, price, product
from test_scrape import NOW, SCOPE, FakeSession, catalog_state

THRESHOLDS = load_monitoring()


@pytest.fixture
def storage(tmp_path, monkeypatch):
    monkeypatch.setattr(scrape, "_pause", lambda: None)
    monkeypatch.setattr(scrape, "_sleep", lambda seconds: None)
    st = LocalStorage(tmp_path / "data")
    catalog_state(st)
    return st


def test_monitoring_config_loads():
    assert THRESHOLDS["scrape"]["shipping_missing_max"] == 0.05
    assert THRESHOLDS["catalog"]["price_guide_stale_days"] == 2


def test_clean_day_has_no_issues(storage):
    res = scrape.run(SCOPE, storage, FakeSession(), deadline=time.time() + 600, now=NOW)
    assert res.day_complete
    report = quality.check_day(SCOPE, storage, scrape.Keys("pokemon", res.day), THRESHOLDS)
    assert report.issues == [] and not report.needs_alert
    assert report.metrics["Varianten"] == 6 and report.metrics["davon ok"] == 5
    quality.write_status(storage, scrape.Keys("pokemon", res.day), report)
    status = json.loads(storage.get("status/pokemon/latest.json"))
    assert status["complete"] and status["day"] == "2026-11-06"


def _write_bad_day(storage, keys):
    snaps = pd.DataFrame([{
        "run_id": "r", "scraped_at": datetime(2026, 11, 6, 6, 0, tzinfo=timezone.utc), "id_product": i,
        "language": "en", "status": "ok" if i < 95 else "not_found", "http_status": 200, "url": "u",
        "url_changed": False, "available_items": 10, "trend": 1.0, "avg30": 1.0, "avg7": 1.0, "avg1": 1.0,
        "offers_total": 10, "items_total": 10, "count_complete": i % 10 != 0, "offers_stored": 10,
        "offers_wrong_language": 3, "requests": 3, "duration_ms": 1, "parser_version": "2", "note": None,
    } for i in range(100)], columns=scrape.SNAPSHOT_SCHEMA.names)
    storage.put(keys.day_file("snapshots"), df_to_parquet(snaps, scrape.SNAPSHOT_SCHEMA))
    offers = pd.DataFrame([{
        "run_id": "r", "id_product": i % 95, "language": "en", "rank_total": 1, "rank_price": 1, "article_id": i,
        "price_cents": 1000, "shipping_cents": None if i % 2 else 500, "quantity": 1,
        "seller_country": None, "seller_type": "private", "seller_rating": "good", "seller_sales": 3,
        "comment": None,
    } for i in range(500)], columns=scrape.OFFER_SCHEMA.names)
    storage.put(keys.day_file("offers"), df_to_parquet(offers, scrape.OFFER_SCHEMA))
    storage.put(keys.progress, json.dumps({"products_done": [], "runs": [
        {"requests": 1000, "fallbacks": 300, "url_changes": ["X (ID 5) → neue URL"], "no_language": []}]}).encode())


def test_bad_day_triggers_all_checks(storage):
    keys = scrape.Keys("pokemon", date(2026, 11, 6))
    _write_bad_day(storage, keys)
    report = quality.check_day(SCOPE, storage, keys, THRESHOLDS)
    text = "\n".join(report.issues)
    for label in ("Anteil Varianten mit Fehler", "Anteil nicht vollständig gezählt",
                  "Anteil Angebote in falscher Sprache", "Anteil Angebote ohne Versandkosten",
                  "Füllquote Land", "Anteil gewerblicher Verkäufer", "Anteil Abrufe über FlareSolverr"):
        assert label in text, label
    assert "Füllquote Bewertung" not in text
    assert len(report.not_found) == 5 and report.url_changes == ["X (ID 5) → neue URL"]
    assert report.needs_alert and "neu nicht gefunden" in report.email_body()


def test_not_found_reported_only_once(storage):
    keys = scrape.Keys("pokemon", date(2026, 11, 6))
    _write_bad_day(storage, keys)
    quality.write_status(storage, keys, quality.check_day(SCOPE, storage, keys, THRESHOLDS))
    next_day = scrape.Keys("pokemon", date(2026, 11, 7))
    _write_bad_day(storage, next_day)
    report = quality.check_day(SCOPE, storage, next_day, THRESHOLDS)
    assert report.not_found == [] and report.still_not_found == 5
    assert "bereits gemeldet" in report.email_body()


def test_email_without_credentials_is_skipped(monkeypatch, tmp_path):
    for k in ("SMTP_USER", "SMTP_PASS", "ALERT_EMAIL_TO"):
        monkeypatch.delenv(k, raising=False)
    assert alerts.send_email("Test", "Inhalt", marker_dir=tmp_path) is False
    assert not (tmp_path / alerts.SENT_MARKER).exists()


def test_email_sent_and_marker_written(monkeypatch, tmp_path):
    sent = []

    class FakeSMTP:
        def __init__(self, host, port, timeout):
            self.host = host
        def __enter__(self):
            return self
        def __exit__(self, *a):
            return False
        def starttls(self, context):
            pass
        def login(self, user, pw):
            assert (user, pw) == ("me@example.org", "app-pass")
        def send_message(self, msg):
            sent.append(msg)

    monkeypatch.setattr(alerts.smtplib, "SMTP", FakeSMTP)
    monkeypatch.setenv("SMTP_USER", "me@example.org")
    monkeypatch.setenv("SMTP_PASS", "app-pass")
    monkeypatch.setenv("ALERT_EMAIL_TO", "alerts@example.org")
    assert alerts.send_email("Notbremse", "Details", marker_dir=tmp_path)
    assert sent[0]["Subject"] == "[CM-Tracker] Notbremse" and sent[0]["To"] == "alerts@example.org"
    assert (tmp_path / alerts.SENT_MARKER).exists()
    # Workflow-Fehlerschritt sendet dann keine zweite Mail
    assert alerts.main(["--subject", "x", "--body", "y", "--skip-if-sent", str(tmp_path)]) == 0
    assert len(sent) == 1


def test_catalog_flags_stale_price_guide_and_active_drop(tmp_path):
    st = LocalStorage(tmp_path / "cat")
    products = [product(i, f"Box {i}") for i in range(1, 21)]
    prices = [price(i, 10) for i in range(1, 21)]
    catalog.run(CAT_SCOPE, st, fetch=fake_fetch(products, prices), thresholds=THRESHOLDS,
                now=datetime(2026, 11, 5, 6, 0, tzinfo=timezone.utc))
    # 3 Tage später, Price Guide unverändert alt, und die Hälfte ohne Angebote
    prices2 = [price(i, 10 if i <= 10 else None) for i in range(1, 21)]
    res = catalog.run(CAT_SCOPE, st, fetch=fake_fetch(products, prices2), thresholds=THRESHOLDS,
                      now=datetime(2026, 11, 8, 6, 0, tzinfo=timezone.utc))
    text = "\n".join(res.issues)
    assert "3 Tage alt" in text and "Aktive Produkte von 20 auf 10" in text


def test_publish_review_uploads_and_keeps_seven_days(tmp_path):
    from cmtracker.__main__ import publish_review

    st = LocalStorage(tmp_path / "r2")
    st.put("review/date=2026-10-30/alt.xlsx", b"x")
    st.put("review/date=2026-10-31/noch-da.xlsx", b"x")
    xlsx = tmp_path / "out" / "scrape_review_pokemon_1.xlsx"
    xlsx.parent.mkdir()
    xlsx.write_bytes(b"excel")
    key = publish_review(st, xlsx, today=date(2026, 11, 7))
    assert key == "review/date=2026-11-07/scrape_review_pokemon_1.xlsx" and st.get(key) == b"excel"
    assert st.list("review/") == ["review/date=2026-10-31/noch-da.xlsx", key]
    assert publish_review(st, None, today=date(2026, 11, 7)) is None


def test_alert_mentions_server_log(monkeypatch):
    monkeypatch.setenv("RUN_INFO", "Protokoll: cm logs")
    assert alerts._run_url() == "Protokoll: cm logs"


def test_daily_report_mail_when_all_ok(storage, monkeypatch, tmp_path):
    from cmtracker import __main__ as cli

    mails = []
    monkeypatch.setattr(alerts, "send_email", lambda subject, body, marker_dir=None: mails.append((subject, body, marker_dir)))
    monkeypatch.setattr(alerts, "ping_healthcheck", lambda *a, **k: None)
    monkeypatch.setattr(cli, "storage_from_env", lambda: storage)
    monkeypatch.setattr(storage.__class__, "is_persistent", property(lambda self: True))
    class ClosableSession(FakeSession):
        def close(self):
            pass

    monkeypatch.setattr("cmtracker.fetcher.CardmarketSession", lambda *a, **k: ClosableSession())
    monkeypatch.setattr(scrape, "datetime", type("D", (), {"now": staticmethod(lambda tz=None: NOW)}))
    rc = cli.main(["scrape", "--game", "pokemon", "--out", str(tmp_path / "out"), "--max-minutes", "10"])
    assert rc == 0
    subjects = [m[0] for m in mails]
    assert any(s.startswith("✅ Tagesbericht") for s in subjects), subjects
    body = next(m[1] for m in mails if m[0].startswith("✅"))
    assert "Keine Auffälligkeiten" in body and "Varianten" in body
    assert next(m[2] for m in mails if m[0].startswith("✅")) is None


def test_same_alert_only_once_per_day(monkeypatch, tmp_path):
    sent = []

    class FakeSMTP:
        def __init__(self, *a, **k):
            pass
        def __enter__(self):
            return self
        def __exit__(self, *a):
            return False
        def starttls(self, context):
            pass
        def login(self, user, pw):
            pass
        def send_message(self, msg):
            sent.append(msg["Subject"])

    monkeypatch.setattr(alerts.smtplib, "SMTP", FakeSMTP)
    monkeypatch.setenv("SMTP_USER", "me@example.org")
    monkeypatch.setenv("SMTP_PASS", "x")
    monkeypatch.setenv("ALERT_DEDUP_DIR", str(tmp_path / "state"))
    assert alerts.send_email("Scrape abgebrochen", "1")
    assert not alerts.send_email("Scrape abgebrochen", "2", marker_dir=tmp_path / "run2")
    assert (tmp_path / "run2" / alerts.SENT_MARKER).exists()  # Fehler-Mail des Laptops bleibt dann auch aus
    assert alerts.send_email("Notbremse beim Scrapen (Pokémon)", "3")
    assert sent == ["[CM-Tracker] Scrape abgebrochen", "[CM-Tracker] Notbremse beim Scrapen (Pokémon)"]


def test_pace_from_config(monkeypatch):
    monkeypatch.setattr(scrape, "PAUSE_RANGE_S", scrape.PAUSE_RANGE_S)
    monkeypatch.setattr(scrape, "COOLDOWN_MIN", scrape.COOLDOWN_MIN)
    monkeypatch.setattr(scrape, "MAX_COOLDOWNS", scrape.MAX_COOLDOWNS)
    assert THRESHOLDS["pace"]["pause_min_s"] == 0.8 and THRESHOLDS["pace"]["pause_max_s"] == 1.6
    scrape.configure_pace({"pause_min_s": 0.5, "pause_max_s": 1.5, "max_cooldowns": 2})
    assert scrape.PAUSE_RANGE_S == (0.5, 1.5) and scrape.MAX_COOLDOWNS == 2 and scrape.COOLDOWN_MIN == 30
    scrape.configure_pace(None)  # fehlender Abschnitt -> Werte bleiben
    assert scrape.PAUSE_RANGE_S == (0.5, 1.5)
