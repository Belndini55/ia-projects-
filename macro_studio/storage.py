"""Small JSON-backed local macro library."""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Any

from .validation import ValidationError, validate_macro


PROJECT_ROOT = Path(__file__).resolve().parent.parent


def _examples() -> list[dict[str, Any]]:
    return [
        {
            "id": "welcome-note",
            "name": "Wiadomość na start",
            "description": "Wstaw gotowe powitanie do aktywnego pola tekstowego.",
            "trigger": "Ctrl + Alt + G",
            "steps": [
                {"id": "welcome-wait", "type": "delay", "duration_ms": 250},
                {
                    "id": "welcome-text", "type": "text", "interval_ms": 6,
                    "text": "Cześć! Dzięki za wiadomość — wrócę z odpowiedzią najszybciej, jak to możliwe.",
                },
            ],
        },
        {
            "id": "meeting-outline",
            "name": "Plan spotkania",
            "description": "Przykład pętli, przerw i wielowierszowego tekstu.",
            "trigger": "Ctrl + Alt + P",
            "steps": [
                {"id": "meeting-title", "type": "text", "text": "AGENDA SPOTKANIA\n", "interval_ms": 0},
                {"id": "meeting-break-1", "type": "key", "key": "enter"},
                {
                    "id": "meeting-topics", "type": "loop", "count": 3, "label": "Dodaj punkt agendy",
                    "children": [
                        {"id": "meeting-bullet", "type": "text", "text": "•  ", "interval_ms": 0},
                        {"id": "meeting-line", "type": "key", "key": "enter"},
                    ],
                },
                {"id": "meeting-wait", "type": "delay", "duration_ms": 300},
                {"id": "meeting-end", "type": "text", "text": "\nDecyzje i kolejne kroki:\n", "interval_ms": 0},
            ],
        },
        {
            "id": "quick-capture",
            "name": "Szybkie przechwycenie",
            "description": "Sekwencja klawiaturowa z krótkim oczekiwaniem.",
            "trigger": "Ctrl + Alt + C",
            "steps": [
                {"id": "capture-copy", "type": "hotkey", "keys": ["ctrl", "c"], "label": "Skopiuj zaznaczenie"},
                {"id": "capture-delay", "type": "delay", "duration_ms": 150},
                {"id": "capture-new-line", "type": "key", "key": "enter"},
                {"id": "capture-paste", "type": "hotkey", "keys": ["ctrl", "v"], "label": "Wklej w aktywnym miejscu"},
            ],
        },
    ]


class MacroStore:
    def __init__(self, path: Path | None = None) -> None:
        configured = os.environ.get("MAKRO_STUDIO_DATA")
        self.path = path or (Path(configured) if configured else PROJECT_ROOT / "user_data" / "macros.json")
        self._lock = threading.RLock()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self._write([validate_macro(item) for item in _examples()])

    def _read(self) -> list[dict[str, Any]]:
        try:
            with self.path.open("r", encoding="utf-8") as file:
                data = json.load(file)
        except (OSError, json.JSONDecodeError) as exc:
            raise RuntimeError(f"Nie można odczytać biblioteki makr: {exc}") from exc
        if not isinstance(data, list):
            raise RuntimeError("Plik biblioteki makr ma nieprawidłowy format.")
        return data

    def _write(self, macros: list[dict[str, Any]]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(self.path.suffix + ".tmp")
        with temporary.open("w", encoding="utf-8") as file:
            json.dump(macros, file, ensure_ascii=False, indent=2)
            file.write("\n")
        temporary.replace(self.path)

    def list(self) -> list[dict[str, Any]]:
        with self._lock:
            return self._read()

    def get(self, macro_id: str) -> dict[str, Any] | None:
        with self._lock:
            return next((item for item in self._read() if item.get("id") == macro_id), None)

    def save(self, payload: Any, *, macro_id: str | None = None, create: bool = False) -> dict[str, Any]:
        macro = validate_macro(payload)
        with self._lock:
            macros = self._read()
            if create:
                ids = {item.get("id") for item in macros}
                if macro["id"] in ids:
                    macro["id"] = os.urandom(16).hex()
                macros.insert(0, macro)
            else:
                target_id = macro_id or macro["id"]
                index = next((i for i, item in enumerate(macros) if item.get("id") == target_id), None)
                if index is None:
                    raise KeyError(target_id)
                macro["id"] = target_id
                macro["created_at"] = macros[index].get("created_at", macro["created_at"])
                macros[index] = macro
            self._write(macros)
        return macro

    def delete(self, macro_id: str) -> bool:
        with self._lock:
            macros = self._read()
            remaining = [item for item in macros if item.get("id") != macro_id]
            if len(remaining) == len(macros):
                return False
            self._write(remaining)
            return True
