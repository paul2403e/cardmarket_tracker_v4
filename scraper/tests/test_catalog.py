"""Tests für Meilenstein 1 mit kleinen, künstlichen Katalogen (keine Netzwerkzugriffe)."""

from __future__ import annotations

import json
from datetime import date

import pandas as pd
import pytest

from cmtracker import catalog, review, sources
from cmtracker.settings import Category, Scope
from cmtracker.storage import LocalStorage, parquet_to_df

SCOPE = Scope(
    game_key="pokemon",
    game_name="Pokémon",
    cardmarket_game_id=6,
    cardmarket_path="Pokemon",
    categories=(Category(53, "Pokémon Display", "Booster-Boxes"),
                Category(1016, "Pokémon Elite Trainer Boxes", "Elite-Trainer-Boxes")),
    languages=("en", "de"),
    exclude_name_patterns=("S-Ch",),
)


def product(pid, name, cat_id=53, cat="Pokémon Display"):
    return {"idProduct": pid, "name": name, "idCategory": cat_id, "categoryName": cat,
            "idExpansion": 1, "idMetacard": 0, "dateAdded": "2025-01-01 00:00:00"}


def price(pid, low):
    return {"idProduct": pid, "idCategory": 53, "avg": low, "low": low, "trend": low}


def fake_fetch(products, prices, created="2026-11-05T02:50:00+0100", singles_extra=True):
    guides = list(prices)
    if singles_extra:  # Price Guide enthält auch Singles – die müssen herausgefiltert werden
        guides.append({"idProduct": 999999, "idCategory": 51, "avg": 1.0, "low": 1.0, "trend": 1.0})

    def fetch(url):
        if "products_nonsingles" in url:
            return {"version": 1, "createdAt": "2026-11-05T13:00:00+0100", "products": products}
        if "price_guide" in url:
            return {"version": 1, "createdAt": created, "priceGuides": guides}
        raise AssertionError(url)

    return fetch


@pytest.fixture
def storage(tmp_path):
    return LocalStorage(tmp_path / "data")


def day1(storage):
    products = [
        product(1, "Alpha Booster Box"),
        product(2, "Beta Booster Box"),                 # ohne Angebote
        product(3, "Gamma Elite Trainer Box", 1016, "Pokémon Elite Trainer Boxes"),
        product(4, "Delta Coin", 1017, "Pokémon Coins"),  # Kategorie nicht im Scope
        product(5, "CSV1C: Alpha S-Ch Booster Box"),    # per Muster ausgeschlossen
        product(6, "Epsilon Booster Box"),              # verschwindet an Tag 2
    ]
    prices = [price(1, 100), price(2, None), price(3, 50), price(4, 1), price(5, 30), price(6, 70)]
    return catalog.run(SCOPE, storage, fetch=fake_fetch(products, prices))


def test_first_run_scope_and_activity(storage):
    res = day1(storage)
    st = res.state.set_index("id_product")
    assert res.first_run and res.new_ids == set()
    assert res.data_date == date(2026, 11, 5)
    assert st.loc[1, "in_scope"] and st.loc[1, "active"]
    assert st.loc[2, "in_scope"] and not st.loc[2, "has_offers"] and not st.loc[2, "active"]
    assert st.loc[2, "offerless_since"] == date(2026, 11, 5)
    assert not st.loc[4, "in_scope"]
    assert not st.loc[5, "in_scope"]
    # Singles aus dem Price Guide werden nicht gespeichert
    assert set(res.prices["id_product"]) == {1, 2, 3, 4, 5, 6}


def test_second_day_new_removed_reactivated(storage):
    day1(storage)
    products = [
        product(1, "Alpha Booster Box"),
        product(2, "Beta Booster Box"),
        product(3, "Gamma Elite Trainer Box", 1016, "Pokémon Elite Trainer Boxes"),
        product(4, "Delta Coin", 1017, "Pokémon Coins"),
        product(5, "CSV1C: Alpha S-Ch Booster Box"),
        product(7, "Zeta Booster Box"),                 # neu
    ]
    prices = [price(1, None), price(2, 80), price(3, 50), price(4, 1), price(5, 30), price(7, 120)]
    res = catalog.run(SCOPE, storage, fetch=fake_fetch(products, prices, created="2026-11-06T02:50:00+0100"))
    st = res.state.set_index("id_product")

    assert not res.first_run
    assert res.data_date == date(2026, 11, 6)
    assert res.new_ids == {7}
    assert res.removed_ids == {6}
    assert res.reactivated_ids == {2}
    assert st.loc[1, "offerless_since"] == date(2026, 11, 6) and not st.loc[1, "active"]
    assert st.loc[2, "active"] and st.loc[2, "offerless_since"] is None
    assert st.loc[1, "first_seen"] == date(2026, 11, 5)
    assert st.loc[7, "first_seen"] == date(2026, 11, 6)
    assert st.loc[6, "removed_since"] == date(2026, 11, 6) and not st.loc[6, "active"]

    # Tag 3: Produkt 6 bleibt entfernt, Datum des Verschwindens bleibt erhalten
    res3 = catalog.run(SCOPE, storage, fetch=fake_fetch(products, prices, created="2026-11-07T02:50:00+0100"))
    st3 = res3.state.set_index("id_product")
    assert res3.removed_ids == set()
    assert st3.loc[6, "removed_since"] == date(2026, 11, 6)
    assert st3.loc[1, "offerless_since"] == date(2026, 11, 6)


