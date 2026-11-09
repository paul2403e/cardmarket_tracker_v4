"""Wartung: Kategorien eines Spiels ansehen, alte Scrape-Tage löschen.

  python -m cmtracker categories --game-id 18           Kategorien bei Cardmarket (für neue Spiele)
  python -m cmtracker cleanup --before 2026-11-08        zeigt, was gelöscht würde (Probelauf)
  python -m cmtracker cleanup --before 2026-11-08 --yes  löscht wirklich, baut Verlauf + Website neu
"""

from __future__ import annotations

import re
from collections import Counter, defaultdict
from datetime import date

from .scrape import TABLES
from .settings import Scope
from .sources import PRODUCTS_NONSINGLES_URL, fetch_json
from .storage import Storage


def list_categories(game_id: int, fetch=fetch_json) -> str:
    data = fetch(PRODUCTS_NONSINGLES_URL.format(game_id=game_id))
    products = data.get("products") or []
    counts = Counter()
    examples: dict[tuple[int, str], list[str]] = defaultdict(list)
    for p in products:
        key = (int(p.get("idCategory") or 0), str(p.get("categoryName") or "?"))
        counts[key] += 1
        if len(examples[key]) < 3:
            examples[key].append(str(p.get("name")))
    lines = [f"Cardmarket Spiel-Nummer {game_id}: {len(products)} Produkte (Stand {data.get('createdAt', '?')})", "",
             f"{'ID':>6}  {'Anzahl':>6}  Kategorie – Beispiele"]
    for (cid, name), n in counts.most_common():
        lines.append(f"{cid:>6}  {n:>6}  {name} – {' | '.join(examples[(cid, name)])}")
    return "\n".join(lines)


# --- Tage löschen -----------------------------------------------------------------------------
def _day_of(key: str) -> date | None:
    m = re.search(r"date=(\d{4}-\d{2}-\d{2})", key)
    return date.fromisoformat(m.group(1)) if m else None


def day_keys(storage: Storage, game: str) -> dict[date, list[str]]:
    """Alle Dateien je Scrape-Tag eines Spiels (Rohdaten, Fortschritt, Status, Preise, Fehlerseiten).
    Katalog und offizieller Price Guide gehören nicht dazu und bleiben."""
    prefixes = [f"scrape/{game}/{table}/" for table, _ in TABLES] + [
        f"scrape/{game}/progress/", f"status/{game}/date=", f"prices/{game}/date=", f"debug/{game}/failed/"]
    out: dict[date, list[str]] = defaultdict(list)
    for prefix in prefixes:
        for key in storage.list(prefix):
            d = _day_of(key)
            if d:
                out[d].append(key)
    return dict(out)


def cleanup(scope: Scope, storage: Storage, before: date, *, yes: bool) -> tuple[str, list[date]]:
    keys = day_keys(storage, scope.game_key)
    targets = sorted(d for d in keys if d < before)
    keep = sorted(d for d in keys if d >= before)
    lines = [f"{scope.game_name}: {len(targets)} Tag(e) vor dem {before:%d.%m.%Y} "
             f"{'werden gelöscht' if yes else 'würden gelöscht'}:"]
    for d in targets:
        lines.append(f"  {d:%d.%m.%Y}: {len(keys[d])} Dateien")
    lines.append(f"Bleiben: {', '.join(f'{d:%d.%m.%Y}' for d in keep) or '–'}")
    if yes:
        for d in targets:
            for k in keys[d]:
                storage.delete(k)
    return "\n".join(lines), targets
