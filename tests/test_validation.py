import unittest

from macro_studio.validation import ValidationError, validate_macro


class MacroValidationTests(unittest.TestCase):
    def test_normalizes_nested_macro_and_generates_unique_step_ids(self):
        macro = validate_macro({
            "name": "  Demo  ",
            "steps": [
                {"id": "same", "type": "loop", "count": "2", "children": [
                    {"id": "same", "type": "hotkey", "keys": ["CONTROL", "C"]},
                ]},
                {"id": "same", "type": "delay", "duration_ms": 25.5},
            ],
        })
        ids = [macro["steps"][0]["id"], macro["steps"][0]["children"][0]["id"], macro["steps"][1]["id"]]
        self.assertEqual(macro["name"], "Demo")
        self.assertEqual(len(set(ids)), 3)
        self.assertEqual(macro["steps"][0]["children"][0]["keys"], ["ctrl", "c"])
        self.assertEqual(macro["steps"][1]["duration_ms"], 25.5)

    def test_rejects_missing_name_and_invalid_hotkey(self):
        with self.assertRaises(ValidationError):
            validate_macro({"name": "  "})
        with self.assertRaises(ValidationError):
            validate_macro({"name": "Demo", "steps": [{"type": "hotkey", "keys": ["ctrl"]}]})

    def test_rejects_non_finite_numbers(self):
        with self.assertRaises(ValidationError):
            validate_macro({"name": "Demo", "steps": [{"type": "delay", "duration_ms": float("nan")}]})

    def test_rejects_too_many_expanded_actions(self):
        step = {"type": "key", "key": "enter"}
        for _ in range(3):
            step = {"type": "loop", "count": 100, "children": [step]}
        with self.assertRaisesRegex(ValidationError, "25 000"):
            validate_macro({"name": "Duża pętla", "steps": [step]})

    def test_rejects_unsupported_key(self):
        with self.assertRaises(ValidationError):
            validate_macro({"name": "Demo", "steps": [{"type": "key", "key": "not-a-key"}]})


if __name__ == "__main__":
    unittest.main()
