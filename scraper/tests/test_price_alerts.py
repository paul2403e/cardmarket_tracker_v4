"""Preisalarme: Bedingungen, einmal melden / wieder scharf, Sammel-Mail je Nutzer."""

from __future__ import annotations

import time
from datetime import date

import pandas as pd
import pytest

from cmtracker import price_alerts, pricing, publish, scrape
from cmtracker.storage import LocalStorage

from test_scrape import NOW, SCOPE, FakeSession, catalog_state

D = date(2026, 11, 30)


def lh(values: dict[int, tuple[float, int]]) -> pd.DataFrame:
    """{Tage zurück: (Preis €, Stück)} -> Verlauf einer Variante bis D."""
    rows = [{"day": D - pd.Timedelta(days=k).to_pytimedelta(), "eu_incl": p * 100, "eu_excl": p * 90, "all_incl": p * 95,
             "all_excl": p * 85, "items_total": n} for k, (p, n) in values.items()]
    return pd.DataFrame(rows).sort_values("day")


def alert(kind, threshold, **kw):
    return {"id": "a1", "user_id": "u1", "game": "pokemon", "product_id": 1, "language": "en", "product_name": "Box",
            "kind": kind, "threshold": threshold, "metric": "price", "days": 7, "direction": "any", "basis": "incl",
            "region": "eu", "armed": True, "active": True, "last_checked_day": None} | kw


def test_conditions():
    h = lh({0: (90, 12), 7: (100, 20)})
    assert price_alerts.evaluate(alert("price_below", 95), h, D).met
    assert not price_alerts.evaluate(alert("price_above", 95), h, D).met
    assert price_alerts.evaluate(alert("price_above", 80, basis="excl"), h, D).value == 81.0  # 90 € × 0,9
    assert price_alerts.evaluate(alert("items_below", 15), h, D).met
    assert not price_alerts.evaluate(alert("items_above", 15), h, D).met
    c = price_alerts.evaluate(alert("change", 5, direction="down"), h, D)
    assert c.met and c.value == -10.0 and "fell by -10,0 %" in c.message
    assert not price_alerts.evaluate(alert("change", 5, direction="up"), h, D).met
    assert price_alerts.evaluate(alert("change", 30, metric="items", direction="any"), h, D).met  # 20 -> 12 = −40 %
    # kein Wert heute -> nichts prüfen
    assert price_alerts.evaluate(alert("price_below", 95), lh({1: (90, 1)}), D) is None


class FakeSupabase:
    def __init__(self, alerts):
        self.alerts = {a["id"]: dict(a) for a in alerts}
        self.events = []

    def active_alerts(self):
        return [dict(a) for a in self.alerts.values() if a["active"]]

    def update_alert(self, alert_id, values):
        self.alerts[alert_id].update(values)

    def add_events(self, rows):
        self.events += rows

    def user_email(self, user_id):
        return f"{user_id}@example.com"


@pytest.fixture
def storage(tmp_path, monkeypatch):
    monkeypatch.setattr(scrape, "_pause", lambda: None)
    monkeypatch.setattr(scrape, "_sleep", lambda seconds: None)
    st = LocalStorage(tmp_path / "data")
    catalog_state(st)
    scrape.run(SCOPE, st, FakeSession(), deadline=time.time() + 600, now=NOW)
    cfg = pricing.load_pricing()
    pricing.run(SCOPE, st, cfg, today=date(2026, 11, 6))
    publish.build(SCOPE, st, date(2026, 11, 6), cfg)
    return st


def test_run_triggers_once_and_rearms(storage):
    hist = publish.load_history(storage, "pokemon")
    row = hist[hist["eu_incl"].notna()].iloc[0]
    price = row["eu_incl"] / 100
    a_low = alert("price_below", price + 1, id="a1", product_id=int(row["id_product"]), language=row["language"])
    a_high = alert("price_above", price + 1, id="a2", user_id="u2", product_id=int(row["id_product"]), language=row["language"])
    sb = FakeSupabase([a_low, a_high])
    mails = []
    res = price_alerts.run([SCOPE], storage, sb, send=lambda to, items: mails.append((to, items)) or True)
    assert (res.checked, res.triggered, res.mails) == (2, 1, 1)
    assert mails[0][0] == "u1@example.com" and "Price below" in mails[0][1][0]["message"]
    assert sb.alerts["a1"]["armed"] is False and sb.alerts["a1"]["last_checked_day"] == "2026-11-06"
    assert len(sb.events) == 1
    # derselbe Markttag wird nicht noch einmal geprüft
    res = price_alerts.run([SCOPE], storage, sb, send=lambda *a: True)
    assert res.checked == 0
    # nächster Tag, Bedingung nicht mehr erfüllt -> wieder scharf, keine Mail
    sb.alerts["a1"].update({"last_checked_day": None, "threshold": price - 1})
    res = price_alerts.run([SCOPE], storage, sb, send=lambda *a: True)
    assert res.triggered == 0 and sb.alerts["a1"]["armed"] is True


def test_skipped_without_supabase(storage, monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SECRET_KEY", raising=False)
    assert price_alerts.run([SCOPE], storage).skipped


def test_digest_text():
    items = [{"alert": alert("price_below", 10), "message": "Price below 10,00 €: now 9,50 €", "game_name": "Pokémon", "day": D}]
    subject, body = price_alerts.digest_text(items)
    assert subject.startswith("1 price alert: Box")
    assert "/pokemon/product/1?lang=en" in body and "/watchlist" in body
