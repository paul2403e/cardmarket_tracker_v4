"""Seitenabruf bei Cardmarket: FlareSolverr-Session, Login und schneller Direktabruf.

Login-Ablauf aus dem alten Projekt übernommen (hat dort zuverlässig funktioniert):
Login-Seite laden -> CSRF-Token (__cmtkn) lesen -> POST -> Startseite auf Login prüfen.
"""

from __future__ import annotations

import os
import re
import socket
import subprocess
import time
import urllib.parse
from dataclasses import dataclass, field

import requests
from bs4 import BeautifulSoup

from .cardmarket import BASE_URL, LOCALE

FLARESOLVERR_URL = os.environ.get("FLARESOLVERR_URL", "http://localhost:8191/v1")


NETWORK_WAIT_S = 900  # so lange auf das Internet warten, bevor ein Abruf als Fehler zählt


class FetchError(RuntimeError):
    pass


def network_ok(host: str = "www.cardmarket.com", timeout: float = 5.0) -> bool:
    """Grobe Prüfung, ob überhaupt Internet da ist (DNS + Verbindung zu Cardmarket)."""
    try:
        with socket.create_connection((host, 443), timeout=timeout):
            return True
    except OSError:
        return False


def wait_for_network(max_wait_s: float = NETWORK_WAIT_S, interval_s: float = 15) -> bool:
    end = time.time() + max_wait_s
    while time.time() < end:
        if network_ok():
            return True
        time.sleep(interval_s)
    return network_ok()


CHALLENGE_WORDS = ("moment", "cloudflare", "challenge", "attention required")
VISIBLE_PORT = 8192


def is_challenge_error(err: Exception) -> bool:
    """Login/Abruf ist an einer Cloudflare-Prüfung gescheitert (nicht z. B. am falschen Passwort)?"""
    text = str(err).lower()
    return any(w in text for w in CHALLENGE_WORDS)


# Cloudflare-Sperre wegen zu vieler Abrufe ("Error 1015 – You are being rate limited"). Keine Prüfung, die man
# lösen könnte: weiteres Anklopfen verlängert sie nur. FlareSolverr meldet sie als "Cloudflare has blocked this request".
RATE_LIMIT_MARKERS = ("error code: 1015", "error 1015", "you are being rate limited")
RATE_LIMIT_ERRORS = ("has blocked this request", "error 1015", "rate limited")


def looks_rate_limited(html: str) -> bool:
    """Seite (oder Antwort auf "Zeige mehr") ist die Cloudflare-Sperrseite 1015?"""
    if not html or "article-row" in html:
        return False
    head = html[:30000].lower()
    return any(m in head for m in RATE_LIMIT_MARKERS)


def is_rate_limit_error(err: Exception) -> bool:
    text = str(err).lower()
    return any(m in text for m in RATE_LIMIT_ERRORS)


def retry_after_outage(fn):
    """Abruf ausführen; scheitert er, weil gerade kein Internet da ist (Laptop wacht auf, WLAN wechselt),
    bis zu 15 Minuten auf die Verbindung warten und einmal neu versuchen. So zählt ein Funkloch nicht
    als Fehlerserie (Notbremse). Ist das Internet da, wird der Fehler unverändert weitergegeben."""
    try:
        return fn()
    except FetchError:
        if network_ok():
            raise
        print("📶 Keine Internetverbindung – warte bis zu 15 Minuten …", flush=True)
        if not wait_for_network():
            raise
        return fn()


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
                max_timeout_ms: int = 120000) -> Page:
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


def _fs_ready(base_url: str) -> bool:
    try:
        return requests.get(base_url + "/", timeout=3).ok
    except requests.RequestException:
        return False


