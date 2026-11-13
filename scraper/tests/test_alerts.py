"""Warn-Mails: Tagesbegrenzung (gleiche Mail höchstens einmal pro Tag) und Ausnahme dedup=False."""
from __future__ import annotations

from cmtracker import alerts


class FakeSMTP:
    sent: list = []

    def __init__(self, *args, **kwargs):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def starttls(self, **kwargs):
        pass

    def login(self, user, password):
        pass

    def send_message(self, msg):
        FakeSMTP.sent.append(msg["Subject"])


def _setup(tmp_path, monkeypatch):
    FakeSMTP.sent = []
    monkeypatch.setattr(alerts.smtplib, "SMTP", FakeSMTP)
    monkeypatch.setenv("SMTP_USER", "absender@example.org")
    monkeypatch.setenv("SMTP_PASS", "x")
    monkeypatch.setenv("ALERT_DEDUP_DIR", str(tmp_path))
    monkeypatch.delenv("RUN_INFO", raising=False)


def test_same_mail_only_once_per_day(tmp_path, monkeypatch):
    _setup(tmp_path, monkeypatch)
    assert alerts.send_email("Störung", "…") and not alerts.send_email("Störung", "…")
    assert len(FakeSMTP.sent) == 1


def test_dedup_false_sends_every_time(tmp_path, monkeypatch):
    _setup(tmp_path, monkeypatch)
    for _ in range(3):
        assert alerts.send_email("🧩 Cardmarket will eine Bestätigung", "…", dedup=False)
    assert len(FakeSMTP.sent) == 3
