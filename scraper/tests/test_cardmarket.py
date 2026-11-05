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
    url = cardmarket.product_url("pokemon", 53, "Destined Rivals Booster Box")
    assert url == "https://www.cardmarket.com/de/Pokemon/Products/Booster-Boxes/Destined-Rivals-Booster-Box"
    assert cardmarket.with_language(url, "ja").endswith("?language=7")
    assert cardmarket.with_language(url + "?x=1", "de").endswith("&language=3")
    assert cardmarket.product_url("pokemon", 999, "X") is None


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
