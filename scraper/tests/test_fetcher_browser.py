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
