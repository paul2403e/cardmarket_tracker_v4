"""CM-Tracker auf dem Windows-Laptop: täglicher Lauf, Zugangsdaten, Updates und der Befehl "cm".

Nur Python-Standardbibliothek. Der Zeitplan startet diese Datei unsichtbar mit pythonw.exe ("run"),
von Hand läuft sie über cm.cmd (z. B. "cm test").

Ablage unter %LOCALAPPDATA%\\cmtracker:
  venv\\             Python-Umgebung des Scrapers
  code\\<commit>\\    Code-Stand von GitHub (current.txt nennt den aktiven)
  flaresolverr\\     FlareSolverr (Windows-Version, bringt eigenes Chrome mit)
  runner\\cmwin.py   diese Datei (wird nach Code-Updates erneuert)
  secrets.json      Zugangsdaten, verschlüsselt mit dem Windows-Konto (DPAPI) – nur dein Benutzer kann sie lesen
  state\\ logs\\ out\\  Tages-Marker, Protokolle, Lauf-Ordner
Prüf-Excel: Dokumente\\CM-Tracker\\Review

Täglicher Ablauf ("run"):
  03:30 Uhr weckt Windows den Laptop (auch auf Akku). Zusätzlich startet der Lauf beim Anmelden, Entsperren und
  Aufwachen – ist der Tag schon fertig, endet er nach Sekunden. Vor 03:30 Uhr passiert nichts.
  1. Internet abwarten, Code von GitHub aktualisieren
  2. Einmalige Mail, falls frühere Tage unvollständig geblieben sind
  3. Katalog & Price Guide (einmal pro Tag)
  4. Scrape bis der Tag fertig ist (spätestens 23:55 Uhr), Laptop bleibt dabei wach
  5. Katalog ein zweites Mal (falls der Price Guide um 03:30 Uhr noch nicht neu war)
  6. Faire Preise berechnen (config/pricing.yaml; geänderte Logik -> alle Tage neu)
  7. Dateien für die Website erzeugen (public/<spiel>/…)
"""

from __future__ import annotations

import argparse
import base64
import ctypes
import getpass
import hashlib
import io
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
import zipfile
from datetime import date, datetime, timedelta
from pathlib import Path
from xml.sax.saxutils import escape

REPO = "paul2403e/cardmarket_tracker_v4"
BRANCH = "main"
TASK_NAME = "CM-Tracker"
START_TIME = (3, 30)        # täglicher Termin
STOP_AT = "23:55"           # ein Lauf hört spätestens hier auf (Tageswechsel)
KEEP_DAYS = 14              # Protokolle, Lauf-Ordner, Prüf-Excel
MISSED_DAYS_MAX = 14        # so weit zurück werden unvollständige Tage gemeldet
FS_URL = "http://127.0.0.1:8191"
EXIT_EMERGENCY = 4          # Notbremse im Scraper -> heute keine automatischen Neustarts mehr
PG_RETRY_HOURS = 2          # Price Guide von heute noch nicht da: höchstens alle 2 Std. erneut nachsehen
FS_ZIP_URL = "https://github.com/FlareSolverr/FlareSolverr/releases/latest/download/flaresolverr_windows_x64.zip"

HOME = Path(os.environ.get("CMTRACKER_HOME") or Path(os.environ.get("LOCALAPPDATA", Path.home())) / "cmtracker")
VENV = HOME / "venv"
CODE = HOME / "code"
STATE = HOME / "state"
LOGS = HOME / "logs"
OUT = HOME / "out"
FS_DIR = HOME / "flaresolverr"
RUNNER = HOME / "runner" / "cmwin.py"
SECRETS = HOME / "secrets.json"

SECRET_FIELDS = [  # Name, Frage, verdeckt, Standardwert
    ("CM_USERNAME", "Cardmarket Benutzername", False, None),
    ("CM_PASSWORD", "Cardmarket Passwort", True, None),
    ("R2_ACCOUNT_ID", "Cloudflare R2 Account ID (32 Zeichen)", False, None),
    ("R2_ACCESS_KEY_ID", "R2 Access Key ID (32 Zeichen)", True, None),
    ("R2_SECRET_ACCESS_KEY", "R2 Secret Access Key (64 Zeichen)", True, None),
    ("R2_BUCKET", "R2 Bucket-Name", False, "cm-market-data"),
    ("SMTP_USER", "Gmail-Adresse für Warn-Mails", False, None),
    ("SMTP_PASS", "Gmail App-Passwort (16 Zeichen)", True, None),
    ("ALERT_EMAIL_TO", "Empfänger der Warn-Mails", False, "SMTP_USER"),
    ("HC_PING_URL", "healthchecks.io Ping-URL", False, None),
]

IS_WINDOWS = os.name == "nt"
CREATE_NO_WINDOW = 0x08000000
_log_file = None
_RUNNER_UPDATED = False      # update_code hat ein neues Steuerskript abgelegt


# --- Ausgabe & Protokoll ----------------------------------------------------------------------
def has_console() -> bool:
    return sys.stdout is not None and not sys.executable.lower().endswith("pythonw.exe")


