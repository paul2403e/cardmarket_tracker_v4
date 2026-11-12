"""Browser-Sitzung: Auswahl nodriver/FlareSolverr; Chrome-Fenster verschwindet ("invalid session id"): einmal neu starten."""
from __future__ import annotations

import pytest

from cmtracker import fetcher
from cmtracker.fetcher import CardmarketSession, FetchError, Page

LOST = FetchError("FlareSolverr meldet: Error: Error solving the challenge. Message: invalid session id; "
                  "For documentation on this error, please visit: https://www.selenium.dev/…")


class FakeFS:
    def __init__(self, fail_times: int, error: FetchError = LOST):
        self.fail_times, self.error, self.calls = fail_times, error, 0

    def request(self, url, **kw):
        self.calls += 1
        if self.fail_times:
            self.fail_times -= 1
            raise self.error
        return Page(url, url, 200, "<div class='article-row'></div>", "flaresolverr", 0.1)


@pytest.fixture
def session(monkeypatch):
    s = CardmarketSession("user", "pw", fs=FakeFS(0))
    s.logins = 0

    def login(keep_browser=False):
        s.logins += 1
        s._browser_open = s.logged_in = True

    monkeypatch.setattr(s, "login", login)
    monkeypatch.setattr(fetcher.time, "sleep", lambda *_: None)
    s._browser_open = s.logged_in = True
    return s


def test_lost_browser_restarts_once_and_retries(session):
    session.fs = FakeFS(1)
    page = session.get("https://www.cardmarket.com/x")
    assert page.status == 200 and session.logins == 1 and session.browser_restarts == 1


def test_lost_browser_second_time_is_a_normal_error(session):
    session.fs = FakeFS(1)
    session.get("https://www.cardmarket.com/x")
    session.fs = FakeFS(1)
    with pytest.raises(FetchError, match="invalid session id"):
        session.get("https://www.cardmarket.com/y")
    assert session.logins == 1


def test_other_errors_do_not_restart(session):
    session.fs = FakeFS(1, FetchError("FlareSolverr meldet: Error: Timeout after 120.0 seconds."))
    with pytest.raises(FetchError, match="Timeout"):
        session.get("https://www.cardmarket.com/x")
    assert session.logins == 0 and session.browser_restarts == 0


def test_browser_choice(monkeypatch):
    from cmtracker.chrome import NodriverBrowser

    monkeypatch.delenv("CM_BROWSER", raising=False)
    assert isinstance(fetcher.make_browser(), fetcher.FlareSolverr)  # ohne Angabe wie bisher (Linux-Teil)
    monkeypatch.setenv("CM_BROWSER", "nodriver")
    assert isinstance(fetcher.make_browser(), NodriverBrowser)
    s = CardmarketSession("user", "pw")
    assert isinstance(s.fs, NodriverBrowser) and not s.go_visible()  # Fenster ist ohnehin sichtbar
    monkeypatch.setenv("CM_BROWSER", "firefox")
    with pytest.raises(FetchError, match="unbekannt"):
        fetcher.make_browser()


def test_close_after_login_old_and_new_name(monkeypatch):
    monkeypatch.delenv("FLARESOLVERR_CLOSE_AFTER_LOGIN", raising=False)
    monkeypatch.setenv("CM_CLOSE_BROWSER_AFTER_LOGIN", "1")
    assert CardmarketSession("u", "p", fs=FakeFS(0)).close_after_login
    monkeypatch.delenv("CM_CLOSE_BROWSER_AFTER_LOGIN")
    monkeypatch.setenv("FLARESOLVERR_CLOSE_AFTER_LOGIN", "1")
    assert CardmarketSession("u", "p", fs=FakeFS(0)).close_after_login


def test_nodriver_errors_count_as_lost_browser():
    """Text, den chrome.py bei geschlossenem Chrome-Fenster meldet, löst den einmaligen Neustart aus."""
    assert fetcher.is_browser_lost(FetchError("Browser meldet: chrome not reachable (ConnectionClosedError: x)"))


@pytest.mark.parametrize("title, html, expected", [
    ("Just a moment...", "", True),
    ("Nur einen Moment…", "", True),
    ("Pokémon Booster Box | Cardmarket", "<div class='article-row'>", False),
    ("", "<script>window._cf_chl_opt={}</script>", True),
    ("Cardmarket", "<script src='/cdn-cgi/challenge-platform/scripts/jsd/main.js'></script>", False),
])
def test_nodriver_challenge_detection(title, html, expected):
    from cmtracker.chrome import _is_challenge

    assert _is_challenge(title, html) is expected


class LoggedInFS:
    """Festes Chrome-Profil: Login-Seite zeigt schon den angemeldeten Nutzer (kein Formular)."""

    def __init__(self):
        self.urls, self.started, self.stopped = [], 0, 0

    def start(self):
        self.started += 1

    def stop(self):
        self.stopped += 1

    def request(self, url, **kw):
        self.urls.append((url, "post_data" in kw))
        return Page(url, url, 200, "<html><a href='/Logout'>Logout</a> user</html>", "browser", 0.1)


def test_login_skipped_when_profile_still_logged_in(monkeypatch):
    monkeypatch.setenv("CM_CLOSE_BROWSER_AFTER_LOGIN", "0")
    monkeypatch.delenv("FLARESOLVERR_CLOSE_AFTER_LOGIN", raising=False)
    fs = LoggedInFS()
    s = CardmarketSession("user", "pw", fs=fs)
    s.login()
    assert s.logged_in and len(fs.urls) == 1 and not fs.urls[0][1]  # kein Anmelde-POST
    assert s._browser_open and fs.stopped == 0  # nodriver: Fenster bleibt offen


@pytest.mark.parametrize("ua, expected", [
    ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
     "chrome146"),
    ("… Chrome/149.0.1.2 Safari/537.36", "chrome146"),   # nächstältere bekannte Version
    ("… Chrome/190.0.0.0 Safari/537.36", "chrome152"),   # neuer als alles Bekannte -> neueste
    ("… Chrome/50.0.0.0 …", "chrome"),                    # älter als alles Bekannte
    ("", "chrome"),
])
def test_impersonate_matches_browser_version(ua, expected):
    assert fetcher.impersonate_target(ua) == expected


def test_direct_rejections_are_logged_sparingly(capsys):
    s = CardmarketSession("u", "p", fs=FakeFS(0))
    page = Page("u", "u", 403, "<title>Nur einen Moment…</title>", "direct", 0.1)
    for _ in range(60):
        s.note_direct_rejected(page)
    lines = [ln for ln in capsys.readouterr().out.splitlines() if "Direktabruf abgelehnt" in ln]
    assert s.direct_rejected == 60 and len(lines) == 6  # 1.–5. und 50.
