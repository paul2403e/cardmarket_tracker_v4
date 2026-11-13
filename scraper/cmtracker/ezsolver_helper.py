"""Optional EzSolver integration for Cloudflare Turnstile managed checkbox.

Expects a local EzSolver service (https://github.com/ismoiloffS/EzSolver) running
on EZSOLVER_URL (default http://127.0.0.1:8191/solve).

EzSolver solves the widget and returns a token. For full-page interstitial
challenges the token alone is often not enough; this helper still tries the
call and can be extended later to extract cookies from the solver browser.
"""

from __future__ import annotations

import os
import requests

EZSOLVER_URL = os.environ.get("EZSOLVER_URL", "http://127.0.0.1:8191/solve")


def try_solve_turnstile(siteurl: str, sitekey: str | None = None, timeout: int = 45) -> dict | None:
    """Call local EzSolver service. Returns response dict or None on failure."""
    if not siteurl:
        return None
    payload = {"siteurl": siteurl, "timeout": timeout}
    if sitekey:
        payload["sitekey"] = sitekey
    try:
        resp = requests.post(EZSOLVER_URL, json=payload, timeout=timeout + 15)
        if resp.ok:
            data = resp.json()
            if data.get("token"):
                return data
    except Exception:
        pass
    return None