class CardmarketSession:
    def __init__(self, username: str, password: str, game_path: str = "Pokemon",
                 fs: FlareSolverr | None = None):
        if not username or not password:
            raise LoginError("CM_USERNAME oder CM_PASSWORD fehlt (Zugangsdaten prüfen: cm secrets).")
        self.username = username
        self._password = password
        self.game_path = game_path
        self.fs = fs or FlareSolverr()
        self._cookies: list[dict] = []
        self._user_agent = ""
        self._direct = None
        self.logged_in = False
        self.requests = 0
        self.fallbacks = 0  # Abrufe, die FlareSolverr statt des Direktabrufs gebraucht haben
        self.visible = False
        self._visible_proc = None
        # Laptop: Chrome-Fenster nach dem Login schließen; die Abrufe laufen direkt (curl_cffi) mit den Cookies
        self.close_after_login = os.environ.get("FLARESOLVERR_CLOSE_AFTER_LOGIN") == "1"
        self._browser_open = False

    def go_visible(self) -> bool:
        """Auf ein sichtbares Chrome umschalten, wenn das unsichtbare eine Prüfung nicht löst.

        Nur auf dem Laptop (FLARESOLVERR_EXE gesetzt): startet eine zweite FlareSolverr-Instanz mit
        HEADLESS=false. Das Chrome-Fenster bleibt bis zum Ende des Laufs offen. True = umgeschaltet."""
        exe = os.environ.get("FLARESOLVERR_EXE", "")
        if self.visible or not exe or not os.path.exists(exe):
            return False
        url = f"http://127.0.0.1:{VISIBLE_PORT}"
        if not _fs_ready(url):
            env = os.environ | {"HOST": "127.0.0.1", "PORT": str(VISIBLE_PORT), "HEADLESS": "false",
                                "LOG_LEVEL": "warning", "TZ": "Europe/Berlin"}
            flags = 0x08000000 if os.name == "nt" else 0  # Konsole verstecken, Chrome-Fenster bleibt sichtbar
            self._visible_proc = subprocess.Popen([exe], cwd=os.path.dirname(exe), env=env,
                                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                                  creationflags=flags)
            for _ in range(60):
                if _fs_ready(url):
                    break
                time.sleep(2)
            else:
                self._stop_visible()
                return False
        self.fs.stop()
        self.fs = FlareSolverr(url=url + "/v1")
        self.visible = True
        self.logged_in = False
        return True

    def _stop_visible(self) -> None:
        proc, self._visible_proc = self._visible_proc, None
        if proc is None or proc.poll() is not None:
            return
        if os.name == "nt":
            subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True,
                           creationflags=0x08000000)
        else:
            proc.kill()

    # --- Login -------------------------------------------------------------------------------
    def login(self, keep_browser: bool = False) -> None:
        self.fs.start()
        self._browser_open = True
        login_url = f"{BASE_URL}/{LOCALE}/{self.game_path}/Login"
        token = None
        page = None
        for attempt in range(1, 6):
            page = self.fs.request(login_url)
            self._remember(page)
            soup = BeautifulSoup(page.html, "html.parser")
            field_ = soup.select_one("input[name='__cmtkn']")
            if field_ and field_.get("value"):
                token = field_["value"]
                break
            # Prüfseite: der Browser der Sitzung löst sie oft in Sekunden – kurz warten, dann neu laden
            time.sleep(10 if looks_like_challenge(page) else 4 * attempt)
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
        if self.close_after_login and not keep_browser:
            self.fs.stop()
            self._browser_open = False

    def _ensure_browser(self) -> None:
        """Für einen FlareSolverr-Abruf muss die Browser-Sitzung offen und angemeldet sein."""
        if self.close_after_login and not self._browser_open:
            self.login(keep_browser=True)  # bleibt danach bis zum Ende des Laufs offen

    def ensure_login(self) -> None:
        if not self.logged_in:
            self.login()

    # --- Abruf -------------------------------------------------------------------------------
    def get(self, url: str) -> Page:
        """Abruf über FlareSolverr (langsam, aber löst Cloudflare-Prüfungen)."""
        self._ensure_browser()
        self.requests += 1
        self.fallbacks += 1
        page = retry_after_outage(lambda: self.fs.request(url))
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

        def fetch():
            try:
                return self._direct.get(url, cookies=jar, headers=headers, timeout=45, allow_redirects=True)
            except Exception as err:  # curl_cffi wirft eigene Fehlertypen
                raise FetchError(f"Direktabruf fehlgeschlagen: {err}") from err

        resp = retry_after_outage(fetch)
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
        self.fallbacks += 1
        self._ensure_browser()
        page = retry_after_outage(lambda: self.fs.request(
            url, post_data=data, headers={"Content-Type": "application/x-www-form-urlencoded",
                                          "Referer": referer, "Origin": BASE_URL}))
        self._remember(page)
        return page.html

    def close(self) -> None:
        self.fs.stop()
        self._stop_visible()

    def _remember(self, page: Page) -> None:
        if page.cookies:
            self._cookies = page.cookies
        if page.user_agent:
            self._user_agent = page.user_agent
