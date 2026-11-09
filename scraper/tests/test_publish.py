"""Tests für das Veröffentlichen (Website-Dateien): Veränderungen, Marktindex, JSON-Dateien."""

from __future__ import annotations

import json
import time
from datetime import date

import pandas as pd
import pytest

from cmtracker import pricing, publish, scrape
from cmtracker.storage import LocalStorage

from test_scrape import NOW, SCOPE, FakeSession, catalog_state

D = date(2026, 11, 30)


def series(values: dict[int, float]) -> pd.Series:
    """{Tage zurück: Wert} -> Zeitreihe bis D."""
    s = pd.Series({D - pd.Timedelta(days=k).to_pytimedelta(): v for k, v in values.items()})
    return s.sort_index()


def test_change_needs_start_and_end():
    assert publish.change(series({0: 110, 1: 100}), D, 1) == 10.0
    assert publish.change(series({0: 90, 7: 100}), D, 7) == -10.0
    # neues Produkt erst seit 10 Tagen: keine 30-Tage-Veränderung (nicht "von 0 auf X")
    assert publish.change(series({0: 110, 10: 100}), D, 30) is None
    # heute kein Preis -> keine Veränderung
    assert publish.change(series({1: 110, 8: 100}), D, 7) is None
    # Laptop war am Stichtag aus: Wert von kurz davor zählt (Toleranz), viel älter nicht
    assert publish.change(series({0: 120, 9: 100}), D, 7) == 20.0
    assert publish.change(series({0: 120, 15: 100}), D, 7) is None


def _hist(rows):
    return pd.DataFrame([{"day": D - pd.Timedelta(days=b).to_pytimedelta(), "id_product": pid, "language": "en",
                          "eu_incl": v} for b, pid, v in rows])


def test_index_ignores_price_level_of_new_products():
    # Produkt 1 steigt von 100 auf 110 (+10 %). Produkt 2 kommt am 2. Tag neu dazu (Preis 1000).
    h = _hist([(2, 1, 100), (1, 1, 105), (1, 2, 1000), (0, 1, 110), (0, 2, 1000)])
    idx = publish.chained_index(h, "eu_incl")
    assert idx["all"][0] == 100 and idx["all"][1] == 105.0
    # Tag 3: Produkt 1 +4,76 %, Produkt 2 ±0 -> Mittel der Log-Renditen; der Preis 1000 spielt keine Rolle
    assert 102 < idx["all"][2] - 0 < 108


def test_index_unchanged_when_nobody_has_two_days():
    h = _hist([(1, 1, 100), (0, 2, 200)])
    assert publish.chained_index(h, "eu_incl")["all"] == [100.0, 100.0]


@pytest.fixture
def storage(tmp_path, monkeypatch):
    monkeypatch.setattr(scrape, "_pause", lambda: None)
    monkeypatch.setattr(scrape, "_sleep", lambda seconds: None)
    st = LocalStorage(tmp_path / "data")
    catalog_state(st)
    scrape.run(SCOPE, st, FakeSession(), deadline=time.time() + 600, now=NOW)
    return st


def test_publish_builds_website_files(storage):
    day = date(2026, 11, 6)
    cfg = pricing.load_pricing()
    pricing.run(SCOPE, storage, cfg, today=day)
    res = publish.build(SCOPE, storage, day, cfg)
    assert res.products > 0 and res.rebuilt_history

    status = json.loads(storage.get("public/pokemon/status.json"))
    assert status["day"] == "2026-11-06" and status["version"]
    cat = json.loads(storage.get("public/pokemon/catalog.json"))
    prod = next(p for p in cat["products"] if p["id"] == 818574)
    en = prod["languages"]["en"]
    assert en["price"]["eu"]["incl"] > 0 and en["items"] > 0
    assert en["change"]["7d"]["eu"] is None  # erster Tag: keine Veränderung
    assert en["url"].endswith("language=1")

    page = json.loads(storage.get("public/pokemon/products/818574.json"))
    lang = page["languages"]["en"]
    assert lang["series"]["days"] == ["2026-11-06"] and lang["series"]["eu_incl"][0] == en["price"]["eu"]["incl"]
    offers = lang["offersToday"]
    assert offers and offers == sorted(offers, key=lambda o: o["total"])
    assert any(o["excluded"] for o in page["languages"]["de"]["offersToday"])  # z. B. "tiny tear"
    assert "comment" in offers[0] and "seller" not in json.dumps(offers[0]).lower().replace("sellertype", "")

    index = json.loads(storage.get("public/pokemon/index.json"))
    assert index["eu"]["all"] == [100.0]
    spark = json.loads(storage.get("public/pokemon/spark.json"))
    assert "818574:en" in spark["eu"]

    # zweiter Lauf ohne Änderungen: nur status.json (+ Manifest) wird geschrieben
    again = publish.build(SCOPE, storage, day, cfg)
    assert not again.rebuilt_history and again.files_written <= 3


