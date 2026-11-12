"""Chrome über nodriver – Ersatz für FlareSolverr mit derselben Schnittstelle (start/stop/request).

nodriver steuert das installierte Google Chrome direkt (ohne Selenium/Chromedriver). Ablauf je Abruf:
Seite im Chrome-Fenster öffnen, warten bis sie fertig geladen ist und keine Cloudflare-Prüfung mehr zeigt
(Chrome löst sie wie bei einem normalen Besuch selbst), dann HTML, Cookies und User-Agent zurückgeben.
POST-Anfragen (Login, "Zeige mehr") schickt die geöffnete Cardmarket-Seite selbst ab (fetch im Browser),
so wie es die Website auch tut – mit den Cookies des Browsers.

nodriver arbeitet asynchron; der Rest des Scrapers nicht. Deshalb läuft nodriver in einem eigenen
Hintergrund-Thread mit eigener Ereignisschleife, und jede Methode hier wartet einfach auf das Ergebnis.
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import json
import logging
import os
import threading
import time
import urllib.parse

from .cardmarket import BASE_URL
from .fetcher import FetchError, Page

# nodriver protokolliert auf Stufe "debug" alles, was es an Chrome schickt – beim Login also auch das Passwort.
# Nie unter "warning" stellen.
logging.getLogger("nodriver").setLevel(logging.WARNING)

# Titel der Cloudflare-Prüfseite (Chrome zeigt sie in der Sprache des Browsers)
CHALLENGE_TITLES = ("just a moment", "nur einen moment", "einen moment bitte", "attention required",
                    "un instant", "un momento")
CHALLENGE_HTML = ("_cf_chl_opt", "cf-turnstile", "challenge-error-text")


def _is_challenge(title: str, html: str = "") -> bool:
    t = (title or "").strip().lower()
    if any(t.startswith(m) for m in CHALLENGE_TITLES):
        return True
    return bool(html) and "article-row" not in html and any(m in html[:30000] for m in CHALLENGE_HTML)


class NodriverBrowser:
    """Ein Chrome-Fenster, gesteuert über nodriver. Gleiche Methoden wie `fetcher.FlareSolverr`."""

    via = "browser"

    def __init__(self, executable: str | None = None, headless: bool | None = None):
        self.executable = executable or os.environ.get("CHROME_PATH") or None
        # Unsichtbar nur für Tests auf Rechnern ohne Bildschirm – Cloudflare erkennt Headless-Chrome oft.
        self.headless = os.environ.get("CM_BROWSER_HEADLESS") == "1" if headless is None else headless
        self._loop: asyncio.AbstractEventLoop | None = None
        self._thread: threading.Thread | None = None
        self._browser = None
        self._tab = None

    # --- Hintergrund-Thread ----------------------------------------------------------------------
    def _ensure_loop(self) -> asyncio.AbstractEventLoop:
        if self._loop is None or not self._thread or not self._thread.is_alive():
            self._loop = asyncio.new_event_loop()
            self._thread = threading.Thread(target=self._loop.run_forever, name="nodriver", daemon=True)
            self._thread.start()
        return self._loop

    def _run(self, coro, timeout_s: float):
        fut = asyncio.run_coroutine_threadsafe(coro, self._ensure_loop())
        try:
            return fut.result(timeout_s)
        except concurrent.futures.TimeoutError as err:
            fut.cancel()
            raise FetchError(f"Browser meldet: Timeout after {timeout_s:.0f} seconds") from err
        except FetchError:
            raise
        except Exception as err:  # nodriver/websockets werfen eigene Fehlertypen
            if self._lost():
                # Text passt zu fetcher.BROWSER_LOST_ERRORS -> CardmarketSession startet einmal neu
                raise FetchError(f"Browser meldet: chrome not reachable ({type(err).__name__}: {err})") from err
            raise FetchError(f"Browser meldet: {type(err).__name__}: {err}") from err

    def _lost(self) -> bool:
        """Chrome-Fenster geschlossen oder abgestürzt?"""
        b = self._browser
        if b is None:
            return True
        proc = getattr(b, "_process", None)
        if proc is not None and proc.returncode is not None:
            return True
        conn = getattr(b, "connection", None)
        return bool(conn is not None and getattr(conn, "closed", False))

    # --- Start/Stopp -----------------------------------------------------------------------------
    def start(self) -> None:
        """Frisches Chrome (leeres, temporäres Profil – Pauls eigenes Chrome bleibt unberührt)."""
        self.stop()
        self._run(self._start(), 90)

    async def _start(self) -> None:
        import nodriver

        kwargs = {"headless": self.headless, "browser_args": ["--window-size=1280,900"]}
        if self.executable:
            kwargs["browser_executable_path"] = self.executable
        try:
            self._browser = await nodriver.start(**kwargs)
        except FileNotFoundError as err:
            raise FetchError("Browser meldet: Google Chrome nicht gefunden – bitte 'cm update' ausführen") from err
        except Exception as err:
            raise FetchError(f"Browser meldet: Chrome startet nicht ({err})") from err
        self._drain_output()
        self._tab = self._browser.main_tab

    def _drain_output(self) -> None:
        """Chrome-Ausgaben lesen und verwerfen: nodriver fängt sie auf, liest sie aber nie – nach Stunden wäre der
        Puffer voll und Chrome bliebe hängen."""
        proc = getattr(self._browser, "_process", None)
        for stream in (getattr(proc, "stdout", None), getattr(proc, "stderr", None)):
            if stream is not None:
                asyncio.get_running_loop().create_task(self._discard(stream))

    @staticmethod
    async def _discard(stream) -> None:
        try:
            while await stream.read(65536):
                pass
        except Exception:
            pass

    def stop(self) -> None:
        if self._browser is None:
            return
        try:
            self._run(self._stop(), 30)
        except FetchError:
            pass
        self._browser = self._tab = None

    async def _stop(self) -> None:
        b = self._browser
        try:
            b.stop()  # schließt die Verbindung und beendet Chrome
        except Exception:
            pass
        await asyncio.sleep(0.5)

    # --- Abruf -----------------------------------------------------------------------------------
    def request(self, url: str, post_data: dict | None = None, headers: dict | None = None,
                max_timeout_ms: int = 120000) -> Page:
        if self._browser is None:
            raise FetchError("Browser meldet: chrome not reachable (nicht gestartet)")
        timeout_s = max_timeout_ms / 1000
        started = time.monotonic()
        if post_data is None:
            final_url, status, html = self._run(self._get(url, timeout_s), timeout_s + 30)
        else:
            final_url, status, html = self._run(self._post(url, post_data, headers or {}, timeout_s), timeout_s + 30)
        cookies, user_agent = self._run(self._cookies_and_agent(), 30)
        return Page(requested_url=url, final_url=final_url, status=status, html=html, via=self.via,
                    elapsed_s=round(time.monotonic() - started, 2), cookies=cookies, user_agent=user_agent)

    async def _eval(self, expression: str, await_promise: bool = False):
        """JavaScript in der Seite ausführen. Ergebnis immer als JSON-Text: nodriver gibt Listen, false, 0 und ""
        sonst teils als rohes Objekt statt als Wert zurück."""
        wrapped = (f"Promise.resolve({expression}).then(v => JSON.stringify(v === undefined ? null : v))"
                   if await_promise else f"JSON.stringify((() => {{ const v = ({expression}); "
                                         "return v === undefined ? null : v; })())")
        res = await self._tab.evaluate(wrapped, await_promise=await_promise, return_by_value=True)
        if type(res).__name__ == "ExceptionDetails":
            exc = getattr(res, "exception", None)
            detail = (getattr(exc, "description", "") or getattr(res, "text", "")).splitlines()[0][:200]
            raise FetchError(f"Browser meldet: Skriptfehler ({detail})")
        if not isinstance(res, str):
            raise FetchError(f"Browser meldet: unerwartete Antwort ({type(res).__name__})")
        return json.loads(res)

    async def _get(self, url: str, timeout_s: float) -> tuple[str, int, str]:
        """Seite öffnen und warten, bis sie geladen ist und keine Cloudflare-Prüfung mehr zeigt."""
        tab = self._tab
        try:
            await self._eval("window.__cmOld = 1")  # Merker: verschwindet, sobald die neue Seite da ist
        except Exception:
            pass
        await tab.get(url)
        deadline = time.monotonic() + timeout_s
        title, ready = "", False
        while True:
            await asyncio.sleep(0.5)
            try:
                state = await self._eval("[document.readyState, document.title, window.__cmOld === undefined]")
            except Exception:  # Seite wechselt gerade (z. B. Cloudflare leitet nach der Prüfung weiter)
                if self._lost():
                    raise
                state = None
            if state:
                ready_state, title, fresh = state
                ready = fresh and ready_state == "complete"
                if ready and not _is_challenge(title):
                    break
            if time.monotonic() >= deadline:
                break  # Prüfseite (oder halb geladene Seite) zurückgeben – der Scraper entscheidet, was folgt
        await asyncio.sleep(0.3 if ready else 0)
        html = await tab.get_content()
        info = await self._eval("[location.href, (performance.getEntriesByType('navigation')[0] || {}).responseStatus || 0]")
        final_url, status = (info or [url, 0])
        if not status:
            status = 403 if _is_challenge(title, html) else 200
        return str(final_url), int(status), html or ""

    async def _post(self, url: str, data: dict, headers: dict, timeout_s: float) -> tuple[str, int, str]:
        """POST aus der geöffneten Cardmarket-Seite heraus (wie das Formular bzw. die Website selbst)."""
        referer = headers.get("Referer") or f"{BASE_URL}/"
        try:
            origin = await self._eval("location.origin")
        except Exception:
            origin = ""
        if origin != BASE_URL:
            await self._get(referer, timeout_s)
        extra = {k: v for k, v in headers.items() if k.lower() not in ("content-type", "referer", "origin")}
        script = (
            "(async () => {"
            f" const r = await fetch({json.dumps(url)}, {{method: 'POST', credentials: 'include',"
            f" referrer: {json.dumps(referer)}, headers: {json.dumps(extra)},"
            f" body: new URLSearchParams({json.dumps(urllib.parse.urlencode(data))})}});"
            " return [r.url, r.status, await r.text()];"
            "})()"
        )
        res = await asyncio.wait_for(self._eval(script, await_promise=True), timeout_s)
        if not isinstance(res, list) or len(res) != 3:
            raise FetchError("Browser meldet: keine Antwort auf POST")
        return str(res[0]), int(res[1] or 0), str(res[2] or "")

    async def _cookies_and_agent(self) -> tuple[list[dict], str]:
        jar = await self._browser.cookies.get_all()
        host = urllib.parse.urlparse(BASE_URL).hostname or ""
        cookies = [{"name": c.name, "value": c.value, "domain": c.domain, "path": c.path}
                   for c in jar if c.domain and host.endswith(c.domain.lstrip("."))]  # nur Cardmarket-Cookies
        agent = await self._eval("navigator.userAgent")
        return cookies, str(agent or "")
