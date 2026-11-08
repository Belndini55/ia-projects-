import tempfile
import time
import unittest
from pathlib import Path

from macro_studio.engine import RunManager
from macro_studio.storage import MacroStore
from macro_studio.validation import validate_macro


class MacroEngineTests(unittest.TestCase):
    def test_preview_executes_nested_loop_without_os_automation(self):
        macro = validate_macro({
            "name": "Podgląd",
            "steps": [
                {"type": "loop", "count": 2, "children": [
                    {"type": "text", "text": "test"},
                    {"type": "delay", "duration_ms": 1000},
                ]},
            ],
        })
        manager = RunManager()
        job = manager.start(macro, "preview")
        deadline = time.time() + 2
        while time.time() < deadline:
            job = manager.get(job["id"])
            if job["status"] in {"completed", "failed", "stopped"}:
                break
            time.sleep(0.01)
        self.assertEqual(job["status"], "completed")
        messages = [entry["message"] for entry in job["logs"]]
        self.assertTrue(any("Przebieg pętli 2/2" in message for message in messages))
        self.assertTrue(any("Wpisz: „test”" in message for message in messages))

    def test_json_store_create_update_delete(self):
        with tempfile.TemporaryDirectory() as temporary:
            store = MacroStore(Path(temporary) / "macros.json")
            self.assertEqual(len(store.list()), 3)
            created = store.save({"name": "Moje makro", "steps": []}, create=True)
            self.assertEqual(store.get(created["id"])["name"], "Moje makro")
            updated = store.save({**created, "name": "Zmienione"}, macro_id=created["id"])
            self.assertEqual(updated["name"], "Zmienione")
            self.assertTrue(store.delete(created["id"]))
            self.assertIsNone(store.get(created["id"]))


if __name__ == "__main__":
    unittest.main()