def test_cleanup_deletes_only_days_before(storage):
    from cmtracker import maintenance

    cfg = pricing.load_pricing()
    pricing.run(SCOPE, storage, cfg, today=date(2026, 11, 6))
    # zweiten Tag simulieren (Kopie des ersten)
    for k in [k for k in storage.list("scrape/pokemon/") if "date=2026-11-06" in k]:
        storage.put(k.replace("2026-11-06", "2026-11-08"), storage.get(k))
    text, deleted = maintenance.cleanup(SCOPE, storage, date(2026, 11, 8), yes=False)
    assert deleted == [date(2026, 11, 6)] and "würden gelöscht" in text
    assert storage.list("scrape/pokemon/snapshots/date=2026-11-06/")  # Probelauf löscht nichts
    maintenance.cleanup(SCOPE, storage, date(2026, 11, 8), yes=True)
    assert not storage.list("scrape/pokemon/snapshots/date=2026-11-06/")
    assert not storage.get(pricing.price_key("pokemon", date(2026, 11, 6)))
    assert storage.list("scrape/pokemon/snapshots/date=2026-11-08/")
    assert storage.get("catalog/pokemon/products.parquet")  # Katalog bleibt


def test_list_categories():
    from cmtracker import maintenance

    data = {"createdAt": "x", "products": [
        {"idCategory": 1, "categoryName": "One Piece Booster Box", "name": "OP-01 Booster Box"},
        {"idCategory": 1, "categoryName": "One Piece Booster Box", "name": "OP-02 Booster Box"},
        {"idCategory": 2, "categoryName": "One Piece Starter Deck", "name": "ST-01"},
    ]}
    text = maintenance.list_categories(18, fetch=lambda url: data)
    assert "18" in text and "One Piece Booster Box – OP-01 Booster Box | OP-02 Booster Box" in text


def test_cleanup_cli_rebuilds_website(storage, tmp_path, monkeypatch, capsys):
    from cmtracker import __main__ as cli

    cfg = pricing.load_pricing()
    pricing.run(SCOPE, storage, cfg, today=date(2026, 11, 6))
    for k in [k for k in storage.list("scrape/pokemon/") if "date=2026-11-06" in k]:
        storage.put(k.replace("2026-11-06", "2026-11-08"), storage.get(k))
    pricing.run(SCOPE, storage, cfg, today=date(2026, 11, 8))
    publish.build(SCOPE, storage, date(2026, 11, 8), cfg)
    for var in ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("LOCAL_DATA_DIR", str(tmp_path / "data"))

    assert cli.main(["cleanup", "--before", "2026-11-08", "--game", "pokemon"]) == 0
    assert "Probelauf" in capsys.readouterr().out
    assert cli.main(["cleanup", "--before", "2026-11-08", "--game", "pokemon", "--yes"]) == 0
    assert "neu aufgebaut" in capsys.readouterr().out
    page = json.loads(storage.get("public/pokemon/products/818574.json"))
    assert page["languages"]["en"]["series"]["days"] == ["2026-11-08"]


def test_publish_handles_missing_seller_fields(storage):
    """Fehlende Bewertung/Land in einem Teil der Angebote (NaN nach dem Zusammenfügen) bricht nichts ab."""
    from cmtracker.storage import df_to_parquet, parquet_to_df

    day = date(2026, 11, 6)
    keys = [k for k in storage.list("scrape/pokemon/offers/date=2026-11-06/") if k.endswith(".parquet")]
    df = parquet_to_df(storage.get(keys[0]))
    df["seller_rating"] = float("nan")   # wie eine Datei, in der die Spalte ganz leer ist
    df.loc[df.index[0], "seller_country"] = float("nan")
    df.loc[df.index[0], "seller_type"] = float("nan")
    storage.put(keys[0], df.to_parquet(index=False))
    cfg = pricing.load_pricing()
    pricing.run(SCOPE, storage, cfg, today=day)
    publish.build(SCOPE, storage, day, cfg)
    text = storage.get("public/pokemon/catalog.json").decode()
    assert "NaN" not in text


def test_json_never_writes_nan():
    assert publish._json({"a": float("nan"), "b": [1.5, float("inf")]}) == b'{"a":null,"b":[1.5,null]}'
