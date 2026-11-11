from datetime import date

from cmtracker import storage_usage
from cmtracker.storage import LocalStorage


def test_measure_growth_and_projection(tmp_path):
    st = LocalStorage(tmp_path)
    st.put("raw/a.bin", b"x" * 1000)
    st.put("prices/p.bin", b"x" * 200)
    first = storage_usage.measure(st, date(2026, 11, 1))
    assert first.since_last is None and first.days_left is None and "von 10 GB" in first.text()
    st.put("raw/b.bin", b"x" * 5000)  # + 5000 Byte (plus das Protokoll selbst)
    u = storage_usage.measure(st, date(2026, 11, 2))
    assert u.areas["Rohdaten (Angebote, Kataloge)"] == 6000 and u.areas["faire Preise"] == 200
    assert 5000 <= u.since_last <= 5200 and u.avg_7d is not None and u.days_left > 1000
    assert "pro Tag seit der letzten Messung" in u.text() and "reicht noch etwa" in u.text()
    # zweite Messung am selben Tag ersetzt die erste im Protokoll
    storage_usage.measure(st, date(2026, 11, 2))
    import json
    days = [e["day"] for e in json.loads(st.get(storage_usage.LOG_KEY))]
    assert days == ["2026-11-01", "2026-11-02"]


def test_warning_mark():
    u = storage_usage.Usage(day=date(2026, 11, 2), total=int(8.5e9))
    assert u.text(8.0).startswith("⚠️") and not u.text(9.0).startswith("⚠️")
