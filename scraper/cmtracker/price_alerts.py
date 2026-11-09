"""Preisalarme (Meilenstein 8): nach dem Veröffentlichen alle aktiven Alarme prüfen und je Nutzer eine Sammel-Mail schicken.

Alarme stehen in Supabase (Tabelle `alerts`, siehe supabase/migrations/0003_watchlist_alerts.sql). Gelesen und
zurückgeschrieben wird mit dem Supabase-"secret key" (nur auf dem Laptop, verschlüsselt). Ohne SUPABASE_URL /
SUPABASE_SECRET_KEY wird nichts geprüft.

Regeln:
- Werte aus dem Verlauf (`history/<spiel>/…`): fairer Preis (EU/alle, inkl./exkl. Versand) bzw. Bestand am letzten
  Markttag des Spiels.
- Ein Alarm meldet sich einmal, wenn die Bedingung eintritt (armed -> false). Erst wenn sie einmal nicht erfüllt war,
  ist er wieder scharf. Jeder Markttag wird je Alarm nur einmal geprüft (last_checked_day).
"""

from __future__ import annotations

import json
import os
import smtplib
import ssl
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timezone
from email.message import EmailMessage

import pandas as pd

from . import publish
from .settings import Scope
from .storage import Storage

SITE_URL = os.environ.get("SITE_URL", "https://cardmarket-tracker-v4.vercel.app").rstrip("/")
LANG_SHORT = {"en": "EN", "de": "DE", "ja": "JP"}


# --- Supabase (REST mit secret key) -----------------------------------------------------------
class Supabase:
    def __init__(self, url: str, key: str):
        self.url = url.rstrip("/")
        self.key = key

    @classmethod
    def from_env(cls) -> "Supabase | None":
        url = os.environ.get("SUPABASE_URL", "").strip()
        key = os.environ.get("SUPABASE_SECRET_KEY", "").strip()
        return cls(url, key) if url and key else None

    def _headers(self) -> dict:
        h = {"apikey": self.key, "Content-Type": "application/json"}
        if self.key.startswith("eyJ"):  # alter service_role-Schlüssel (JWT) zusätzlich als Bearer
            h["Authorization"] = f"Bearer {self.key}"
        return h

    def request(self, method: str, path: str, body=None, params: dict | None = None, prefer: str | None = None):
        url = f"{self.url}{path}" + (f"?{urllib.parse.urlencode(params)}" if params else "")
        headers = self._headers() | ({"Prefer": prefer} if prefer else {})
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        with urllib.request.urlopen(req, timeout=30) as res:
            raw = res.read()
        return json.loads(raw) if raw else None

    def active_alerts(self) -> list[dict]:
        return self.request("GET", "/rest/v1/alerts", params={"select": "*", "active": "eq.true"}) or []

    def update_alert(self, alert_id: str, values: dict) -> None:
        self.request("PATCH", "/rest/v1/alerts", body=values, params={"id": f"eq.{alert_id}"}, prefer="return=minimal")

    def add_events(self, rows: list[dict]) -> None:
        if rows:
            self.request("POST", "/rest/v1/alert_events", body=rows, prefer="return=minimal")

    def user_email(self, user_id: str) -> str | None:
        user = self.request("GET", f"/auth/v1/admin/users/{user_id}")
        return (user or {}).get("email")


# --- Prüfen ----------------------------------------------------------------------------------
@dataclass
class Check:
    met: bool
    value: float | None  # aktueller Wert (€, Stück oder %)
    message: str


def _fmt_eur(v: float) -> str:
    return f"{v:,.2f} €".replace(",", "X").replace(".", ",").replace("X", ".")


def _fmt_pct(v: float) -> str:
    return f"{'+' if v > 0 else ''}{v:.1f} %".replace(".", ",")


def _series(hist: pd.DataFrame, col: str) -> pd.Series:
    return publish._series(hist, col)


def evaluate(alert: dict, lh: pd.DataFrame, day: date) -> Check | None:
    """Bedingung eines Alarms für eine Variante (Verlauf lh) am Markttag `day`. None = keine Daten."""
    kind = alert["kind"]
    metric = "items" if kind.startswith("items") else alert.get("metric", "price") if kind == "change" else "price"
    col = "items_total" if metric == "items" else f"{alert.get('region', 'eu')}_{alert.get('basis', 'incl')}"
    s = _series(lh, col)
    if s.empty or s.index[-1] != day:
        return None
    now = float(s.iloc[-1]) / (1 if metric == "items" else 100)
    th = float(alert["threshold"])
    basis = "item only" if alert.get("basis") == "excl" else "incl. shipping"
    region = "EU" if alert.get("region", "eu") == "eu" else "all countries"
    label = f"fair price {basis}, {region}" if metric == "price" else "items listed"
    shown = _fmt_eur(now) if metric == "price" else f"{now:.0f}"
    if kind == "price_below":
        return Check(now < th, now, f"Price below {_fmt_eur(th)}: now {shown} ({label})")
    if kind == "price_above":
        return Check(now > th, now, f"Price above {_fmt_eur(th)}: now {shown} ({label})")
    if kind == "items_below":
        return Check(now < th, now, f"Items listed below {th:.0f}: now {shown}")
    if kind == "items_above":
        return Check(now > th, now, f"Items listed above {th:.0f}: now {shown}")
    # Veränderung über N Tage
    days = int(alert.get("days", 7))
    pct = publish.change(s, day, days)
    if pct is None:
        return None
    direction = alert.get("direction", "any")
    met = (pct >= th if direction == "up" else pct <= -th if direction == "down" else abs(pct) >= th)
    what = "Price" if metric == "price" else "Items listed"
    word = {"up": "rose", "down": "fell", "any": "changed"}[direction]
    return Check(met, pct, f"{what} {word} by {_fmt_pct(pct)} in {days} days (alert at {th:g} %): now {shown} ({label})")


