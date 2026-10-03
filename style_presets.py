import json
import os
import random
import shutil
from pathlib import Path

from aiohttp import web
from server import PromptServer

from .dynamic_prompt import resolve


class PromptStylePresets:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "positive": ("STRING", {"default": "", "multiline": True, "dynamicPrompts": False}),
            "negative": ("STRING", {"default": "", "multiline": True, "dynamicPrompts": False}),
            "seed": ("INT", {
                "default": 0, "min": 0, "max": 0xffffffffffffffff,
                "control_after_generate": True,
            }),
        }}

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("positive", "negative")
    FUNCTION = "get_prompts"
    CATEGORY = "utils/prompt"
    DESCRIPTION = "Save, load and edit positive/negative style pairs. Resolves {a|b|0.4::c} syntax with the seed."

    def get_prompts(self, positive, negative, seed):
        rng = random.Random(seed)
        return resolve(positive, rng), resolve(negative, rng)


def styles_path(request):
    path = PromptServer.instance.user_manager.get_request_user_filepath(
        request, "prompt_preset_builder/styles.json"
    )
    if path is None:
        raise web.HTTPForbidden(reason="User storage is unavailable")
    return Path(path)


def load_styles(path):
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (UnicodeError, ValueError) as error:
        raise web.HTTPConflict(reason="Invalid styles.json; restore it before saving") from error
    if not isinstance(data, dict) or any(
        not isinstance(value, dict)
        or not isinstance(value.get("positive"), str)
        or not isinstance(value.get("negative"), str)
        for value in data.values()
    ):
        raise web.HTTPConflict(reason="Invalid styles.json; restore it before saving")
    return data


def save_styles(path, styles):
    pending = path.with_suffix(".json.tmp")
    pending.write_text(json.dumps(styles, ensure_ascii=False, indent=2), encoding="utf-8")
    if path.exists():
        shutil.copy2(path, path.with_suffix(".json.bak"))
    os.replace(pending, path)


async def list_styles(request):
    return web.json_response({"styles": load_styles(styles_path(request))})


async def put_style(request):
    body = await request.json()
    name = body.get("name")
    if not isinstance(name, str) or not name.strip():
        return web.json_response({"error": "A style name is required"}, status=400)
    if not all(isinstance(body.get(key), str) for key in ("positive", "negative")):
        return web.json_response({"error": "Positive and negative must be text"}, status=400)
    name = name.strip()
    path = styles_path(request)
    styles = load_styles(path)
    if name in styles and body.get("overwrite") is not True:
        return web.json_response({"error": "A style with this name already exists"}, status=409)
    styles[name] = {"positive": body["positive"], "negative": body["negative"]}
    save_styles(path, styles)
    return web.json_response({"name": name})


async def delete_style(request):
    body = await request.json()
    name = body.get("name")
    if not isinstance(name, str) or not name.strip():
        return web.json_response({"error": "A style name is required"}, status=400)
    path = styles_path(request)
    styles = load_styles(path)
    if name not in styles:
        return web.json_response({"error": "Style not found"}, status=404)
    del styles[name]
    save_styles(path, styles)
    return web.json_response({"ok": True})


_server = getattr(PromptServer, "instance", None)
if _server is not None:
    _server.routes.get("/prompt_preset_builder/styles")(list_styles)
    _server.routes.post("/prompt_preset_builder/style")(put_style)
    _server.routes.post("/prompt_preset_builder/style/delete")(delete_style)
