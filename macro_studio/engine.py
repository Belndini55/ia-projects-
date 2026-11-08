"""Asynchronous macro preview and optional PyAutoGUI execution."""

from __future__ import annotations

import importlib
import platform
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Any


class RunManager:
    def __init__(self) -> None:
        self._jobs: dict[str, dict[str, Any]] = {}
        self._lock = threading.RLock()

    def start(self, macro: dict[str, Any], mode: str = "preview") -> dict[str, Any]:
        if mode not in {"preview", "live"}:
            raise ValueError("Tryb uruchomienia musi mieć wartość preview albo live.")
        if mode == "live":
            with self._lock:
                if any(job["status"] in {"queued", "running"} and job["mode"] == "live"
                       for job in self._jobs.values()):
                    raise RuntimeError("Inne makro jest już uruchomione. Zatrzymaj je przed kolejnym startem.")
            try:
                importlib.import_module("pyautogui")
            except ImportError as exc:
                raise RuntimeError(
                    "Tryb rzeczywisty wymaga PyAutoGUI. Zainstaluj zależności: "
                    "python -m pip install -r requirements-live.txt"
                ) from exc
            except Exception as exc:
                raise RuntimeError(f"Nie można uruchomić PyAutoGUI w tym środowisku: {exc}") from exc

        job_id = uuid.uuid4().hex[:12]
        job: dict[str, Any] = {
            "id": job_id,
            "macro_id": macro["id"],
            "macro_name": macro["name"],
            "mode": mode,
            "status": "queued",
            "started_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "finished_at": None,
            "logs": [],
            "error": None,
            "cancel": threading.Event(),
            "lock": threading.RLock(),
        }
        with self._lock:
            if mode == "live" and any(item["status"] in {"queued", "running"} and item["mode"] == "live"
                                       for item in self._jobs.values()):
                raise RuntimeError("Inne makro jest już uruchomione. Zatrzymaj je przed kolejnym startem.")
            terminal = [key for key, item in self._jobs.items() if item["status"] in {"completed", "stopped", "failed"}]
            while len(self._jobs) >= 60 and terminal:
                self._jobs.pop(terminal.pop(0), None)
            self._jobs[job_id] = job
        worker = threading.Thread(target=self._run, args=(job, macro), daemon=True, name=f"macro-{job_id}")
        worker.start()
        return self._public(job)

    def get(self, job_id: str) -> dict[str, Any] | None:
        with self._lock:
            job = self._jobs.get(job_id)
        return self._public(job) if job else None

    def stop(self, job_id: str) -> dict[str, Any] | None:
        with self._lock:
            job = self._jobs.get(job_id)
        if not job:
            return None
        job["cancel"].set()
        with job["lock"]:
            if job["status"] == "queued":
                job["status"] = "stopping"
            self._log(job, "Wysłano żądanie zatrzymania.", "warning")
        return self._public(job)

    @staticmethod
    def _public(job: dict[str, Any]) -> dict[str, Any]:
        with job["lock"]:
            return {
                "id": job["id"],
                "macro_id": job["macro_id"],
                "macro_name": job["macro_name"],
                "mode": job["mode"],
                "status": job["status"],
                "started_at": job["started_at"],
                "finished_at": job["finished_at"],
                "logs": list(job["logs"]),
                "error": job["error"],
            }

    @staticmethod
    def _log(job: dict[str, Any], message: str, level: str = "info") -> None:
        with job["lock"]:
            job["logs"].append({
                "time": datetime.now().astimezone().strftime("%H:%M:%S"),
                "message": message,
                "level": level,
            })
            job["logs"] = job["logs"][-500:]

    def _run(self, job: dict[str, Any], macro: dict[str, Any]) -> None:
        with job["lock"]:
            job["status"] = "running"
        mode_label = "Podgląd" if job["mode"] == "preview" else "Tryb rzeczywisty"
        self._log(job, f"{mode_label}: {macro['name']}", "system")
        try:
            pyautogui = None
            if job["mode"] == "live":
                pyautogui = importlib.import_module("pyautogui")
                pyautogui.FAILSAFE = True
                pyautogui.PAUSE = 0.04
                self._log(job, "Start za 3 sekundy — przełącz się teraz do aplikacji docelowej.", "warning")
                for remaining in (3, 2, 1):
                    if job["cancel"].wait(1):
                        break
                    if remaining > 1:
                        self._log(job, f"Start za {remaining - 1} s…", "muted")
            if not job["cancel"].is_set():
                self._execute_steps(job, macro.get("steps", []), pyautogui)
            if job["cancel"].is_set():
                with job["lock"]:
                    job["status"] = "stopped"
                self._log(job, "Makro zatrzymane.", "warning")
            else:
                with job["lock"]:
                    job["status"] = "completed"
                self._log(job, "Makro zakończone pomyślnie.", "success")
        except Exception as exc:  # Keep failures visible in the run panel instead of crashing the server.
            with job["lock"]:
                job["status"] = "failed"
                job["error"] = str(exc)
            self._log(job, f"Błąd: {exc}", "error")
        finally:
            with job["lock"]:
                job["finished_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")

    def _execute_steps(self, job: dict[str, Any], steps: list[dict[str, Any]], pyautogui: Any) -> None:
        for index, step in enumerate(steps, start=1):
            if job["cancel"].is_set():
                return
            step_type = step["type"]
            label = step.get("label") or self._describe(step)
            prefix = f"Krok {index}: "
            if step_type == "loop":
                count = int(step.get("count", 1))
                self._log(job, f"{prefix}Pętla „{label}” — {count}×", "step")
                for iteration in range(1, count + 1):
                    if job["cancel"].is_set():
                        return
                    self._log(job, f"Przebieg pętli {iteration}/{count}", "muted")
                    self._execute_steps(job, step.get("children", []), pyautogui)
                continue

            self._log(job, f"{prefix}{label}", "step")
            if job["mode"] == "preview":
                continue
            self._perform_live(step, pyautogui, job)

    def _perform_live(self, step: dict[str, Any], pyautogui: Any, job: dict[str, Any]) -> None:
        if job["cancel"].is_set():
            return
        step_type = step["type"]
        if step_type == "hotkey":
            keys = [self._platform_key(key) for key in step["keys"]]
            pyautogui.hotkey(*keys)
        elif step_type == "key":
            pyautogui.press(self._platform_key(step["key"]))
        elif step_type == "text":
            text = step["text"]
            interval = float(step.get("interval_ms", 8)) / 1000
            if text.isascii():
                pyautogui.write(text, interval=interval)
            else:
                self._paste_text(text, pyautogui)
        elif step_type == "click":
            pyautogui.click(
                x=int(step["x"]), y=int(step["y"]), button=step["button"], clicks=int(step["clicks"]), interval=0.12
            )
        elif step_type == "move":
            pyautogui.moveTo(
                x=int(step["x"]), y=int(step["y"]), duration=float(step.get("duration_ms", 0)) / 1000
            )
        elif step_type == "scroll":
            pyautogui.scroll(int(step["amount"]))
        elif step_type == "delay":
            job["cancel"].wait(float(step.get("duration_ms", 0)) / 1000)

    @staticmethod
    def _platform_key(key: str) -> str:
        if platform.system() == "Darwin":
            return {"ctrl": "command", "control": "command", "win": "command"}.get(key, key)
        return {"command": "ctrl", "cmd": "ctrl", "meta": "ctrl"}.get(key, key)

    @staticmethod
    def _paste_text(text: str, pyautogui: Any) -> None:
        try:
            pyperclip = importlib.import_module("pyperclip")
            previous = pyperclip.paste()
            pyperclip.copy(text)
            modifier = "command" if platform.system() == "Darwin" else "ctrl"
            pyautogui.hotkey(modifier, "v")
            # Restore the user's clipboard after a short paste buffer window.
            time.sleep(0.15)
            pyperclip.copy(previous)
        except Exception as exc:
            raise RuntimeError(
                "Wklejanie tekstu Unicode wymaga działającego schowka i pakietu pyperclip. "
                "Zainstaluj: python -m pip install pyperclip"
            ) from exc

    @staticmethod
    def _describe(step: dict[str, Any]) -> str:
        step_type = step["type"]
        if step_type == "hotkey":
            return "Skrót: " + " + ".join(step["keys"])
        if step_type == "key":
            return f"Naciśnij {step['key']}"
        if step_type == "text":
            sample = step.get("text", "").replace("\n", " ↵ ")
            return f"Wpisz: „{sample[:36]}{'…' if len(sample) > 36 else ''}”"
        if step_type == "click":
            return f"Kliknij {step['button']} ({step['x']}, {step['y']})"
        if step_type == "move":
            return f"Przesuń kursor do ({step['x']}, {step['y']})"
        if step_type == "scroll":
            return f"Przewiń {step['amount']}"
        if step_type == "delay":
            return f"Odczekaj {step['duration_ms']} ms"
        return step_type
