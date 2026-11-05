"""Konfiguration: Scope-Datei laden und Umgebungsvariablen lesen."""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path

import yaml

DEFAULT_SCOPE_PATH = Path(__file__).resolve().parent.parent / "config" / "scope.yaml"


@dataclass(frozen=True)
class Category:
    id: int
    name: str


@dataclass(frozen=True)
class Scope:
    game_key: str
    game_name: str
    cardmarket_game_id: int
    categories: tuple[Category, ...]
    languages: tuple[str, ...]
    exclude_name_patterns: tuple[str, ...] = ()
    exclude_product_ids: frozenset[int] = field(default_factory=frozenset)
    min_products_ratio: float = 0.9

    @property
    def category_ids(self) -> frozenset[int]:
        return frozenset(c.id for c in self.categories)

    def is_excluded(self, product_id: int, name: str) -> bool:
        if product_id in self.exclude_product_ids:
            return True
        return any(re.search(p, name, re.IGNORECASE) for p in self.exclude_name_patterns)


def load_scope(path: Path | str = DEFAULT_SCOPE_PATH) -> Scope:
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
        categories=tuple(Category(int(c["id"]), c["name"]) for c in raw["categories"]),
        languages=tuple(raw.get("languages") or ()),
        exclude_name_patterns=patterns,
        exclude_product_ids=frozenset(int(i) for i in (exclude.get("product_ids") or ())),
        min_products_ratio=float((raw.get("validation") or {}).get("min_products_ratio", 0.9)),
    )


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
