"""Meilenstein 2a: Erkundung – echte Cardmarket-Seiten laden, damit der Parser daran gebaut werden kann.

Lädt eine Handvoll typischer Seiten (eingeloggt), prüft die URL-Regel und den schnellen Direktabruf,
entfernt persönliche Daten und legt alles als ZIP privat in R2 ab (debug/discovery/…).
"""

from __future__ import annotations

import io
import json
import os
import random
import re
import time
import zipfile
from dataclasses import asdict, dataclass
from datetime import datetime, timezone

from bs4 import BeautifulSoup

from . import cardmarket, sources
from .fetcher import CardmarketSession, FetchError, Page, looks_like_challenge
from .settings import Scope
from .storage import Storage


@dataclass
class Sample:
    key: str
    product_id: int
    language: str | None
    purpose: str


# Feste Beispiele (IDs aus dem Cardmarket-Katalog vom 05.11.2026)
SAMPLES = [
    Sample("display_all", 818574, None, "Display ohne Sprachfilter (Sprach-Erkennung)"),
    Sample("display_en", 818574, "en", "Display Englisch"),
    Sample("display_de", 818574, "de", "Display Deutsch"),
    Sample("etb_en", 818585, "en", "ETB Englisch, viele Angebote ('Mehr anzeigen')"),
    Sample("case_en", 818576, "en", "Booster-Box-Case Englisch"),
    Sample("jp_all", 681796, None, "Japanisches Produkt ohne Sprachfilter"),
    Sample("jp_ja", 681796, "ja", "Japanisches Produkt, Sprache Japanisch"),
    # Nur zur Prüfung der URL-Regel (Sonderzeichen, Kategorien)
    Sample("url_tin", 824097, None, "URL-Regel: '&' und ':' im Namen (Tins)"),
    Sample("url_tin_151", 719711, None, "URL-Regel: Name beginnt mit '151:'"),
    Sample("url_etb_case", 690876, None, "URL-Regel: typografischer Apostroph"),
    Sample("url_blister", 818579, None, "URL-Regel: Kategorie Blisters"),
    Sample("url_boxset", 895578, None, "URL-Regel: Kategorie Box Sets"),
]

SENSITIVE_ATTR = re.compile(r"account|user-?nav|usernav|cart|basket|balance|credit|wallet|notification|messages?-count",
                            re.IGNORECASE)
EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")


def redact(html: str, username: str) -> str:
    """Persönliche Daten entfernen: Kopfbereich, Konto-/Warenkorb-Elemente, Benutzername, E-Mails, Tokens."""
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup.find_all("header"):
        tag.decompose()
    for tag in soup.find_all(True):
        if tag.decomposed:
            continue
        attrs = " ".join([tag.get("id") or ""] + list(tag.get("class") or []))
        if attrs and SENSITIVE_ATTR.search(attrs):
            tag.decompose()
    for inp in soup.select("input[type='hidden']"):
        if inp.get("value") and re.search(r"tkn|token|csrf", inp.get("name") or "", re.IGNORECASE):
            inp["value"] = "REDACTED"
    text = str(soup)
    if username:
        text = re.sub(re.escape(username), "REDACTED_USER", text, flags=re.IGNORECASE)
    text = EMAIL.sub("redacted@example.com", text)
    return text


def page_facts(page: Page, product_id: int | None) -> dict:
    html = page.html
    return {
        "requested_url": page.requested_url,
        "final_url": page.final_url,
        "status": page.status,
        "via": page.via,
        "seconds": page.elapsed_s,
        "title": page.title[:120],
        "bytes": len(html),
        "challenge": looks_like_challenge(page),
        "product_id_in_page": (str(product_id) in html) if product_id else None,
        "article_rows": len(re.findall(r'id="articleRow', html)),
        "load_more_hint": bool(re.search(r"Mehr anzeigen|loadMore|load-more|showMore", html, re.IGNORECASE)),
    }


def _pause() -> None:
    time.sleep(random.uniform(3, 6))


