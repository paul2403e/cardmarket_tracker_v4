"""Seitenabruf bei Cardmarket: FlareSolverr-Session, Login und schneller Direktabruf.

Login-Ablauf aus dem alten Projekt übernommen (hat dort zuverlässig funktioniert):
Login-Seite laden -> CSRF-Token (__cmtkn) lesen -> POST -> Startseite auf Login prüfen.
"""

from __future__ import annotations

import os
import re
import time
import urllib.parse
from dataclasses import dataclass, field

import requests
from bs4 import BeautifulSoup

from .cardmarket import BASE_URL, LOCALE

FLARESOLVERR_URL = os.environ.get("FLARESOLVERR_URL", "http://localhost:8191/v1")


class FetchError(RuntimeError):
    pass


class LoginError(RuntimeError):
    pass


@dataclass
class Page:
    requested_url: str
    final_url: str
    status: int
    html: str
    via: str  # "flaresolverr" oder "direct"
    elapsed_s: float
    cookies: list[dict] = field(default_factory=list)
    user_agent: str = ""

    @property
    def title(self) -> str:
        m = re.search(r"<title>(.*?)</title>", self.html, re.IGNORECASE | re.DOTALL)
        return re.sub(r"\s+", " ", m.group(1)).strip() if m else ""


def looks_like_challenge(page: Page) -> bool:
    """Cloudflare-Prüfseite statt echter Inhalt?"""
    html = page.html[:20000]
    markers = ("Just a moment", "cf-chl", "challenge-platform", "Attention Required", "cf-turnstile")
    if page.status in (403, 429, 503):
        return True
    return any(m in html for m in markers) and "article-row" not in page.html


