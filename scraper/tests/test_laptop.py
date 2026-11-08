"""Tests für den Laptop-Betrieb: Zeitbudget per Uhrzeit, Tagesstatus, Funklöcher, Steuerskript (windows/cmwin.py)."""

from __future__ import annotations

import importlib.util
import json
import sys
import xml.etree.ElementTree as ET
from datetime import date, datetime
from pathlib import Path

import pytest

from cmtracker import __main__ as cli
from cmtracker import fetcher
from cmtracker.fetcher import FetchError

ROOT = Path(__file__).resolve().parents[2]


def load_cmwin(tmp_path, monkeypatch):
    monkeypatch.setenv("CMTRACKER_HOME", str(tmp_path / "cmhome"))
    spec = importlib.util.spec_from_file_location("cmwin", ROOT / "windows" / "cmwin.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_deadline_respects_stop_at():
    now = datetime(2026, 11, 7, 22, 0)
    assert cli.scrape_deadline(1200, "23:55", now=now) == datetime(2026, 11, 7, 23, 55).timestamp()
    assert cli.scrape_deadline(60, "23:55", now=now) == datetime(2026, 11, 7, 23, 0).timestamp()
    assert cli.scrape_deadline(60, None, now=now) == datetime(2026, 11, 7, 23, 0).timestamp()
    # schon nach der Stopp-Uhrzeit -> sofort aufhören
    assert cli.scrape_deadline(60, "21:00", now=now) == now.timestamp()


def test_day_status(tmp_path, monkeypatch, capsys):
    for k in ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("LOCAL_DATA_DIR", str(tmp_path / "data"))
    status = tmp_path / "data" / "status" / "pokemon"
    status.mkdir(parents=True)
    (status / "date=2026-11-06.json").write_text(json.dumps({"complete": True}))
    (status / "date=2026-11-07.json").write_text(
        json.dumps({"complete": False, "metrics": {"Produkte erledigt": "100 von 1000"}}))

    assert cli.main(["day-status", "--day", "2026-11-06"]) == 0
    assert json.loads(capsys.readouterr().out)["pokemon"]["complete"] is True
    assert cli.main(["day-status", "--day", "2026-11-07"]) == 3
    info = json.loads(capsys.readouterr().out)["pokemon"]
    assert info["progress"] == "100 von 1000" and not info["complete"]
    assert cli.main(["day-status", "--day", "2026-11-08"]) == 3
    assert json.loads(capsys.readouterr().out)["pokemon"]["exists"] is False


def test_outage_waits_for_network_and_retries(monkeypatch):
    calls = {"n": 0}
    online = iter([False, True])
    monkeypatch.setattr(fetcher, "network_ok", lambda *a, **k: next(online, True))
    monkeypatch.setattr(fetcher, "wait_for_network", lambda *a, **k: True)

    def flaky():
        calls["n"] += 1
        if calls["n"] == 1:
            raise FetchError("Direktabruf fehlgeschlagen: Could not resolve host")
        return "ok"

    assert fetcher.retry_after_outage(flaky) == "ok" and calls["n"] == 2


def test_error_with_internet_is_not_retried(monkeypatch):
    monkeypatch.setattr(fetcher, "network_ok", lambda *a, **k: True)

    def blocked():
        raise FetchError("Cloudflare has blocked this request")

    with pytest.raises(FetchError):
        fetcher.retry_after_outage(blocked)


def test_cmwin_task_xml_is_valid(tmp_path, monkeypatch):
    cmwin = load_cmwin(tmp_path, monkeypatch)
    xml = cmwin.task_xml(r"LAPTOP\Paul", Path(r"C:\x\venv\Scripts\pythonw.exe"), Path(r"C:\x\runner\cmwin.py"),
                         Path(r"C:\x"))
    root = ET.fromstring(xml.split("\n", 1)[1])  # ohne XML-Kopf (UTF-16-Angabe)
    ns = {"t": "http://schemas.microsoft.com/windows/2004/02/mit/task"}
    assert root.find("t:Triggers/t:CalendarTrigger/t:StartBoundary", ns).text.endswith("T03:30:00")
    assert root.find("t:Settings/t:WakeToRun", ns).text == "true"
    assert root.find("t:Settings/t:DisallowStartIfOnBatteries", ns).text == "false"
    assert "Power-Troubleshooter" in root.find("t:Triggers/t:EventTrigger/t:Subscription", ns).text
    assert root.find("t:Actions/t:Exec/t:Arguments", ns).text.endswith(" run")


def test_cmwin_due_and_cli(tmp_path, monkeypatch, capsys):
    cmwin = load_cmwin(tmp_path, monkeypatch)
    assert not cmwin.due(datetime(2026, 11, 7, 3, 29)) and cmwin.due(datetime(2026, 11, 7, 3, 30))
    # vor 03:30 Uhr passiert beim Aufwachen/Entsperren nichts
    monkeypatch.setattr(cmwin, "datetime", type("D", (), {"now": staticmethod(lambda: datetime(2026, 11, 7, 2, 0))}))
    assert cmwin.main(["run"]) == 0 and not (cmwin.LOGS).exists()
    assert cmwin.main(["help"]) == 0 and "cm test" in capsys.readouterr().out


def test_cmwin_missed_days_mail(tmp_path, monkeypatch):
    cmwin = load_cmwin(tmp_path, monkeypatch)
    cmwin.STATE.mkdir(parents=True)
    (cmwin.STATE / "checked_until.txt").write_text("2026-11-04")
    answers = {"2026-11-05": True, "2026-11-06": False}
    monkeypatch.setattr(cmwin, "day_status", lambda code, env, day=None: {
        "pokemon": {"complete": answers[day], "progress": None, "exists": answers[day]}})
    mails = []
    monkeypatch.setattr(cmwin, "send_mail", lambda code, env, subject, body, marker_dir=None: mails.append(body))
    cmwin.report_missed_days(tmp_path, {}, date(2026, 11, 7))
    assert len(mails) == 1 and "06.11.2026" in mails[0] and "05.11.2026" not in mails[0]
    assert (cmwin.STATE / "checked_until.txt").read_text() == "2026-11-06"
    cmwin.report_missed_days(tmp_path, {}, date(2026, 11, 7))
    assert len(mails) == 1  # nicht doppelt melden


def test_cmwin_blocked_day_skips_automatic_runs(tmp_path, monkeypatch):
    cmwin = load_cmwin(tmp_path, monkeypatch)
    cmwin.STATE.mkdir(parents=True)
    now = datetime(2026, 11, 7, 12, 0)
    (cmwin.STATE / "2026-11-07.blocked.ok").touch()
    (cmwin.STATE / "2026-11-07.pg.ok").touch()
    monkeypatch.setattr(cmwin, "datetime", type("D", (), {"now": staticmethod(lambda: now)}))
    monkeypatch.setattr(cmwin, "RunLock", lambda: (_ for _ in ()).throw(AssertionError("darf nicht starten")))
    assert cmwin.main(["run"]) == 0


def _fake_run_env(cmwin, monkeypatch, tmp_path, *, now, catalog_days, complete_after_scrape=True):
    """Alles außer der Ablauflogik von cmd_run durch Attrappen ersetzen; liefert die Liste der Aufrufe."""
    calls = []
    state = {"complete": False}
    monkeypatch.setattr(cmwin, "datetime", type("D", (), {"now": staticmethod(lambda: now)}))
    monkeypatch.setattr(cmwin, "wait_for_internet", lambda *a: True)
    monkeypatch.setattr(cmwin, "update_code", lambda force=False: tmp_path)
    monkeypatch.setattr(cmwin, "load_secrets", lambda: {"CM_USERNAME": "x"})
    monkeypatch.setattr(cmwin, "report_missed_days", lambda *a: None)
    monkeypatch.setattr(cmwin, "start_flaresolverr", lambda: None)
    monkeypatch.setattr(cmwin, "stop_flaresolverr", lambda p: None)
    monkeypatch.setattr(cmwin, "collect_review", lambda out: None)
    monkeypatch.setattr(cmwin, "send_mail", lambda *a, **k: calls.append("mail"))
    monkeypatch.setattr(cmwin, "day_status", lambda code, env, day=None: {"pokemon": {"complete": state["complete"]}})
    days = iter(catalog_days)

    def fake_cmtracker(code, env, *args, echo=False):
        calls.append(args[0])
        if args[0] == "catalog":
            return 0, f"Price Guide … → Datentag {next(days)}"
        state["complete"] = complete_after_scrape
        return 0, ""

    monkeypatch.setattr(cmwin, "cmtracker", fake_cmtracker)
    return calls


def test_cmwin_price_guide_fetched_again_after_scrape(tmp_path, monkeypatch):
    cmwin = load_cmwin(tmp_path, monkeypatch)
    calls = _fake_run_env(cmwin, monkeypatch, tmp_path, now=datetime(2026, 11, 8, 3, 30),
                          catalog_days=["2026-11-07", "2026-11-08"])
    assert cmwin.main(["run"]) == 0
    assert calls == ["catalog", "scrape", "catalog"]
    assert (cmwin.STATE / "2026-11-08.pg.ok").exists() and (cmwin.STATE / "2026-11-08.done").exists()


def test_cmwin_blocked_day_still_saves_price_guide(tmp_path, monkeypatch):
    cmwin = load_cmwin(tmp_path, monkeypatch)
    cmwin.STATE.mkdir(parents=True)
    (cmwin.STATE / "2026-11-08.blocked.ok").touch()
    calls = _fake_run_env(cmwin, monkeypatch, tmp_path, now=datetime(2026, 11, 8, 9, 0),
                          catalog_days=["2026-11-08"])
    assert cmwin.main(["run"]) == 0
    assert calls == ["catalog"]  # kein Scrape nach der Notbremse, aber der Price Guide wird gespeichert
    assert (cmwin.STATE / "2026-11-08.pg.ok").exists() and not (cmwin.STATE / "2026-11-08.done").exists()