def run(scope: Scope, storage: Storage) -> tuple[str, str]:
    username = os.environ.get("CM_USERNAME", "")
    session = CardmarketSession(username, os.environ.get("CM_PASSWORD", ""), game_path=scope.cardmarket_path)

    products = {int(p["idProduct"]): p for p in sources.validate_products(
        sources.fetch_json(sources.PRODUCTS_NONSINGLES_URL.format(game_id=scope.cardmarket_game_id)))}
    guide = {int(g["idProduct"]): g for g in sources.validate_price_guide(
        sources.fetch_json(sources.PRICE_GUIDE_URL.format(game_id=scope.cardmarket_game_id)))}
    samples = list(SAMPLES)
    offerless = sorted(
        (p for pid, p in products.items()
         if p["idCategory"] == 53 and (guide.get(pid) or {}).get("low") is None
         and not scope.is_excluded(pid, p["name"])),
        key=lambda p: p["idProduct"], reverse=True)
    if offerless:
        samples.append(Sample("display_no_offers", int(offerless[0]["idProduct"]), None, "Display ohne Angebote"))

    report: dict = {"started_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "pages": {}}
    files: dict[str, str] = {}

    print("🔑 Login …", flush=True)
    session.login()
    print("✅ Eingeloggt", flush=True)
    try:
        for s in samples:
            p = products.get(s.product_id)
            if not p:
                report["pages"][s.key] = {"error": "Produkt nicht im Katalog"}
                continue
            cat = scope.category(p["idCategory"])
            url = cardmarket.with_language(
                cardmarket.product_url(scope.cardmarket_path, cat.slug if cat else "", p["name"]), s.language)
            print(f"→ {s.key}: {url}", flush=True)
            try:
                page = session.get(url)
            except FetchError as err:
                report["pages"][s.key] = {"requested_url": url, "error": str(err)}
                continue
            facts = page_facts(page, s.product_id)
            facts.update({"purpose": s.purpose, "product_name": p["name"], "language": s.language})
            report["pages"][s.key] = facts
            files[f"pages/{s.key}.html"] = redact(page.html, username)
            _pause()

        # Suche (falls die URL-Regel einmal nicht greift)
        search = cardmarket.search_url(scope.cardmarket_path, "Destined Rivals Booster Box")
        print(f"→ search: {search}", flush=True)
        try:
            page = session.get(search)
            report["pages"]["search"] = page_facts(page, 818574) | {"purpose": "Suchergebnis"}
            files["pages/search.html"] = redact(page.html, username)
        except FetchError as err:
            report["pages"]["search"] = {"requested_url": search, "error": str(err)}
        _pause()

        # Schneller Direktabruf mit den Cookies aus dem Browser
        report["direct"] = {}
        for key in ("display_en", "etb_en"):
            url = report["pages"].get(key, {}).get("requested_url")
            if not url:
                continue
            print(f"⚡ Direktabruf {key}", flush=True)
            try:
                page = session.get_direct(url)
                report["direct"][key] = page_facts(page, None)
                files[f"pages/direct_{key}.html"] = redact(page.html, username)
            except FetchError as err:
                report["direct"][key] = {"requested_url": url, "error": str(err)}
            _pause()
    finally:
        session.close()

    report["finished_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    summary = summary_markdown(report)
    files["report.json"] = json.dumps(report, indent=2, ensure_ascii=False)
    files["summary.md"] = summary

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, content in files.items():
            zf.writestr(name, content)
    key = f"debug/discovery/erkundung_{datetime.now(timezone.utc):%Y%m%d-%H%M%S}.zip"
    storage.put(key, buf.getvalue(), "application/zip")
    return key, summary


def summary_markdown(report: dict) -> str:
    lines = [
        "# Erkundung Cardmarket-Seiten",
        "",
        "| Seite | Status | Sek. | Prüfseite? | Produkt-ID gefunden | Angebotszeilen | „Mehr anzeigen“ | Ziel-URL |",
        "|---|---:|---:|:-:|:-:|---:|:-:|---|",
    ]

    def yn(v):
        return "–" if v is None else ("ja" if v else "nein")

    for key, f in report["pages"].items():
        if "error" in f:
            lines.append(f"| {key} | Fehler | | | | | | {f['error']} |")
            continue
        changed = "" if f["final_url"] == f["requested_url"] else " ↪ umgeleitet"
        lines.append(
            f"| {key} | {f['status']} | {f['seconds']} | {yn(f['challenge'])} | {yn(f['product_id_in_page'])} | "
            f"{f['article_rows']} | {yn(f['load_more_hint'])} | {f['final_url']}{changed} |"
        )
    lines += ["", "**Schneller Direktabruf (ohne Browser):**", ""]
    for key, f in (report.get("direct") or {}).items():
        if "error" in f:
            lines.append(f"- {key}: Fehler – {f['error']}")
        else:
            ok = not f["challenge"] and f["article_rows"] > 0
            lines.append(f"- {key}: Status {f['status']}, {f['seconds']} s, {f['article_rows']} Angebotszeilen → "
                         + ("✅ funktioniert" if ok else "❌ blockiert oder leer"))
    return "\n".join(lines) + "\n"
