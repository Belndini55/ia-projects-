"""Optional system-wide shortcuts, enabled when pynput is installed."""

from __future__ import annotations

import platform
import threading
from typing import Any


_SPECIAL_KEYS = {
    "enter": "enter", "tab": "tab", "space": "space", "backspace": "backspace",
    "delete": "delete", "esc": "esc", "up": "up", "down": "down", "left": "left",
    "right": "right", "home": "home", "end": "end", "pageup": "page_up",
    "pagedown": "page_down", "insert": "insert", "capslock": "caps_lock",
}


class HotkeyManager:
    """Register macro shortcuts globally when the optional pynput backend is available."""

    def __init__(self, store: Any, runner: Any) -> None:
        self.store = store
        self.runner = runner
        self._lock = threading.RLock()
        self._listener: Any = None
        self.enabled = False
        self.active = False
        try:
            from pynput import keyboard
            self._keyboard = keyboard
            self.enabled = True
        except Exception as exc:
            self._keyboard = None
            print(f"Skróty globalne są wyłączone (opcjonalny pynput niedostępny: {exc}).")

    def sync(self) -> None:
        if not self.enabled:
            return
        try:
            macros = self.store.list()
            mapping: dict[str, Any] = {}
            for macro in macros:
                shortcut = self._format(macro.get("trigger", ""))
                if not shortcut:
                    continue
                if shortcut in mapping:
                    print(f"Pominięto powielony skrót globalny: {macro['trigger']}")
                    continue
                macro_id = macro["id"]
                mapping[shortcut] = lambda macro_id=macro_id: self._run_macro(macro_id)

            with self._lock:
                old_listener = self._listener
                self._listener = None
                self.active = False
                if old_listener:
                    old_listener.stop()
                if mapping:
                    listener = self._keyboard.GlobalHotKeys(mapping)
                    listener.start()
                    self._listener = listener
                    self.active = True
                    print(f"Zarejestrowano {len(mapping)} skrótów globalnych.")
        except Exception as exc:
            self.active = False
            print(f"Nie udało się zarejestrować skrótów globalnych: {exc}")

    def close(self) -> None:
        with self._lock:
            listener = self._listener
            self._listener = None
            self.active = False
        if listener:
            listener.stop()

    def _run_macro(self, macro_id: str) -> None:
        macro = self.store.get(macro_id)
        if not macro:
            return
        try:
            self.runner.start(macro, "live")
        except Exception as exc:
            print(f"Nie udało się uruchomić makra „{macro['name']}”: {exc}")

    @staticmethod
    def _format(shortcut: str) -> str | None:
        tokens = [part.strip().lower() for part in shortcut.split("+") if part.strip()]
        if len(tokens) < 2:
            return None
        output: list[str] = []
        for token in tokens:
            if token in {"ctrl", "control", "⌃"}:
                output.append("<ctrl>")
            elif token in {"alt", "option", "⌥"}:
                output.append("<alt>")
            elif token in {"shift", "⇧"}:
                output.append("<shift>")
            elif token in {"command", "cmd", "meta", "win", "⌘"}:
                output.append("<cmd>" if platform.system() == "Darwin" else "<cmd>")
            elif len(token) == 1 and token.isascii() and token.isalnum():
                output.append(token)
            elif token.startswith("f") and token[1:].isdigit() and 1 <= int(token[1:]) <= 24:
                output.append(f"<{token}>")
            elif token in _SPECIAL_KEYS:
                output.append(f"<{_SPECIAL_KEYS[token]}>")
            else:
                return None
        if len(set(output)) != len(output):
            return None
        return "+".join(output)