def log(msg: str) -> None:
    line = f"{datetime.now():%Y-%m-%d %H:%M:%S}  {msg}"
    if _log_file:
        _log_file.write(line + "\n")
        _log_file.flush()
    if has_console():
        print(msg, flush=True)


def open_log() -> Path:
    global _log_file
    LOGS.mkdir(parents=True, exist_ok=True)
    path = LOGS / f"{date.today().isoformat()}.log"
    _log_file = open(path, "a", encoding="utf-8")
    return path


def tail(path: Path, n: int) -> str:
    try:
        return "\n".join(path.read_text(encoding="utf-8", errors="replace").splitlines()[-n:])
    except OSError:
        return ""


# --- Windows-Hilfen ---------------------------------------------------------------------------
class _Blob(ctypes.Structure):
    _fields_ = [("cbData", ctypes.c_uint32), ("pbData", ctypes.POINTER(ctypes.c_char))]


def _dpapi(data: bytes, protect: bool) -> bytes:
    """Ver-/Entschlüsseln mit dem Windows-Benutzerkonto (DPAPI): nur derselbe Benutzer kann lesen."""
    buf = ctypes.create_string_buffer(data, len(data))
    inp = _Blob(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char)))
    out = _Blob()
    crypt32, kernel32 = ctypes.windll.crypt32, ctypes.windll.kernel32
    fn = crypt32.CryptProtectData if protect else crypt32.CryptUnprotectData
    desc = ctypes.c_wchar_p("cmtracker") if protect else None
    if not fn(ctypes.byref(inp), desc, None, None, None, 0x1, ctypes.byref(out)):  # 0x1 = keine Rückfragen
        raise ctypes.WinError()
    try:
        return ctypes.string_at(out.pbData, out.cbData)
    finally:
        kernel32.LocalFree(ctypes.cast(out.pbData, ctypes.c_void_p))


def keep_awake(on: bool) -> None:
    """Während des Laufs nicht in den Energiesparmodus wechseln (Bildschirm darf aus sein)."""
    if IS_WINDOWS:
        ES_CONTINUOUS, ES_SYSTEM_REQUIRED = 0x80000000, 0x00000001
        ctypes.windll.kernel32.SetThreadExecutionState(ES_CONTINUOUS | (ES_SYSTEM_REQUIRED if on else 0))


def documents_dir() -> Path:
    if IS_WINDOWS:
        buf = ctypes.create_unicode_buffer(260)
        if ctypes.windll.shell32.SHGetFolderPathW(None, 5, None, 0, buf) == 0:  # 5 = "Eigene Dokumente"
            return Path(buf.value)
    return Path.home() / "Documents"


def review_dir() -> Path:
    return documents_dir() / "CM-Tracker" / "Review"


def no_window() -> int:
    return CREATE_NO_WINDOW if (IS_WINDOWS and not has_console()) else 0


def kill_tree(pid: int) -> None:
    if IS_WINDOWS:
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True,
                       creationflags=CREATE_NO_WINDOW)
    else:
        try:
            os.kill(pid, 9)
        except OSError:
            pass


class RunLock:
    """Verhindert, dass zwei Läufe gleichzeitig arbeiten (z. B. Zeitplan und "cm test")."""

    def __init__(self) -> None:
        STATE.mkdir(parents=True, exist_ok=True)
        self.fh = open(STATE / "run.lock", "a+")

    def acquire(self, write_pid: bool = True) -> bool:
        try:
            if IS_WINDOWS:
                import msvcrt
                self.fh.seek(0)
                msvcrt.locking(self.fh.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            if write_pid:
                (STATE / "run.pid").write_text(str(os.getpid()))
            return True
        except OSError:
            return False


# --- Zugangsdaten -----------------------------------------------------------------------------
def load_secrets() -> dict[str, str]:
    if not SECRETS.exists():
        return {}
    raw = json.loads(SECRETS.read_text(encoding="utf-8"))
    return {k: _dpapi(base64.b64decode(v), protect=False).decode("utf-8") for k, v in raw.items()}


def save_secrets(values: dict[str, str]) -> None:
    data = {k: base64.b64encode(_dpapi(v.encode("utf-8"), protect=True)).decode() for k, v in values.items()}
    SECRETS.parent.mkdir(parents=True, exist_ok=True)
    tmp = SECRETS.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=1), encoding="utf-8")
    tmp.replace(SECRETS)


def ask_secrets() -> None:
    old = load_secrets()
    new: dict[str, str] = {}
    print("Zugangsdaten eingeben (werden nur auf diesem Laptop gespeichert, verschlüsselt mit deinem Windows-Konto).")
    print("Bei Passwörtern und Schlüsseln erscheint beim Tippen/Einfügen nichts – das ist Absicht.\n")
    for name, question, hidden, default in SECRET_FIELDS:
        default = new.get(default, default) if default == "SMTP_USER" else default
        hint = " [Enter = behalten]" if old.get(name) else (f" [Enter = {default}]" if default else "")
        val = (getpass.getpass if hidden else input)(f"{question}{hint}: ").strip()
        new[name] = val or old.get(name) or default or ""
    new["SMTP_PASS"] = new["SMTP_PASS"].replace(" ", "")  # Google zeigt das App-Passwort mit Leerzeichen
    save_secrets(new)
    print(f"\nGespeichert in {SECRETS}")


