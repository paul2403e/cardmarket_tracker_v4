"""Konfiguration: Spiel-Dateien (config/games/*.yaml) laden und Umgebungsvariablen lesen."""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path

import yaml

GAMES_DIR = Path(__file__).resolve().parent.parent / "config" / "games"
MONITORING_PATH = Path(__file__).resolve().parent.parent / "config" / "monitoring.yaml"


def load_monitoring(path: Path | str = MONITORING_PATH) -> dict:
    """Schwellen für die Plausibilitätsprüfungen (config/monitoring.yaml)."""
    p = Path(path)
    return (yaml.safe_load(p.read_text(encoding="utf-8")) or {}) if p.exists() else {}


@dataclass(frozen=True)
class Category:
    id: int
    name: str
    slug: str = ""


@dataclass(frozen=True)
class Scope:
    game_key: str
    game_name: str
    cardmarket_game_id: int
    cardmarket_path: str
    categories: tuple[Category, ...]
    languages: tuple[str, ...]
    exclude_name_patterns: tuple[str, ...] = ()
    exclude_product_ids: frozenset[int] = field(default_factory=frozenset)
    min_products_ratio: float = 0.9
    offers_to_store: int = 50

    @property
    def category_ids(self) -> frozenset[int]:
        return frozenset(c.id for c in self.categories)

    def category(self, id_category: int) -> Category | None:
        return next((c for c in self.categories if c.id == id_category), None)

    def is_excluded(self, product_id: int, name: str) -> bool:
        if product_id in self.exclude_product_ids:
            return True
        return any(re.search(p, name, re.IGNORECASE) for p in self.exclude_name_patterns)


def load_scope(path: Path | str) -> Scope:
    raw = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    game = raw["game"]
    exclude = raw.get("exclude") or {}
    patterns = tuple(exclude.get("name_patterns") or ())
    for p in patterns:
        re.compile(p)  # Tippfehler im Muster sofort sichtbar machen
    return Scope(
        game_key=game["key"],
        game_name=game["name"],
        cardmarket_game_id=int(game["cardmarket_id"]),
        cardmarket_path=game["cardmarket_path"],
        categories=tuple(Category(int(c["id"]), c["name"], c.get("slug", "")) for c in raw["categories"]),
        languages=tuple(raw.get("languages") or ()),
        exclude_name_patterns=patterns,
        exclude_product_ids=frozenset(int(i) for i in (exclude.get("product_ids") or ())),
        min_products_ratio=float((raw.get("validation") or {}).get("min_products_ratio", 0.9)),
        offers_to_store=int(raw.get("offers_to_store", 50)),
    )


def load_games(games_dir: Path | str = GAMES_DIR, only: str | None = None) -> list[Scope]:
    """Alle Spiele aus config/games/*.yaml – optional nur eines (Schlüssel, z. B. 'pokemon')."""
    scopes = [load_scope(p) for p in sorted(Path(games_dir).glob("*.yaml"))]
    keys = [s.game_key for s in scopes]
    if len(keys) != len(set(keys)):
        raise ValueError(f"Doppelter Spiel-Schlüssel in {games_dir}: {keys}")
    if only:
        scopes = [s for s in scopes if s.game_key == only]
        if not scopes:
            raise ValueError(f"Spiel '{only}' nicht gefunden. Vorhanden: {', '.join(keys)}")
    return scopes


@dataclass(frozen=True)
class R2Config:
    account_id: str
    access_key_id: str
    secret_access_key: str
    bucket: str

    @property
    def endpoint_url(self) -> str:
        return f"https://{self.account_id}.r2.cloudflarestorage.com"


class ConfigError(RuntimeError):
    """Zugangsdaten fehlen teilweise oder haben ein falsches Format."""


# Erwartetes Format der Cloudflare-R2-Werte: (Umgebungsvariable, Feld, Länge, nur Hex-Zeichen)
_R2_FORMAT = [
    ("R2_ACCOUNT_ID", "account_id", 32, True),
    ("R2_ACCESS_KEY_ID", "access_key_id", 32, True),
    ("R2_SECRET_ACCESS_KEY", "secret_access_key", 64, True),
    ("R2_BUCKET", "bucket", None, False),
]


def r2_config_from_env() -> R2Config | None:
    """Liefert die R2-Zugangsdaten, None wenn keine gesetzt sind, oder einen ConfigError,
    wenn sie unvollständig oder offensichtlich falsch sind. Werte werden nie ausgegeben."""
    values = {field: os.environ.get(env, "").strip() for env, field, _, _ in _R2_FORMAT}
    if not any(values.values()):
        return None
    problems = []
    for env, field, length, hex_only in _R2_FORMAT:
        value = values[field]
        if not value:
            problems.append(f"{env} ist leer.")
        elif length and len(value) != length:
            problems.append(f"{env} hat {len(value)} Zeichen, erwartet werden {length}.")
        elif hex_only and not re.fullmatch(r"[0-9a-fA-F]+", value):
            problems.append(f"{env} enthält Zeichen, die dort nicht vorkommen (erwartet: 0-9 und a-f).")
    if problems:
        raise ConfigError(
            "R2-Zugangsdaten passen nicht:\n- " + "\n- ".join(problems)
            + "\nBitte die GitHub-Secrets prüfen (Settings → Secrets and variables → Actions)."
        )
    return R2Config(**values)
