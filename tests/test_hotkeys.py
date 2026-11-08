import unittest

from macro_studio.hotkeys import HotkeyManager


class HotkeyFormatTests(unittest.TestCase):
    def test_formats_common_global_shortcut(self):
        self.assertEqual(HotkeyManager._format("Ctrl + Alt + G"), "<ctrl>+<alt>+g")
        self.assertEqual(HotkeyManager._format("Shift + F5"), "<shift>+<f5>")
        self.assertEqual(HotkeyManager._format("⌘ + Shift + K"), "<cmd>+<shift>+k")

    def test_rejects_unusable_or_duplicate_shortcuts(self):
        self.assertIsNone(HotkeyManager._format("G"))
        self.assertIsNone(HotkeyManager._format("Ctrl + Ctrl + G"))
        self.assertIsNone(HotkeyManager._format("Ctrl + Unknown"))


if __name__ == "__main__":
    unittest.main()
