"""E-Mail-Warnungen und Totmannschalter – nur Python-Standardbibliothek.

Absichtlich ohne weitere Pakete, damit der Server auch dann noch eine Mail schicken kann,
wenn die Installation der Abhängigkeiten scheitert:

    python scraper/cmtracker/alerts.py --subject "…" --body "…"

Umgebungsvariablen: SMTP_USER, SMTP_PASS, ALERT_EMAIL_TO (optional SMTP_HOST, SMTP_PORT),
HC_PING_URL für healthchecks.io.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import smtplib
import ssl
import sys
import urllib.request
from email.message import EmailMessage
from pathlib import Path

SENT_MARKER = ".alert_sent"  # verhindert eine zweite Mail aus der Fehlerbehandlung des Servers


def send_email(subject: str, body: str, marker_dir: str | Path | None = None) -> bool:
    user = os.environ.get("SMTP_USER", "").strip()
    password = os.environ.get("SMTP_PASS", "").strip()
    to = os.environ.get("ALERT_EMAIL_TO", "").strip() or user
    if not user or not password:
        print(f"⚠️ Keine Mail-Zugangsdaten gesetzt – Warnung nur im Protokoll: {subject}", flush=True)
        return False
    dedup = _already_sent_today(subject)
    if dedup is True:
        print(f"📧 Heute schon gemeldet, keine zweite Mail: {subject}", flush=True)
        if marker_dir is not None:
            Path(marker_dir).mkdir(parents=True, exist_ok=True)
            (Path(marker_dir) / SENT_MARKER).write_text(subject, encoding="utf-8")
        return False
    run_url = _run_url()
    msg = EmailMessage()
    msg["Subject"] = f"[CM-Tracker] {subject}"
    msg["From"] = user
    msg["To"] = to
    msg.set_content(body + (f"\n\n{run_url}" if run_url else ""))
    host = os.environ.get("SMTP_HOST", "smtp.gmail.com")
    port = int(os.environ.get("SMTP_PORT", "587"))
    try:
        with smtplib.SMTP(host, port, timeout=30) as smtp:
            smtp.starttls(context=ssl.create_default_context())
            smtp.login(user, password)
            smtp.send_message(msg)
    except (smtplib.SMTPException, OSError) as err:
        print(f"⚠️ Mail konnte nicht gesendet werden ({err}): {subject}", flush=True)
        return False
    print(f"📧 Warnung gesendet: {subject}", flush=True)
    if isinstance(dedup, Path):
        dedup.write_text(subject, encoding="utf-8")
    if marker_dir is not None:
        Path(marker_dir).mkdir(parents=True, exist_ok=True)
        (Path(marker_dir) / SENT_MARKER).write_text(subject, encoding="utf-8")
    return True


def _already_sent_today(subject: str) -> bool | Path | None:
    """Mit ALERT_DEDUP_DIR (Laptop): dieselbe Mail höchstens einmal pro Tag – z. B. wenn nach einer
    Störung bei jedem Entsperren ein neuer Versuch startet. True = heute schon gesendet,
    Path = Marker-Datei, die nach dem Senden geschrieben wird, None = keine Begrenzung."""
    folder = os.environ.get("ALERT_DEDUP_DIR", "").strip()
    if not folder:
        return None
    from datetime import date

    key = hashlib.sha256(subject.encode("utf-8")).hexdigest()[:12]
    path = Path(folder) / f"{date.today().isoformat()}-{key}.sent"
    if path.exists():
        return True
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def ping_healthcheck(suffix: str = "") -> None:
    """Signal an healthchecks.io: 'Tag vollständig'. Bleibt es aus, meldet sich healthchecks.io per Mail."""
    url = os.environ.get("HC_PING_URL", "").strip()
    if not url:
        return
    try:
        urllib.request.urlopen(url.rstrip("/") + suffix, timeout=15).read()
    except OSError as err:
        print(f"⚠️ healthchecks.io nicht erreichbar: {err}", flush=True)


def _run_url() -> str:
    """Hinweis, wo das Protokoll des Laufs steht (auf dem Server setzt run_daily.sh RUN_INFO)."""
    return os.environ.get("RUN_INFO", "").strip()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Warn-Mail senden (Fehlerbehandlung des Servers)")
    parser.add_argument("--subject", required=True)
    parser.add_argument("--body", required=True)
    parser.add_argument("--skip-if-sent", help="Ordner mit Marker-Datei: Mail nur senden, wenn noch keine raus ist")
    args = parser.parse_args(argv)
    if args.skip_if_sent and (Path(args.skip_if_sent) / SENT_MARKER).exists():
        print("Warnung wurde bereits vom Lauf selbst gesendet.", flush=True)
        return 0
    send_email(args.subject, args.body)
    return 0


if __name__ == "__main__":
    sys.exit(main())
