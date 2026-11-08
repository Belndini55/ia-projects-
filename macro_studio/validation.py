"""Input validation and normalization for macro documents."""

from __future__ import annotations

import math
import re
import uuid
from datetime import datetime, timezone
from typing import Any


STEP_TYPES = {"hotkey", "key", "text", "click", "move", "scroll", "delay", "loop"}
_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")
_KEY_NAMES = {
    "enter", "return", "tab", "space", "backspace", "delete", "esc", "escape",
    "up", "down", "left", "right", "home", "end", "pageup", "pagedown",
    "insert", "capslock", "numlock", "scrolllock", "pause", "printscreen",
    "ctrl", "control", "alt", "shift", "win", "command", "cmd", "option",
    "meta", "apps", "menu", "clear", "help", "f1", "f2", "f3", "f4", "f5",
    "f6", "f7", "f8", "f9", "f10", "f11", "f12", "f13", "f14", "f15",
    "f16", "f17", "f18", "f19", "f20", "f21", "f22", "f23", "f24",
}


class ValidationError(ValueError):
    """Raised when a macro cannot be safely normalized."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _identifier(value: Any) -> str:
    if isinstance(value, str) and _ID_RE.fullmatch(value):
        return value
    return uuid.uuid4().hex


def _text(value: Any, field: str, limit: int, *, required: bool = False) -> str:
    if not isinstance(value, str):
        raise ValidationError(f"Pole „{field}” musi być tekstem.")
    value = value.strip()
    if required and not value:
        raise ValidationError(f"Pole „{field}” jest wymagane.")
    if len(value) > limit:
        raise ValidationError(f"Pole „{field}” może mieć maksymalnie {limit} znaków.")
    return value


def _number(value: Any, field: str, minimum: int | float, maximum: int | float,
            *, default: int | float) -> int | float:
    if isinstance(value, bool):
        raise ValidationError(f"Pole „{field}” musi być liczbą.")
    try:
        numeric = float(value)
    except (OverflowError, TypeError, ValueError):
        numeric = float(default)
    if not math.isfinite(numeric) or numeric < minimum or numeric > maximum:
        raise ValidationError(f"Pole „{field}” musi mieścić się w zakresie {minimum}–{maximum}.")
    return int(numeric) if numeric.is_integer() else numeric


def _key(value: Any) -> str:
    key = _text(value, "klawisz", 16, required=True).lower()
    if len(key) == 1 and key.isascii() and key.isalnum():
        return key
    if key not in _KEY_NAMES:
        raise ValidationError(
            f"Nieobsługiwany klawisz: „{key}”. Użyj litery, cyfry albo standardowej nazwy, np. enter, tab, f5."
        )
    return {"control": "ctrl", "cmd": "command", "meta": "command", "option": "alt", "escape": "esc", "return": "enter"}.get(key, key)


def validate_macro(payload: Any) -> dict[str, Any]:
    """Return a clean macro document or raise :class:`ValidationError`."""
    if not isinstance(payload, dict):
        raise ValidationError("Makro musi być obiektem JSON.")

    name = _text(payload.get("name", ""), "nazwa", 80, required=True)
    description = _text(payload.get("description", ""), "opis", 500)
    trigger = _text(payload.get("trigger", ""), "skrót", 40)
    raw_steps = payload.get("steps", [])
    if not isinstance(raw_steps, list):
        raise ValidationError("Lista kroków musi być tablicą.")

    count = [0]
    seen_ids: set[str] = set()
    steps = [_validate_step(step, 0, count, seen_ids) for step in raw_steps]
    if count[0] > 500:
        raise ValidationError("Makro może zawierać maksymalnie 500 kroków (wliczając pętle).")
    if _expanded_step_count(steps) > 25000:
        raise ValidationError("Makro przekracza limit 25 000 akcji po rozwinięciu pętli.")

    now = _now()
    created_at = payload.get("created_at")
    if not isinstance(created_at, str) or len(created_at) > 64:
        created_at = now
    updated_at = now
    return {
        "id": _identifier(payload.get("id")),
        "name": name,
        "description": description,
        "trigger": trigger,
        "steps": steps,
        "created_at": created_at,
        "updated_at": updated_at,
    }


def _validate_step(value: Any, depth: int, count: list[int], seen_ids: set[str]) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValidationError("Każdy krok musi być obiektem JSON.")
    if depth > 8:
        raise ValidationError("Pętle mogą być zagnieżdżone maksymalnie na 8 poziomach.")
    step_type = value.get("type")
    if not isinstance(step_type, str) or step_type not in STEP_TYPES:
        raise ValidationError(f"Nieobsługiwany typ kroku: {step_type!r}.")

    count[0] += 1
    step_id = _identifier(value.get("id"))
    while step_id in seen_ids:
        step_id = uuid.uuid4().hex
    seen_ids.add(step_id)
    step: dict[str, Any] = {
        "id": step_id,
        "type": step_type,
        "label": _text(value.get("label", ""), "etykieta kroku", 80),
    }

    if step_type == "key":
        step["key"] = _key(value.get("key", "enter"))
    elif step_type == "hotkey":
        raw_keys = value.get("keys", ["ctrl", "c"])
        if isinstance(raw_keys, str):
            raw_keys = [part.strip() for part in raw_keys.split("+") if part.strip()]
        if not isinstance(raw_keys, list) or not 2 <= len(raw_keys) <= 8:
            raise ValidationError("Skrót klawiszowy musi zawierać od 2 do 8 klawiszy.")
        step["keys"] = [_key(key) for key in raw_keys]
    elif step_type == "text":
        text = value.get("text", "")
        if not isinstance(text, str) or len(text) > 5000:
            raise ValidationError("Tekst makra może mieć maksymalnie 5000 znaków.")
        step["text"] = text
        step["interval_ms"] = _number(value.get("interval_ms", 8), "odstęp między znakami", 0, 1000, default=8)
    elif step_type == "click":
        step["x"] = _number(value.get("x", 640), "pozycja X", 0, 20000, default=640)
        step["y"] = _number(value.get("y", 360), "pozycja Y", 0, 20000, default=360)
        button = value.get("button", "left")
        if not isinstance(button, str) or button not in {"left", "right", "middle"}:
            raise ValidationError("Przycisk myszy musi mieć wartość left, right albo middle.")
        step["button"] = button
        step["clicks"] = _number(value.get("clicks", 1), "liczba kliknięć", 1, 10, default=1)
    elif step_type == "move":
        step["x"] = _number(value.get("x", 640), "pozycja X", 0, 20000, default=640)
        step["y"] = _number(value.get("y", 360), "pozycja Y", 0, 20000, default=360)
        step["duration_ms"] = _number(value.get("duration_ms", 250), "czas ruchu", 0, 60000, default=250)
    elif step_type == "scroll":
        step["amount"] = _number(value.get("amount", 3), "wartość przewijania", -1000, 1000, default=3)
    elif step_type == "delay":
        step["duration_ms"] = _number(value.get("duration_ms", 500), "czas oczekiwania", 0, 300000, default=500)
    elif step_type == "loop":
        step["count"] = _number(value.get("count", 3), "liczba powtórzeń", 1, 100, default=3)
        children = value.get("children", [])
        if not isinstance(children, list):
            raise ValidationError("Kroki wewnątrz pętli muszą być tablicą.")
        step["children"] = [_validate_step(child, depth + 1, count, seen_ids) for child in children]

    return step


def _expanded_step_count(steps: list[dict[str, Any]], multiplier: int = 1, limit: int = 25000) -> int:
    """Bound execution work after nested loops are expanded."""
    total = 0
    for step in steps:
        total += multiplier
        if total > limit:
            return total
        if step["type"] == "loop":
            total += _expanded_step_count(step.get("children", []), multiplier * int(step["count"]), limit - total)
            if total > limit:
                return total
    return total