def test_files_written(storage):
    day1(storage)
    d = "2026-11-05"
    for key in (
        f"raw/catalog/pokemon/date={d}/products_nonsingles.json.gz",
        f"raw/priceguide/pokemon/date={d}/price_guide_nonsingles.json.gz",
        f"priceguide/pokemon/date={d}/part.parquet",
        "catalog/pokemon/products.parquet",
        "catalog/pokemon/state.json",
    ):
        assert storage.get(key) is not None, key
    state = json.loads(storage.get("catalog/pokemon/state.json"))
    assert state["catalog_product_count"] == 6
    df = parquet_to_df(storage.get("catalog/pokemon/products.parquet"))
    assert len(df) == 6


def test_validation_aborts_on_shrunk_catalog(storage):
    day1(storage)
    with pytest.raises(catalog.ValidationError):
        catalog.run(SCOPE, storage, fetch=fake_fetch([product(1, "Alpha Booster Box")], [price(1, 10)]))


def test_stale_price_guide_warns(storage):
    day1(storage)
    res = day1(storage)
    assert any("nicht aktualisiert" in w for w in res.warnings)


def test_bad_source_format():
    with pytest.raises(sources.SourceError):
        sources.validate_products({"createdAt": "2026-11-05T02:50:00+0100", "products": []})
    with pytest.raises(sources.SourceError):
        sources.parse_created_at("05.11.2026")


def test_berlin_date_after_midnight_utc():
    # 23:30 UTC am 4.11. ist in Berlin schon der 5.11.
    dt = sources.parse_created_at("2026-11-04T23:30:00+0000")
    assert sources.berlin_date(dt) == date(2026, 11, 5)


def test_review_outputs(storage, tmp_path):
    res = day1(storage)
    md = review.summary_markdown(res, SCOPE)
    assert "Pokémon Display" in md and "Erster Lauf" in md
    path = review.write_excel(res, SCOPE, tmp_path / "out" / "review.xlsx")
    sheet = pd.read_excel(path, sheet_name="Alle Produkte")
    assert len(sheet) == 6
    assert set(sheet.loc[sheet["Hinweise"].fillna("").str.contains("Chinesisch"), "ID"]) == {5}


def test_r2_config_format_check(monkeypatch):
    from cmtracker.settings import ConfigError, r2_config_from_env

    for env in ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"):
        monkeypatch.delenv(env, raising=False)
    assert r2_config_from_env() is None

    monkeypatch.setenv("R2_ACCOUNT_ID", "a" * 32)
    monkeypatch.setenv("R2_ACCESS_KEY_ID", "cm-market-key")  # 13 Zeichen – falscher Wert
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "b" * 64)
    monkeypatch.setenv("R2_BUCKET", "cm-market-data")
    with pytest.raises(ConfigError) as err:
        r2_config_from_env()
    assert "R2_ACCESS_KEY_ID hat 13 Zeichen" in str(err.value)
    assert "cm-market-key" not in str(err.value)  # Werte nie ausgeben

    monkeypatch.setenv("R2_ACCESS_KEY_ID", "c" * 32)
    cfg = r2_config_from_env()
    assert cfg.endpoint_url == f"https://{'a' * 32}.r2.cloudflarestorage.com"


def test_no_language_products_excluded_and_hidden(storage, tmp_path):
    from cmtracker.scrape import META_SCHEMA
    from cmtracker.storage import df_to_parquet

    meta = pd.DataFrame([{"id_product": 1, "url": "u", "url_source": "rule", "name_de": "x",
                          "languages": ["id", "th"], "image_url": "", "last_ok": None, "languages_checked": None}],
                        columns=META_SCHEMA.names)
    storage.put("catalog/pokemon/meta.parquet", df_to_parquet(meta, META_SCHEMA))
    res = day1(storage)
    st = res.state.set_index("id_product")
    assert not st.loc[1, "in_scope"] and not st.loc[1, "active"]
    assert st.loc[1, "excluded_reason"] == "keine passende Sprache"
    assert st.loc[4, "excluded_reason"] == "Kategorie" and st.loc[5, "excluded_reason"] == "Ausschluss-Regel"
    path = review.write_excel(res, SCOPE, tmp_path / "r.xlsx")
    assert 1 not in set(pd.read_excel(path, sheet_name="Alle Produkte")["ID"])
