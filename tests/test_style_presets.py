import importlib.util
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

from aiohttp import web


ROOT = Path(__file__).resolve().parents[1]
server = types.ModuleType("server")
server.PromptServer = types.SimpleNamespace(instance=None)
package = types.ModuleType("ppb")
package.__path__ = [str(ROOT)]
spec = importlib.util.spec_from_file_location("ppb.style_presets", ROOT / "style_presets.py")
styles = importlib.util.module_from_spec(spec)
with patch.dict(sys.modules, {"server": server, "ppb": package}):
    spec.loader.exec_module(styles)


class Request:
    def __init__(self, user="default", **body):
        self.user = user
        self.body = body

    async def json(self):
        return self.body


class StylePresetsTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

        def filepath(request, filename):
            if request.user not in ("default", "second"):
                raise KeyError("Unknown user")
            path = self.root / request.user / filename
            path.parent.mkdir(parents=True, exist_ok=True)
            return str(path)

        server.PromptServer.instance = types.SimpleNamespace(
            user_manager=types.SimpleNamespace(get_request_user_filepath=filepath)
        )

    async def test_create_update_delete_preserves_other_presets_and_builder_file(self):
        path = styles.styles_path(Request())
        builder = path.with_name("presets.json")
        builder.write_text('{"existing": "do not touch"}', encoding="utf-8")
        pair = {"positive": "日本語\n{prompt}, {red|blue}\n", "negative": " low quality\n"}
        result = await styles.put_style(Request(folder="anima", name="base", **pair))
        self.assertEqual(result.status, 200)
        self.assertEqual(styles.load_styles(path)["anima"]["base"], pair)
        await styles.put_style(Request(folder="SDXL", name="base", positive="SDXL", negative=""))
        conflict = await styles.put_style(Request(folder="anima", name="base", positive="edited", negative=""))
        self.assertEqual(conflict.status, 409)
        self.assertEqual(styles.load_styles(path)["anima"]["base"], pair)
        await styles.put_style(Request(folder="anima", name="base", positive="edited", negative="", overwrite=True))
        self.assertEqual(json.loads(path.with_suffix(".json.bak").read_text(encoding="utf-8"))["anima"]["base"], pair)
        await styles.delete_style(Request(folder="anima", name="base"))
        self.assertEqual(styles.load_styles(path), {"SDXL": {"base": {"positive": "SDXL", "negative": ""}}})
        self.assertEqual(builder.read_text(encoding="utf-8"), '{"existing": "do not touch"}')

    async def test_profiles_are_isolated_and_names_are_not_paths(self):
        await styles.put_style(Request(folder="..", name="../../same", positive="first", negative=""))
        await styles.put_style(Request(user="second", folder="..", name="../../same", positive="second", negative=""))
        for user, text in (("default", "first"), ("second", "second")):
            response = await styles.list_styles(Request(user=user))
            self.assertEqual(json.loads(response.text)["styles"][".."]["../../same"]["positive"], text)
        self.assertFalse((self.root / "same").exists())
        with self.assertRaises(KeyError):
            styles.styles_path(Request(user="unknown"))

    async def test_invalid_file_is_not_overwritten(self):
        path = styles.styles_path(Request())
        path.write_text("broken json", encoding="utf-8")
        with self.assertRaises(web.HTTPConflict):
            await styles.put_style(Request(folder="f", name="new", positive="", negative=""))
        self.assertEqual(path.read_text(encoding="utf-8"), "broken json")

    async def test_bad_requests_do_not_write(self):
        for body in ({"name": ""}, {"folder": "f", "name": "style", "positive": 3, "negative": ""}):
            self.assertEqual((await styles.put_style(Request(**body))).status, 400)
        self.assertEqual((await styles.delete_style(Request(folder="f", name="missing"))).status, 404)
        self.assertFalse(styles.styles_path(Request()).exists())

    def test_random_syntax_is_resolved_with_the_seed(self):
        node = styles.PromptStylePresets()
        positive, negative = node.get_prompts(" style\n{a|b}, __wildcard__ ", "{x|y}\n", 1)
        self.assertIn(positive, (" style\na, __wildcard__ ", " style\nb, __wildcard__ "))
        self.assertIn(negative, ("x\n", "y\n"))
        self.assertEqual(node.get_prompts("{a|b|c|d}", "{a|b|c|d}", 7), node.get_prompts("{a|b|c|d}", "{a|b|c|d}", 7))
        inputs = styles.PromptStylePresets.INPUT_TYPES()["required"]
        self.assertEqual(list(inputs), ["positive", "negative", "seed"])
        self.assertTrue(all(inputs[name][1]["dynamicPrompts"] is False for name in ("positive", "negative")))


if __name__ == "__main__":
    unittest.main()
