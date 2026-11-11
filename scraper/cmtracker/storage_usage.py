"""Speicherverbrauch in R2: Gesamtgröße, Aufteilung, Zuwachs pro Tag und wie lange das Gratis-Kontingent reicht.

Jede Messung landet in `status/storage.json` (je Tag eine Zeile), damit der Zuwachs gegenüber gestern und im
Schnitt der letzten 7 Tage berechnet werden kann. Gemessen wird beim Tagesbericht (einmal pro Lauf) und mit
`python -m cmtracker storage`.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import date

from .storage import Storage

LOG_KEY = "status/storage.json"
FREE_GB = 10.0
AREAS = [("raw/", "Rohdaten (Angebote, Kataloge)"), ("prices/", "faire Preise"), ("history/", "Verlauf"),
         ("public/", "Website-Dateien")]


@dataclass
class Usage:
    day: date
    total: int
    areas: dict[str, int] = field(default_factory=dict)
    since_last: int | None = None      # Zuwachs pro Tag seit der letzten Messung
    avg_7d: float | None = None        # Ø Zuwachs pro Tag über bis zu 7 Tage
    days_left: float | None = None     # bis das Gratis-Kontingent voll ist (bei Ø-Zuwachs)

    def text(self, warn_gb: float | None = None) -> str:
        mb = lambda b: f"{b / 1e6:,.1f} MB".replace(",", "X").replace(".", ",").replace("X", ".")  # noqa: E731
        gb = lambda b: f"{b / 1e9:.2f} GB".replace(".", ",")  # noqa: E731
        parts = [f"{gb(self.total)} von {FREE_GB:.0f} GB gratis ({self.total / 1e9 / FREE_GB:.0%})"]
        if self.since_last is not None:
            parts.append(f"{'+' if self.since_last >= 0 else ''}{mb(self.since_last)} pro Tag seit der letzten Messung")
        if self.avg_7d is not None:
            parts.append(f"Ø {mb(self.avg_7d)}/Tag (7 Tage)")
        if self.days_left is not None:
            parts.append(f"reicht noch etwa {_duration(self.days_left)}")
        line = " · ".join(parts)
        if warn_gb is not None and self.total / 1e9 >= warn_gb:
            line = "⚠️ " + line
        return line

    def breakdown(self) -> str:
        return ", ".join(f"{label} {v / 1e9:.2f} GB".replace(".", ",") for label, v in self.areas.items() if v)


def _duration(days: float) -> str:
    if days >= 60:
        return f"{days / 30.4:.0f} Monate"
    return f"{days:.0f} Tage"


def _load_log(storage: Storage) -> list[dict]:
    raw = storage.get(LOG_KEY)
    try:
        return json.loads(raw) if raw else []
    except ValueError:
        return []


def measure(storage: Storage, today: date, save: bool = True) -> Usage:
    total = storage.total_size()
    areas = {label: storage.total_size(prefix) for prefix, label in AREAS}
    areas["Sonstiges"] = max(0, total - sum(areas.values()))
    log = [e for e in _load_log(storage) if e.get("day") != today.isoformat()]
    usage = Usage(day=today, total=total, areas=areas)
    earlier = sorted((e for e in log if e.get("day", "") < today.isoformat()), key=lambda e: e["day"])
    if earlier:
        last = earlier[-1]
        gap = max(1, (today - date.fromisoformat(last["day"])).days)
        usage.since_last = round((total - int(last["bytes"])) / gap)
        week = [e for e in earlier if (today - date.fromisoformat(e["day"])).days <= 7]
        if week:
            first = week[0]
            span = max(1, (today - date.fromisoformat(first["day"])).days)
            usage.avg_7d = (total - int(first["bytes"])) / span
        growth = usage.avg_7d if usage.avg_7d is not None else usage.since_last
        if growth and growth > 0:
            usage.days_left = max(0.0, (FREE_GB * 1e9 - total) / growth)
    if save:
        log.append({"day": today.isoformat(), "bytes": total})
        storage.put(LOG_KEY, json.dumps(sorted(log, key=lambda e: e["day"])[-400:], indent=0).encode(),
                    "application/json")
    return usage