@dataclass
class AlertRunResult:
    checked: int = 0
    triggered: int = 0
    mails: int = 0
    skipped: str | None = None


def run(scopes: list[Scope], storage: Storage, sb: Supabase | None = None, send=None) -> AlertRunResult:
    sb = sb or Supabase.from_env()
    if sb is None:
        return AlertRunResult(skipped="Supabase nicht eingerichtet (SUPABASE_URL / SUPABASE_SECRET_KEY)")
    send = send or send_digest
    res = AlertRunResult()
    alerts = sb.active_alerts()
    by_game: dict[str, list[dict]] = defaultdict(list)
    for a in alerts:
        by_game[a["game"]].append(a)
    digests: dict[str, list[dict]] = defaultdict(list)
    events: list[dict] = []
    names = {s.game_key: s.game_name for s in scopes}
    for scope in scopes:
        game_alerts = by_game.get(scope.game_key)
        if not game_alerts:
            continue
        hist = publish.load_history(storage, scope.game_key)
        if hist.empty:
            continue
        day = max(hist["day"])
        groups = {k: g.sort_values("day") for k, g in hist.groupby(["id_product", "language"])}
        for a in game_alerts:
            if a.get("last_checked_day") == day.isoformat():
                continue  # dieser Markttag ist schon geprüft
            lh = groups.get((int(a["product_id"]), a["language"]))
            check = evaluate(a, lh, day) if lh is not None else None
            res.checked += 1
            update: dict = {"last_checked_day": day.isoformat()}
            if check is not None:
                if check.met and a.get("armed", True):
                    update |= {"armed": False, "last_triggered_at": datetime.now(timezone.utc).isoformat(),
                               "last_value": check.value}
                    res.triggered += 1
                    item = {"alert": a, "message": check.message, "game_name": names.get(a["game"], a["game"]), "day": day}
                    digests[a["user_id"]].append(item)
                    events.append({"user_id": a["user_id"], "alert_id": a["id"], "game": a["game"],
                                   "product_id": a["product_id"], "language": a["language"],
                                   "product_name": a.get("product_name"), "message": check.message, "day": day.isoformat()})
                elif not check.met and not a.get("armed", True):
                    update["armed"] = True  # wieder scharf
            sb.update_alert(a["id"], update)
    sb.add_events(events)
    for user_id, items in digests.items():
        email = sb.user_email(user_id)
        if email and send(email, items):
            res.mails += 1
    return res


# --- Mail ------------------------------------------------------------------------------------
def digest_text(items: list[dict]) -> tuple[str, str]:
    n = len(items)
    subject = f"{n} price alert{'s' if n != 1 else ''}: " + ", ".join(
        (i["alert"].get("product_name") or f"#{i['alert']['product_id']}") for i in items[:2]) + (" …" if n > 2 else "")
    lines = ["Your price alerts from today's market data:", ""]
    for i in items:
        a = i["alert"]
        name = a.get("product_name") or f"#{a['product_id']}"
        lines += [f"• {name} ({LANG_SHORT.get(a['language'], a['language'])}, {i['game_name']})",
                  f"  {i['message']}",
                  f"  {SITE_URL}/{a['game']}/product/{a['product_id']}?lang={a['language']}", ""]
    lines += ["Each alert reports once when its condition is met, and again only after the condition was",
              "not met in between.", f"Manage your alerts: {SITE_URL}/watchlist"]
    return subject, "\n".join(lines)


def send_digest(to: str, items: list[dict]) -> bool:
    user = os.environ.get("SMTP_USER", "").strip()
    password = os.environ.get("SMTP_PASS", "").strip()
    if not user or not password:
        print("⚠️ Keine Mail-Zugangsdaten – Preisalarme nicht verschickt", flush=True)
        return False
    subject, body = digest_text(items)
    msg = EmailMessage()
    msg["Subject"] = f"[CM Tracker] {subject}"
    msg["From"] = user
    msg["To"] = to
    msg.set_content(body)
    try:
        with smtplib.SMTP(os.environ.get("SMTP_HOST", "smtp.gmail.com"), int(os.environ.get("SMTP_PORT", "587")),
                          timeout=30) as smtp:
            smtp.starttls(context=ssl.create_default_context())
            smtp.login(user, password)
            smtp.send_message(msg)
    except (smtplib.SMTPException, OSError) as err:
        print(f"⚠️ Preisalarm-Mail konnte nicht gesendet werden ({err})", flush=True)
        return False
    return True


def explain_http_error(err: Exception) -> str:
    if isinstance(err, urllib.error.HTTPError):
        return f"Supabase antwortet {err.code} ({err.reason}) – secret key und URL prüfen (cm secrets)"
    return f"Supabase nicht erreichbar ({err})"