class FlareSolverr:
    def __init__(self, url: str = FLARESOLVERR_URL, session_id: str = "cm_session"):
        self.url = url
        self.session_id = session_id

    def _call(self, payload: dict, timeout: int = 90) -> dict:
        try:
            resp = requests.post(self.url, json=payload, timeout=timeout)
            data = resp.json()
        except (requests.RequestException, ValueError) as err:
            raise FetchError(f"FlareSolverr nicht erreichbar: {err}") from err
        if data.get("status") != "ok":
            raise FetchError(f"FlareSolverr meldet: {data.get('message')}")
        return data

    def start(self) -> None:
        try:
            self._call({"cmd": "sessions.destroy", "session": self.session_id}, timeout=20)
        except FetchError:
            pass
        self._call({"cmd": "sessions.create", "session": self.session_id}, timeout=30)

    def stop(self) -> None:
        try:
            self._call({"cmd": "sessions.destroy", "session": self.session_id}, timeout=20)
        except FetchError:
            pass

    def request(self, url: str, post_data: dict | None = None, headers: dict | None = None,
                max_timeout_ms: int = 60000) -> Page:
        payload = {
            "cmd": "request.post" if post_data is not None else "request.get",
            "url": url,
            "session": self.session_id,
            "maxTimeout": max_timeout_ms,
        }
        if post_data is not None:
            payload["postData"] = urllib.parse.urlencode(post_data)
        if headers:
            payload["headers"] = headers
        started = time.monotonic()
        data = self._call(payload, timeout=max_timeout_ms // 1000 + 30)
        sol = data.get("solution", {})
        return Page(
            requested_url=url,
            final_url=sol.get("url", url),
            status=int(sol.get("status") or 0),
            html=sol.get("response") or "",
            via="flaresolverr",
            elapsed_s=round(time.monotonic() - started, 2),
            cookies=sol.get("cookies") or [],
            user_agent=sol.get("userAgent") or "",
        )


class CardmarketSession:
    def __init__(self, username: str, password: str, game_path: str = "Pokemon",
                 fs: FlareSolverr | None = None):
        if not username or not password:
            raise LoginError("CM_USERNAME oder CM_PASSWORD fehlt (GitHub-Secrets prüfen).")
        self.username = username
        self._password = password
        self.game_path = game_path
        self.fs = fs or FlareSolverr()
        self._cookies: list[dict] = []
        self._user_agent = ""
        self._direct = None
        self.logged_in = False
        self.requests = 0

    # --- Login -------------------------------------------------------------------------------
    def login(self) -> None:
        self.fs.start()
        login_url = f"{BASE_URL}/{LOCALE}/{self.game_path}/Login"
        token = None
        page = None
        for attempt in range(1, 4):
            page = self.fs.request(login_url)
            self._remember(page)
            soup = BeautifulSoup(page.html, "html.parser")
            field_ = soup.select_one("input[name='__cmtkn']")
            if field_ and field_.get("value"):
                token = field_["value"]
                break
            time.sleep(4 * attempt)
        if not token:
            raise LoginError(f"CSRF-Token nicht gefunden. Geladene Seite: '{page.title if page else '-'}'")

        self.fs.request(
            f"{BASE_URL}/{LOCALE}/{self.game_path}/PostGetAction/User_Login",
            post_data={
                "__cmtkn": token,
                "referalPage": f"/{LOCALE}/{self.game_path}",
                "username": self.username,
                "userPassword": self._password,
            },
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "Referer": login_url,
                "Origin": BASE_URL,
            },
        )
        check = self.fs.request(f"{BASE_URL}/{LOCALE}/{self.game_path}")
        self._remember(check)
        html = check.html
        logged_in = (self.username.lower() in html.lower() or "Logout" in html
                     or "Abmelden" in html or "user-nav" in html)
        if not logged_in:
            raise LoginError("Login fehlgeschlagen: Seite zeigt keinen angemeldeten Benutzer.")
        self.logged_in = True

    def ensure_login(self) -> None:
        if not self.logged_in:
            self.login()

    # --- Abruf -------------------------------------------------------------------------------
    def get(self, url: str) -> Page:
        """Abruf über FlareSolverr (langsam, aber löst Cloudflare-Prüfungen)."""
        self.requests += 1
        page = self.fs.request(url)
        self._remember(page)
        return page

    def get_direct(self, url: str) -> Page:
        """Schneller Direktabruf mit den Cookies und dem User-Agent aus FlareSolverr."""
        from curl_cffi import requests as cffi_requests

        if self._direct is None:
            self._direct = cffi_requests.Session(impersonate="chrome")
        jar = {c["name"]: c["value"] for c in self._cookies}
        headers = {"User-Agent": self._user_agent} if self._user_agent else {}
        self.requests += 1
        started = time.monotonic()
        try:
            resp = self._direct.get(url, cookies=jar, headers=headers, timeout=45, allow_redirects=True)
        except Exception as err:  # curl_cffi wirft eigene Fehlertypen
            raise FetchError(f"Direktabruf fehlgeschlagen: {err}") from err
        return Page(
            requested_url=url,
            final_url=str(resp.url),
            status=resp.status_code,
            html=resp.text,
            via="direct",
            elapsed_s=round(time.monotonic() - started, 2),
        )

    def post_ajax(self, url: str, data: dict[str, str], referer: str) -> str:
        """Hintergrund-Request wie "Zeige mehr Angebote" – direkt, bei Problemen über FlareSolverr."""
        from curl_cffi import requests as cffi_requests

        if self._direct is None:
            self._direct = cffi_requests.Session(impersonate="chrome")
        jar = {c["name"]: c["value"] for c in self._cookies}
        headers = {"Referer": referer, "Origin": BASE_URL}
        if self._user_agent:
            headers["User-Agent"] = self._user_agent
        self.requests += 1
        try:
            resp = self._direct.post(url, data=data, cookies=jar, headers=headers, timeout=45)
            if resp.status_code == 200 and resp.text.lstrip().startswith("<?xml"):
                return resp.text
        except Exception:  # Fallback unten
            pass
        self.requests += 1
        page = self.fs.request(url, post_data=data, headers={"Content-Type": "application/x-www-form-urlencoded",
                                                             "Referer": referer, "Origin": BASE_URL})
        self._remember(page)
        return page.html

    def close(self) -> None:
        self.fs.stop()

    def _remember(self, page: Page) -> None:
        if page.cookies:
            self._cookies = page.cookies
        if page.user_agent:
            self._user_agent = page.user_agent