# --- Code & Pakete ----------------------------------------------------------------------------
def http_get(url: str, timeout: int = 60, accept: str | None = None) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "cmtracker-laptop", **({"Accept": accept} if accept else {})})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def venv_python(windowless: bool = False) -> Path:
    if IS_WINDOWS:
        return VENV / "Scripts" / ("pythonw.exe" if windowless else "python.exe")
    return VENV / "bin" / "python"


def current_code() -> Path | None:
    try:
        sha = (CODE / "current.txt").read_text().strip()
    except OSError:
        return None
    path = CODE / sha
    return path if (path / "scraper").is_dir() else None


def update_code(force: bool = False) -> Path | None:
    """Neuesten Stand von GitHub holen (ohne git: Commit-Kennung prüfen, ZIP laden). Fehler -> alter Stand."""
    global _RUNNER_UPDATED
    cur = current_code()
    try:
        sha = http_get(f"https://api.github.com/repos/{REPO}/commits/{BRANCH}", 30,
                       "application/vnd.github.sha").decode().strip()
        if force or cur is None or cur.name != sha:
            log(f"Code-Update auf {sha[:7]} …")
            data = http_get(f"https://codeload.github.com/{REPO}/zip/{sha}", 120)
            tmp = CODE / f"{sha}.tmp"
            shutil.rmtree(tmp, ignore_errors=True)
            with zipfile.ZipFile(io.BytesIO(data)) as zf:
                zf.extractall(tmp)
            inner = next(p for p in tmp.iterdir() if p.is_dir())
            target = CODE / sha
            shutil.rmtree(target, ignore_errors=True)
            inner.rename(target)
            shutil.rmtree(tmp, ignore_errors=True)
            (CODE / "current.txt").write_text(sha)
            for old in CODE.iterdir():
                if old.is_dir() and old.name != sha:
                    shutil.rmtree(old, ignore_errors=True)
            cur = target
    except Exception as err:  # GitHub nicht erreichbar o. Ä.
        log(f"WARNUNG: Code-Update fehlgeschlagen ({err}) – nutze vorhandenen Stand")
    if cur is None:
        return None
    install_requirements(cur)
    src = cur / "windows" / "cmwin.py"
    if src.exists() and (not RUNNER.exists() or src.read_bytes() != RUNNER.read_bytes()):
        RUNNER.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, RUNNER)
        _RUNNER_UPDATED = True
        log("Steuerskript aktualisiert")
    return cur


def install_requirements(code: Path) -> None:
    req = code / "scraper" / "requirements.txt"
    digest = hashlib.sha256(req.read_bytes()).hexdigest()
    marker = STATE / "requirements.sha"
    if marker.exists() and marker.read_text().strip() == digest:
        return
    log("Python-Pakete installieren (kann einige Minuten dauern) …")
    res = subprocess.run([str(venv_python()), "-m", "pip", "install", "-q", "--disable-pip-version-check",
                          "-r", str(req)], capture_output=True, text=True, creationflags=no_window())
    if res.returncode == 0:
        STATE.mkdir(parents=True, exist_ok=True)
        marker.write_text(digest)
    else:
        log("WARNUNG: Paket-Installation fehlgeschlagen:\n" + (res.stderr or res.stdout)[-2000:])


def install_flaresolverr(force: bool = False) -> None:
    exe = FS_DIR / "flaresolverr" / "flaresolverr.exe"
    if exe.exists() and not force:
        return
    print("FlareSolverr herunterladen (ca. 200 MB, bringt ein eigenes Chrome mit) …", flush=True)
    data = http_get(FS_ZIP_URL, 600)
    shutil.rmtree(FS_DIR, ignore_errors=True)
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        zf.extractall(FS_DIR)
    if not exe.exists():
        raise RuntimeError(f"flaresolverr.exe nicht gefunden in {FS_DIR}")


# --- FlareSolverr starten/stoppen -------------------------------------------------------------
def fs_ready() -> bool:
    try:
        with urllib.request.urlopen(FS_URL + "/", timeout=3):
            return True
    except Exception:
        return False


