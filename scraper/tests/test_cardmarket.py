"""Tests für URL-Regeln und das Entfernen persönlicher Daten."""

from cmtracker import cardmarket
from cmtracker.discovery import redact
from cmtracker.fetcher import Page, looks_like_challenge


def test_slugify_matches_known_cardmarket_urls():
    # Beispiele aus den URLs des alten Projekts
    cases = {
        "Black Bolt & White Flare: Unova Mini Tin Display": "Black-Bolt-White-Flare-Unova-Mini-Tin-Display",
        "Tag Team Pikachu & Zekrom GX Premium Collection": "Tag-Team-Pikachu-Zekrom-GX-Premium-Collection",
        "30th Celebration: Umbreon ex Ultra-Premium Collection": "30th-Celebration-Umbreon-ex-Ultra-Premium-Collection",
        "Pokémon Card 151 Booster Box": "Pokemon-Card-151-Booster-Box",
        "Destined Rivals 6 Booster Box Case": "Destined-Rivals-6-Booster-Box-Case",
        "Champion’s Path Elite Trainer Box": "Champions-Path-Elite-Trainer-Box",
    }
    for name, slug in cases.items():
        assert cardmarket.slugify(name) == slug


def test_product_url_and_language():
    url = cardmarket.product_url("Pokemon", "Booster-Boxes", "Destined Rivals Booster Box")
    assert url == "https://www.cardmarket.com/de/Pokemon/Products/Booster-Boxes/Destined-Rivals-Booster-Box"
    assert cardmarket.with_language(url, "ja").endswith("?language=7")
    assert cardmarket.with_language(url + "?x=1", "de").endswith("&language=3")
    assert cardmarket.product_url("Pokemon", "", "X") is None
    assert cardmarket.with_filters(url, language="en", seller_type=1, seller_country=7).endswith(
        "?language=1&sellerType=1&sellerCountry=7")


def test_redact_removes_personal_data():
    html = """<html><header><a>Paul_Account</a><span>Guthaben 12,00 €</span></header>
    <div id="cart-box">Warenkorb</div>
    <input type="hidden" name="__cmtkn" value="secret-token">
    <script>var u = {"name": "Paul_Account", "mail": "paul@example.org"};</script>
    <div id="articleRow123" class="article-row">Angebot</div></html>"""
    out = redact(html, "Paul_Account")
    assert "Paul_Account" not in out and "paul@example.org" not in out
    assert "secret-token" not in out and "Guthaben" not in out and "Warenkorb" not in out
    assert 'id="articleRow123"' in out


def test_challenge_detection():
    blocked = Page("u", "u", 403, "<title>Just a moment...</title>", "direct", 0.1)
    ok = Page("u", "u", 200, '<div class="article-row"></div>', "direct", 0.1)
    assert looks_like_challenge(blocked)
    assert not looks_like_challenge(ok)


def test_games_config_loads():
    from cmtracker.settings import load_games

    games = load_games()
    # Reihenfolge laut "order", nicht alphabetisch nach Dateiname
    assert [g.game_key for g in games] == ["pokemon", "one-piece", "flesh-and-blood"]
    pk, op, fab = games
    assert op.cardmarket_game_id == 18 and op.category_ids == {1624, 1628} and op.languages == ("en", "ja")
    assert fab.cardmarket_game_id == 16 and fab.category_ids == {1603, 1616, 1620}
    assert fab.languages == ("en", "de", "ja")
    assert pk.cardmarket_path == "Pokemon" and pk.languages == ("en", "de", "ja")
    assert pk.category(53).slug == "Booster-Boxes" and pk.offers_to_store == 50
    assert all(c.slug for c in pk.categories)


def test_normalize_url_forces_german_page():
    assert cardmarket.normalize_url(
        "https://www.cardmarket.com/en/Pokemon/Products/Tins/Poke-Ball-Tin?language=1") == \
        "https://www.cardmarket.com/de/Pokemon/Products/Tins/Poke-Ball-Tin"
    assert cardmarket.normalize_url("/fr/Pokemon/Products/Tins/X") == "https://www.cardmarket.com/de/Pokemon/Products/Tins/X"


def test_search_terms():
    assert cardmarket.search_terms("Pitch Black: Gengar Enhanced 2-Pack Blister") == [
        "Pitch Black: Gengar Enhanced 2-Pack Blister", "Gengar Enhanced 2-Pack Blister", "Gengar Enhanced 2 Pack Blister"]
    assert cardmarket.search_terms("Mysterious Powers Tins: Ho-Oh GX Tin")[-1] == "Ho Oh GX Tin"
    assert cardmarket.search_terms("Generic Tin") == ["Generic Tin"]
