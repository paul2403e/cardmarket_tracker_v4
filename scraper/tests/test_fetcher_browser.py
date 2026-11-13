"""Chrome-Fenster der FlareSolverr-Sitzung verschwindet ("invalid session id"): einmal neu starten."""
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


class LoginFS:
    """FlareSolverr-Attrappe für den Login: Login-Seite mit Token, danach die Seite nach dem Anmelden."""

    def __init__(self, after_html: str):
        self.after_html, self.urls = after_html, []

    def start(self):
        pass

    def stop(self):
        pass

    def request(self, url, post_data=None, **kw):
        self.urls.append(url)
        if url.endswith("/Login"):
            return Page(url, url, 200, "<input name='__cmtkn' value='T'>", "flaresolverr", 0.1)
        if post_data is not None:
            return Page(url, url, 200, self.after_html, "flaresolverr", 0.1)
        return Page(url, url, 200, "<div class='user-nav'>Paul123</div>", "flaresolverr", 0.1)


def test_login_skips_extra_check_when_page_after_login_shows_user():
    fs = LoginFS("<header>Paul123</header><main>Startseite</main>")
    s = CardmarketSession("Paul123", "pw", fs=fs)
    s.login()
    assert s.logged_in and len(fs.urls) == 2  # Login-Seite + Anmelden, keine extra Startseite


def test_login_checks_start_page_when_unclear():
    # Seite nach dem Anmelden zeigt das Formular wieder (mit vorausgefülltem Namen) -> nicht trauen, Startseite prüfen
    fs = LoginFS("<input name='username' value='Paul123'><input name='userPassword'>")
    s = CardmarketSession("Paul123", "pw", fs=fs)
    s.login()
    assert s.logged_in and len(fs.urls) == 3