def start_flaresolverr() -> subprocess.Popen | None:
    if fs_ready():
        return None
    exe = FS_DIR / "flaresolverr" / "flaresolverr.exe"
    if not exe.exists():
        raise RuntimeError("FlareSolverr fehlt – bitte 'cm update' ausführen.")
    # HOST=127.0.0.1: nur lokal erreichbar (keine Firewall-Rückfrage von Windows)
    # LOG_LEVEL=warning: auf Stufe "info" schreibt FlareSolverr jede Anfrage samt Inhalt ins Protokoll –
    # beim Login also Benutzername und Passwort. Das Protokoll wird bei jedem Start neu angelegt.
    # HEADLESS=false: Unter Windows ist FlareSolverrs "headless" echtes Headless-Chrome, das Cloudflare
    # erkennt (unter Linux läuft dagegen ein normales Chrome auf einem unsichtbaren Bildschirm). Deshalb ein
    # normales Chrome-Fenster; der Scraper schließt es nach dem Login wieder (FLARESOLVERR_CLOSE_AFTER_LOGIN).
    # LANG=en-US: FlareSolverr erkennt Cloudflare-Prüfungen nur am englischen Titel "Just a moment...".
    # Mit deutschem Windows zeigt Chrome "Nur einen Moment…" – FlareSolverr hält die Prüfung dann für
    # erledigt und liefert sofort die Prüfseite zurück, statt auf die Freigabe zu warten.
    env = os.environ | {"HOST": "127.0.0.1", "PORT": "8191", "HEADLESS": "false", "LOG_LEVEL": "warning",
                        "TZ": "Europe/Berlin", "LANG": "en-US"}
    out = open(LOGS / "flaresolverr.log", "w", encoding="utf-8", errors="replace")
    proc = subprocess.Popen([str(exe)], cwd=str(exe.parent), env=env, stdout=out, stderr=subprocess.STDOUT,
                            creationflags=CREATE_NO_WINDOW if IS_WINDOWS else 0)
    for _ in range(90):
        if fs_ready():
            log("FlareSolverr bereit")
            return proc
        if proc.poll() is not None:
            break
        time.sleep(2)
    kill_tree(proc.pid)
    raise RuntimeError("FlareSolverr startet nicht – Details: " + str(LOGS / "flaresolverr.log"))


def stop_flaresolverr(proc: subprocess.Popen | None) -> None:
    if proc is not None and proc.poll() is None:
        kill_tree(proc.pid)
    if IS_WINDOWS:  # auch eine evtl. noch offene sichtbare Instanz (zweiter Versuch) beenden
        subprocess.run(["taskkill", "/IM", "flaresolverr.exe", "/T", "/F"], capture_output=True,
                       creationflags=CREATE_NO_WINDOW)


# --- Scraper aufrufen -------------------------------------------------------------------------
def scraper_env(secrets: dict[str, str]) -> dict[str, str]:
    return os.environ | secrets | {
        "FLARESOLVERR_URL": FS_URL + "/v1",
        "FLARESOLVERR_CLOSE_AFTER_LOGIN": "1",  # Chrome-Fenster nach dem Login schließen (Abrufe laufen direkt)
        "ALERT_DEDUP_DIR": str(STATE),  # dieselbe Warn-Mail höchstens einmal pro Tag
        "PYTHONUTF8": "1",
        "PYTHONIOENCODING": "utf-8",
        "RUN_INFO": "Laptop-Lauf – Protokoll: PowerShell öffnen und 'cm logs' eingeben.",
    }


def cmtracker(code: Path, env: dict, *args: str, echo: bool = False) -> tuple[int, str]:
    """python -m cmtracker … im Code-Ordner; Ausgabe ins Protokoll (und bei echo auch auf den Bildschirm)."""
    cmd = [str(venv_python()), "-m", "cmtracker", *args]
    proc = subprocess.Popen(cmd, cwd=str(code / "scraper"), env=env, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace",
                            creationflags=no_window())
    (STATE / "child.pid").write_text(str(proc.pid))
    lines = []
    for line in proc.stdout:
        line = line.rstrip("\n")
        lines.append(line)
        if _log_file:
            _log_file.write(line + "\n")
            _log_file.flush()
        if echo and has_console():
            print(line, flush=True)
    return proc.wait(), "\n".join(lines[-200:])


