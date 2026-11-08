"""Dependency-free HTTP server for the local Makro Studio UI and JSON API."""

from __future__ import annotations

import argparse
import json
import mimetypes
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit
from typing import Any

from .engine import RunManager
from .hotkeys import HotkeyManager
from .storage import MacroStore
from .validation import ValidationError


PROJECT_ROOT = Path(__file__).resolve().parent.parent
STATIC_ROOT = PROJECT_ROOT / "static"
MAX_REQUEST_BYTES = 2 * 1024 * 1024
_MACRO_ROUTE = re.compile(r"^/api/macros/([a-zA-Z0-9_-]{1,64})(?:/(run))?$")
_RUN_ROUTE = re.compile(r"^/api/runs/([a-f0-9]{12})(?:/(stop))?$")


class MakroStudioServer(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True


def make_handler(store: MacroStore, runs: RunManager, hotkeys: HotkeyManager | None = None) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        server_version = "MakroStudio/1.0"

        def do_GET(self) -> None:  # noqa: N802 - stdlib handler interface
            route = urlsplit(self.path).path
            try:
                if route == "/api/health":
                    self._json(200, {
                        "ok": True,
                        "name": "Makro Studio",
                        "global_hotkeys": bool(hotkeys and hotkeys.enabled),
                        "hotkeys_registered": bool(hotkeys and hotkeys.active),
                    })
                elif route == "/api/macros":
                    self._json(200, {"macros": store.list()})
                elif route.startswith("/api/runs/"):
                    match = _RUN_ROUTE.fullmatch(route)
                    if not match or match.group(2):
                        self._json(404, {"error": "Nie znaleziono uruchomienia."})
                        return
                    job = runs.get(match.group(1))
                    self._json(200, job) if job else self._json(404, {"error": "Nie znaleziono uruchomienia."})
                else:
                    self._static(route)
            except (RuntimeError, OSError) as exc:
                self._json(500, {"error": str(exc)})

        def do_POST(self) -> None:  # noqa: N802
            route = urlsplit(self.path).path
            try:
                payload = self._read_json()
                if route == "/api/macros":
                    macro = store.save(payload, create=True)
                    if hotkeys:
                        hotkeys.sync()
                    self._json(201, {"macro": macro})
                    return
                if route.startswith("/api/macros/"):
                    match = _MACRO_ROUTE.fullmatch(route)
                    if not match:
                        self._json(404, {"error": "Nie znaleziono zasobu."})
                        return
                    macro_id, action = match.groups()
                    if action != "run":
                        self._json(404, {"error": "Nie znaleziono zasobu."})
                        return
                    macro = store.get(macro_id)
                    if not macro:
                        self._json(404, {"error": "Nie znaleziono makra."})
                        return
                    mode = payload.get("mode", "preview") if isinstance(payload, dict) else "preview"
                    job = runs.start(macro, mode)
                    self._json(202, {"run": job})
                    return
                if route.startswith("/api/runs/"):
                    match = _RUN_ROUTE.fullmatch(route)
                    if not match or match.group(2) != "stop":
                        self._json(404, {"error": "Nie znaleziono zasobu."})
                        return
                    job = runs.stop(match.group(1))
                    self._json(200, {"run": job}) if job else self._json(404, {"error": "Nie znaleziono uruchomienia."})
                    return
                self._json(404, {"error": "Nie znaleziono zasobu."})
            except ValidationError as exc:
                self._json(400, {"error": str(exc)})
            except KeyError:
                self._json(404, {"error": "Nie znaleziono makra."})
            except (ValueError, RuntimeError) as exc:
                self._json(400, {"error": str(exc)})
            except (OSError, json.JSONDecodeError) as exc:
                self._json(500, {"error": str(exc)})

        def do_PUT(self) -> None:  # noqa: N802
            route = urlsplit(self.path).path
            match = _MACRO_ROUTE.fullmatch(route)
            if not match or match.group(2):
                self._json(404, {"error": "Nie znaleziono zasobu."})
                return
            try:
                old_macro = store.get(match.group(1))
                macro = store.save(self._read_json(), macro_id=match.group(1))
                if hotkeys and old_macro and old_macro.get("trigger") != macro.get("trigger"):
                    hotkeys.sync()
                self._json(200, {"macro": macro})
            except ValidationError as exc:
                self._json(400, {"error": str(exc)})
            except KeyError:
                self._json(404, {"error": "Nie znaleziono makra."})
            except (OSError, RuntimeError, json.JSONDecodeError) as exc:
                self._json(500, {"error": str(exc)})

        def do_DELETE(self) -> None:  # noqa: N802
            route = urlsplit(self.path).path
            match = _MACRO_ROUTE.fullmatch(route)
            if not match or match.group(2):
                self._json(404, {"error": "Nie znaleziono zasobu."})
                return
            if store.delete(match.group(1)):
                if hotkeys:
                    hotkeys.sync()
                self._json(200, {"ok": True})
            else:
                self._json(404, {"error": "Nie znaleziono makra."})

        def _read_json(self) -> Any:
            try:
                size = int(self.headers.get("Content-Length", "0"))
            except ValueError as exc:
                raise ValueError("Nieprawidłowy nagłówek Content-Length.") from exc
            if size < 0:
                raise ValueError("Nieprawidłowa długość żądania.")
            if size > MAX_REQUEST_BYTES:
                raise ValueError("Przesłany plik jest za duży (limit 2 MB).")
            raw = self.rfile.read(size)
            if not raw:
                return {}
            try:
                return json.loads(raw.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise ValueError("Treść żądania nie jest poprawnym JSON-em.") from exc

        def _static(self, route: str) -> None:
            if route == "/":
                relative = "index.html"
            elif route.startswith("/static/"):
                relative = unquote(route.removeprefix("/static/"))
            else:
                self._json(404, {"error": "Nie znaleziono strony."})
                return
            target = (STATIC_ROOT / relative).resolve()
            try:
                target.relative_to(STATIC_ROOT.resolve())
            except ValueError:
                self._json(404, {"error": "Nie znaleziono pliku."})
                return
            if not target.is_file():
                self._json(404, {"error": "Nie znaleziono pliku."})
                return
            content_type, _ = mimetypes.guess_type(target.name)
            content = target.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", f"{content_type or 'application/octet-stream'}; charset=utf-8")
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Cache-Control", "no-cache")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(content)

        def _json(self, status: int, data: Any) -> None:
            content = json.dumps(data, ensure_ascii=False, allow_nan=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(content)

        def log_message(self, format: str, *args: Any) -> None:
            print(f"[{self.log_date_time_string()}] {self.address_string()} {format % args}")

    return Handler


def main() -> None:
    parser = argparse.ArgumentParser(description="Uruchom lokalny edytor Makro Studio.")
    parser.add_argument("--host", default="127.0.0.1", help="Adres nasłuchiwania (domyślnie tylko lokalny komputer).")
    parser.add_argument("--port", type=int, default=8000, help="Port HTTP (domyślnie 8000).")
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("Port musi mieścić się w zakresie 1–65535.")

    store = MacroStore()
    runs = RunManager()
    hotkeys = HotkeyManager(store, runs)
    hotkeys.sync()
    server = MakroStudioServer((args.host, args.port), make_handler(store, runs, hotkeys))
    print(f"Makro Studio działa: http://{args.host}:{args.port}")
    print("Zatrzymaj serwer skrótem Ctrl+C.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nZamykanie Makro Studio…")
    finally:
        hotkeys.close()
        server.server_close()


if __name__ == "__main__":
    main()