def day_status(code: Path, env: dict, day: str | None = None) -> dict | None:
    args = ["day-status"] + (["--day", day] if day else [])
    res = subprocess.run([str(venv_python()), "-m", "cmtracker", *args], cwd=str(code / "scraper"), env=env,
                         capture_output=True, text=True, encoding="utf-8", errors="replace",
                         creationflags=no_window())
    try:
        data = json.loads(res.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        log("WARNUNG: Tagesstatus nicht lesbar: " + (res.stderr or res.stdout)[-500:])
        return None
    return None if "error" in data else data


def send_mail(code: Path, env: dict, subject: str, body: str, marker_dir: Path | None = None) -> None:
    cmd = [str(venv_python()), str(code / "scraper" / "cmtracker" / "alerts.py"), "--subject", subject, "--body", body]
    if marker_dir:
        cmd += ["--skip-if-sent", str(marker_dir)]
    subprocess.run(cmd, env=env, capture_output=True, creationflags=no_window())


def wait_for_internet(max_wait_s: int = 180) -> bool:
    end = time.time() + max_wait_s
    while True:
        try:
            with socket.create_connection(("www.cardmarket.com", 443), timeout=5):
                return True
        except OSError:
            if time.time() >= end:
                return False
            time.sleep(10)


def report_missed_days(code: Path, env: dict, today: date) -> None:
    """Einmalige Mail für Tage, die nicht vollständig gescrapt wurden (z. B. Laptop war aus)."""
    marker = STATE / "checked_until.txt"
    yesterday = today - timedelta(days=1)
    try:
        last = date.fromisoformat(marker.read_text().strip())
    except (OSError, ValueError):
        marker.write_text(yesterday.isoformat())  # erster Lauf: nichts rückwirkend melden
        return
    days = [last + timedelta(days=i) for i in range(1, (yesterday - last).days + 1)][-MISSED_DAYS_MAX:]
    problems = []
    for d in days:
        st = day_status(code, env, d.isoformat())
        if st is None:
            return  # R2 nicht erreichbar – beim nächsten Lauf erneut prüfen
        for game, info in st.items():
            if not info["complete"]:
                how = f"teilweise ({info['progress']})" if info.get("progress") else "gar nicht (Laptop war aus?)"
                problems.append(f"- {d:%d.%m.%Y} {game}: {how}")
    if problems:
        send_mail(code, env, "Tage nicht vollständig gescrapt",
                  "Diese Tage sind nicht vollständig gescrapt worden:\n\n" + "\n".join(problems) +
                  "\n\nDer Laptop muss dafür ca. 4 Stunden am Tag laufen (oder um 03:30 Uhr geweckt werden können).")
        log(f"Mail: {len(problems)} unvollständige Tage gemeldet")
    marker.write_text(yesterday.isoformat())


def cleanup() -> None:
    cutoff = time.time() - KEEP_DAYS * 86400
    for folder in (LOGS, OUT, review_dir(), STATE):
        if not folder.exists():
            continue
        for p in folder.iterdir():
            try:
                if p.stat().st_mtime < cutoff and (p.is_dir() or p.suffix in (".log", ".xlsx", ".done", ".ok", ".sent")):
                    shutil.rmtree(p) if p.is_dir() else p.unlink()
            except OSError:
                pass


def collect_review(out: Path) -> None:
    files = list(out.glob("*.xlsx"))
    if files:
        target = review_dir()
        target.mkdir(parents=True, exist_ok=True)
        for f in files:
            shutil.copy2(f, target / f.name)
        log(f"Prüf-Excel: {target}")


# --- Befehle ----------------------------------------------------------------------------------
def _recent(path: Path, hours: float) -> bool:
    try:
        return time.time() - path.stat().st_mtime < hours * 3600
    except OSError:
        return False


def due(now: datetime) -> bool:
    return (now.hour, now.minute) >= START_TIME


def cmd_run(args: argparse.Namespace) -> int:
    """Täglicher Lauf (Zeitplan, unsichtbar). Mit --now auch vor 03:30 Uhr und trotz Notbremse."""
    now = datetime.now()
    today = now.date()
    day = today.isoformat()
    done_marker = STATE / f"{day}.done"
    blocked_marker = STATE / f"{day}.blocked.ok"
    pg_marker = STATE / f"{day}.pg.ok"          # Price Guide dieses Tages gespeichert
    pg_try = STATE / f"{day}.pgtry.ok"          # letzter Versuch (Cardmarket veröffentlicht nicht jeden Tag)
    scrape_marker = STATE / f"{day}.scrape.ok"  # Scrape des Tages vollständig
    if done_marker.exists() or not (args.now or due(now)):
        if args.now:
            print("Heute ist schon alles erledigt ✅" if done_marker.exists() else "")
        return 0
    if blocked_marker.exists() and not args.now and (pg_marker.exists() or _recent(pg_try, PG_RETRY_HOURS)):
        return 0  # nach einer Notbremse erst morgen um 03:30 wieder (von Hand: cm run --now)
    if scrape_marker.exists() and not args.now and _recent(pg_try, PG_RETRY_HOURS):
        return 0  # nur noch der Price Guide fehlt – höchstens alle paar Stunden nachsehen
    lock = RunLock()
    if not lock.acquire():
        return 0
    open_log()
    log(f"=== Lauf gestartet ({'von Hand' if args.now else 'Zeitplan'}) ===")
    keep_awake(True)
    fs = None
    rc = 0
    try:
        if not wait_for_internet():
            log("Kein Internet – der nächste Start (Aufwachen/Entsperren/Anmelden) versucht es erneut")
            return 0
        code = update_code()
        if code is None:
            log("FEHLER: Kein Code vorhanden – 'cm update' ausführen")
            return 1
        if _RUNNER_UPDATED and not os.environ.get("CMTRACKER_REEXEC"):
            # neues Steuerskript sofort verwenden (nicht erst beim nächsten Lauf)
            log("Starte mit dem neuen Steuerskript neu …")
            lock.fh.close()
            keep_awake(False)
            res = subprocess.run([sys.executable, str(RUNNER), *sys.argv[1:]],
                                 env=os.environ | {"CMTRACKER_REEXEC": "1"}, creationflags=no_window())
            return res.returncode
        secrets = load_secrets()
        if not secrets:
            log("FEHLER: Keine Zugangsdaten – 'cm secrets' ausführen")
            return 1
        env = scraper_env(secrets)
        out = OUT / now.strftime("%Y%m%d-%H%M%S")
        out.mkdir(parents=True, exist_ok=True)

        report_missed_days(code, env, today)

        def catalog(publish: bool) -> None:
            """Katalog & Price Guide; erst wenn der Price Guide von heute gespeichert ist, gilt er als erledigt.
            Cardmarket veröffentlicht ihn nicht jeden Tag (z. B. sonntags) – die Preise hängen nicht davon ab."""
            nonlocal rc
            if pg_try.exists() and _recent(pg_try, PG_RETRY_HOURS) and (STATE / f"{day}.catalog.ok").exists():
                return
            pg_try.touch()
            c_rc, text = cmtracker(code, env, "catalog", "--out", str(out), *(["--publish-review"] if publish else []))
            if c_rc == 0:
                (STATE / f"{day}.catalog.ok").touch()
            if c_rc != 0:
                rc = 1
            elif f"Datentag {day}" in text:
                pg_marker.touch()
            else:
                log("Price Guide von heute noch nicht veröffentlicht – wird beim nächsten Start erneut geholt")

        if not pg_marker.exists():
            catalog(publish=True)

        st = day_status(code, env)
        # neu hinzugefügtes Spiel: Katalog fehlt noch (der Price Guide von heute ist evtl. schon da)
        for game in [g for g, v in (st or {}).items() if not v.get("catalog", True)]:
            c_rc, _ = cmtracker(code, env, "catalog", "--game", game, "--out", str(out), "--publish-review")
            rc = rc or (1 if c_rc else 0)
        complete = bool(st) and all(v["complete"] for v in st.values())
        if not complete and (args.now or not blocked_marker.exists()):
            fs = start_flaresolverr()
            s_rc, _ = cmtracker(code, env, "scrape", "--max-minutes", "1200", "--stop-at", STOP_AT,
                                "--out", str(out), "--publish-review")
            stop_flaresolverr(fs)
            fs = None
            if s_rc == EXIT_EMERGENCY:
                blocked_marker.touch()
                log("Notbremse – heute keine automatischen Neustarts mehr (von Hand: cm run --now)")
            rc = rc or s_rc
            st = day_status(code, env)
            complete = bool(st) and all(v["complete"] for v in st.values())
        if complete:
            scrape_marker.touch()
            blocked_marker.unlink(missing_ok=True)

        # Preise und Website je Spiel, sobald dessen Scrape fertig ist – ein unfertiges Spiel hält die
        # anderen nicht auf. Beides hängt nur am Scrape, nicht am Price Guide von heute.
        for game in [g for g, v in (st or {}).items() if v["complete"]]:
            price_marker = STATE / f"{day}.price.{game}.ok"
            if not price_marker.exists():
                # faire Preise (bei geänderter Logik: alle Tage neu) + Prüf-Excel
                p_rc, _ = cmtracker(code, env, "price", "--game", game, "--out", str(out), "--publish-review")
                if p_rc == 0:
                    price_marker.touch()
                else:
                    rc = rc or 1
            publish_marker = STATE / f"{day}.publish.{game}.ok"
            if price_marker.exists() and not publish_marker.exists():
                u_rc, _ = cmtracker(code, env, "publish", "--game", game)  # Dateien für die Website
                if u_rc == 0:
                    publish_marker.touch()
                else:
                    rc = rc or 1
        published = complete and all((STATE / f"{day}.publish.{g}.ok").exists() for g in st)

        if not pg_marker.exists():  # z. B. um 03:30 war der Price Guide noch vom Vortag
            catalog(publish=False)

        if published and pg_marker.exists():
            done_marker.touch()
            log("Tag vollständig ✅")
        elif published:
            log("Scrape, Preise und Website fertig ✅ – nur der Price Guide von heute fehlt noch "
                f"(nächster Versuch frühestens in {PG_RETRY_HOURS} Std.)")
        collect_review(out)

        if rc != 0:
            send_mail(code, env, "Laptop-Lauf mit Fehler beendet",
                      "Der Lauf auf dem Laptop ist mit einem Fehler beendet worden.\n\nLetzte Zeilen des Protokolls:\n"
                      + tail(LOGS / f"{day}.log", 40), marker_dir=out)
        return rc
    except Exception as err:  # unerwarteter Fehler im Steuerskript selbst
        log(f"FEHLER: {err!r}")
        try:
            code = current_code()
            if code:
                send_mail(code, scraper_env(load_secrets()), "Laptop-Lauf abgestürzt", f"{err!r}\n\n"
                          + tail(LOGS / f"{day}.log", 40))
        except Exception as mail_err:
            log(f"Warn-Mail nicht möglich: {mail_err!r}")
        return 1
    finally:
        stop_flaresolverr(fs)
        keep_awake(False)
        cleanup()
        log("=== Lauf beendet ===")


def cmd_test(args: argparse.Namespace) -> int:
    lock = RunLock()
    if not lock.acquire():
        print("Der tägliche Lauf arbeitet gerade – bitte später erneut versuchen (Stand: cm status).")
        return 1
    open_log()
    code = current_code() or update_code()
    secrets = load_secrets()
    if not code or not secrets:
        print("Code oder Zugangsdaten fehlen – bitte das Einrichtungs-Skript erneut ausführen.")
        return 1
    env = scraper_env(secrets)
    out = OUT / ("test-" + datetime.now().strftime("%Y%m%d-%H%M%S"))
    out.mkdir(parents=True, exist_ok=True)
    keep_awake(True)
    fs = None
    try:
        fs = start_flaresolverr()
        rc, _ = cmtracker(code, env, "scrape", "--limit", str(args.n), "--max-minutes", "60", "--out", str(out),
                          "--publish-review", echo=True)
        collect_review(out)
        return rc
    finally:
        stop_flaresolverr(fs)
        keep_awake(False)


def cmd_selftest(args: argparse.Namespace) -> int:
    code = current_code()
    secrets = load_secrets()
    if not code or not secrets:
        print("Code oder Zugangsdaten fehlen.")
        return 1
    open_log()
    fs = None
    try:
        fs = start_flaresolverr()
        rc, _ = cmtracker(code, scraper_env(secrets), "selftest", echo=True)
        return rc
    finally:
        stop_flaresolverr(fs)


def cmd_tool(args: argparse.Namespace) -> int:
    """Wartungsbefehle des Scrapers direkt ausführen, z. B. "cm tool categories --game-id 18"."""
    if not args.rest:
        print("Beispiele:\n  cm tool categories --game-id 18\n  cm tool cleanup --before 2026-11-08\n"
              "  cm tool cleanup --before 2026-11-08 --yes")
        return 0
    lock = RunLock()
    if not lock.acquire(write_pid=False):
        print("Der tägliche Lauf arbeitet gerade – bitte später erneut versuchen (Stand: cm status).")
        return 1
    open_log()
    code = update_code() or current_code()
    secrets = load_secrets()
    if not code or not secrets:
        print("Code oder Zugangsdaten fehlen – bitte das Einrichtungs-Skript erneut ausführen.")
        return 1
    rc, _ = cmtracker(code, scraper_env(secrets), *args.rest, echo=True)
    return rc


def cmd_status(args: argparse.Namespace) -> int:
    today = date.today().isoformat()
    print(f"Heute ({today}):")
    print("  Scrape:     ", "fertig ✅" if (STATE / f"{today}.scrape.ok").exists() else
          "Notbremse – Pause bis morgen 03:30" if (STATE / f"{today}.blocked.ok").exists() else "noch nicht fertig")
    for label, step in (("Preise:     ", "price"), ("Website:    ", "publish")):
        games = sorted(p.name[len(f"{today}.{step}."):-3] for p in STATE.glob(f"{today}.{step}.*.ok"))
        print(f"  {label}", ", ".join(f"{g} ✅" for g in games) if games else "offen")
    print("  Price Guide:", "von heute ✅" if (STATE / f"{today}.pg.ok").exists() else
          "Cardmarket hat heute noch keinen neuen veröffentlicht")
    lock = RunLock()
    print("  Lauf:       ", "läuft gerade" if not lock.acquire(write_pid=False) else "kein Lauf aktiv")
    if IS_WINDOWS:
        res = subprocess.run(["schtasks", "/Query", "/TN", TASK_NAME, "/FO", "LIST"], capture_output=True, text=True)
        block = (res.stdout.strip() or res.stderr.strip()).split("\n\n")[0]  # ein Block pro Auslöser – einer reicht
        print("\nZeitplan:\n" + block)
    logs = sorted(LOGS.glob("20*.log"))
    if logs:
        print(f"\nLetzte Protokollzeilen ({logs[-1].name}):\n" + tail(logs[-1], 15))
    return 0


def cmd_logs(args: argparse.Namespace) -> int:
    logs = sorted(LOGS.glob("20*.log"))
    if not logs:
        print("Noch kein Protokoll vorhanden.")
        return 0
    print(tail(logs[-1], args.n))
    print(f"\n(Datei: {logs[-1]})")
    return 0


def cmd_stop(args: argparse.Namespace) -> int:
    for name in ("child.pid", "run.pid"):
        try:
            kill_tree(int((STATE / name).read_text().strip()))
        except (OSError, ValueError):
            pass
    print("Gestoppt. Der nächste Start macht dort weiter.")
    return 0


def cmd_update(args: argparse.Namespace) -> int:
    open_log()
    code = update_code(force=True)
    install_flaresolverr(force=args.flaresolverr)
    print("Aktueller Stand:", code.name[:7] if code else "-")
    return 0 if code else 1


def cmd_secrets(args: argparse.Namespace) -> int:
    ask_secrets()
    return 0


def task_xml(user: str, pythonw: Path, runner: Path, workdir: Path) -> str:
    """Aufgabenplanung: täglich 03:30 (weckt den Laptop), dazu Anmelden, Entsperren und Aufwachen."""
    resume = ("<QueryList><Query Id=\"0\" Path=\"System\"><Select Path=\"System\">*[System[Provider"
              "[@Name='Microsoft-Windows-Power-Troubleshooter'] and EventID=1]]</Select></Query></QueryList>")
    u = escape(user)
    return f"""<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>CM-Tracker: täglicher Scrape um 03:30 Uhr; holt verpasste Läufe beim Anmelden, Entsperren und Aufwachen nach.</Description>
  </RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>2026-01-01T{START_TIME[0]:02d}:{START_TIME[1]:02d}:00</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>
    </CalendarTrigger>
    <LogonTrigger><Enabled>true</Enabled><UserId>{u}</UserId><Delay>PT2M</Delay></LogonTrigger>
    <SessionStateChangeTrigger><Enabled>true</Enabled><StateChange>SessionUnlock</StateChange><UserId>{u}</UserId><Delay>PT1M</Delay></SessionStateChangeTrigger>
    <EventTrigger><Enabled>true</Enabled><Subscription>{escape(resume)}</Subscription><Delay>PT1M</Delay></EventTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author"><UserId>{u}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings><StopOnIdleEnd>false</StopOnIdleEnd><RestartOnIdle>false</RestartOnIdle></IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>true</WakeToRun>
    <ExecutionTimeLimit>PT22H</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>{escape(str(pythonw))}</Command>
      <Arguments>"{escape(str(runner))}" run</Arguments>
      <WorkingDirectory>{escape(str(workdir))}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"""


def install_task() -> None:
    user = f"{os.environ.get('USERDOMAIN', '')}\\{os.environ.get('USERNAME', '')}".lstrip("\\")
    xml = task_xml(user, venv_python(windowless=True), RUNNER, HOME)
    path = STATE / "task.xml"
    path.write_text(xml, encoding="utf-16")
    res = subprocess.run(["schtasks", "/Create", "/TN", TASK_NAME, "/XML", str(path), "/F"],
                         capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError("Zeitplan konnte nicht angelegt werden: " + (res.stderr or res.stdout).strip())
    print("Zeitplan 'CM-Tracker' angelegt: täglich 03:30 Uhr (weckt den Laptop) + Nachholen beim "
          "Anmelden/Entsperren/Aufwachen.")


def write_cm_cmd() -> Path:
    bindir = HOME / "bin"
    bindir.mkdir(parents=True, exist_ok=True)
    (bindir / "cm.cmd").write_text(
        "@echo off\r\nchcp 65001 >nul\r\nset PYTHONUTF8=1\r\n"
        f"\"{venv_python()}\" \"{RUNNER}\" %*\r\n", encoding="utf-8")
    return bindir


def cmd_setup(args: argparse.Namespace) -> int:
    """Einrichtung (vom PowerShell-Skript aufgerufen, darf jederzeit erneut laufen)."""
    for d in (HOME, CODE, STATE, LOGS, OUT):
        d.mkdir(parents=True, exist_ok=True)
    open_log()
    print("\n==> Python-Umgebung", flush=True)
    if not venv_python().exists():
        subprocess.run([sys.executable, "-m", "venv", str(VENV)], check=True)
    print("\n==> Code von GitHub holen und Pakete installieren (beim ersten Mal einige Minuten)", flush=True)
    code = update_code()
    if code is None:
        print("FEHLER: Code konnte nicht geladen werden (Internet?).")
        return 1
    print("\n==> FlareSolverr", flush=True)
    install_flaresolverr()
    print(f"\n==> Befehl 'cm' ({write_cm_cmd()})", flush=True)
    print("\n==> Zugangsdaten", flush=True)
    again = SECRETS.exists() and input("Zugangsdaten sind schon hinterlegt. Neu eingeben? (j/N) ").strip().lower() in ("j", "y")
    if again or not SECRETS.exists():
        ask_secrets()
    print("\n==> Zeitplan", flush=True)
    install_task()
    print("\n==> Selbsttest (schickt eine Testmail)", flush=True)
    cmd_selftest(args)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="cm", description="CM-Tracker auf dem Laptop")
    sub = parser.add_subparsers(dest="cmd")
    p = sub.add_parser("run", help="täglicher Lauf (startet der Zeitplan automatisch)")
    p.add_argument("--now", action="store_true", help="sofort, auch vor 03:30 Uhr")
    p.set_defaults(func=cmd_run)
    p = sub.add_parser("test", help="Testlauf mit N Produkten (Standard 20)")
    p.add_argument("n", nargs="?", type=int, default=20)
    p.set_defaults(func=cmd_test)
    sub.add_parser("status", help="Stand von heute, Zeitplan, letzte Protokollzeilen").set_defaults(func=cmd_status)
    p = sub.add_parser("logs", help="Protokoll des letzten Laufs")
    p.add_argument("n", nargs="?", type=int, default=80)
    p.set_defaults(func=cmd_logs)
    sub.add_parser("stop", help="laufenden Lauf anhalten").set_defaults(func=cmd_stop)
    p = sub.add_parser("update", help="Code (und mit --flaresolverr auch FlareSolverr) neu laden")
    p.add_argument("--flaresolverr", action="store_true")
    p.set_defaults(func=cmd_update)
    sub.add_parser("secrets", help="Zugangsdaten neu eingeben").set_defaults(func=cmd_secrets)
    sub.add_parser("selftest", help="R2, FlareSolverr und Mail prüfen (Testmail)").set_defaults(func=cmd_selftest)
    p = sub.add_parser("tool", help="Wartung, z. B. 'cm tool categories --game-id 18' oder 'cm tool cleanup …'")
    p.add_argument("rest", nargs=argparse.REMAINDER)
    p.set_defaults(func=cmd_tool)
    sub.add_parser("setup", help="Einrichtung (vom Einrichtungs-Skript aufgerufen)").set_defaults(func=cmd_setup)
    argv = sys.argv[1:] if argv is None else argv
    if argv[:1] in (["help"], ["hilfe"]):
        argv = []
    args = parser.parse_args(argv)
    if not getattr(args, "func", None):
        parser.print_help()
        print("\nBeispiele:  cm test   |   cm status   |   cm logs   |   cm run --now")
        return 0
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
