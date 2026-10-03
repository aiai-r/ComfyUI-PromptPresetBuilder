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


DEFAULT_FOLDER = "Uncategorized"


def is_style(value):
    return (isinstance(value, dict)
            and isinstance(value.get("positive"), str)
            and isinstance(value.get("negative"), str))


def load_styles(path):
    """Return {folder: {name: style}}, reading the old flat file into DEFAULT_FOLDER."""
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (UnicodeError, ValueError) as error:
        raise web.HTTPConflict(reason="Invalid styles.json; restore it before saving") from error
    if not isinstance(data, dict):
        raise web.HTTPConflict(reason="Invalid styles.json; restore it before saving")
    if data and all(is_style(value) for value in data.values()):
        # keep the pre-folder file; the next save writes the new format
        legacy = path.with_suffix(".json.legacy")
        if not legacy.exists():
            shutil.copy2(path, legacy)
        return {DEFAULT_FOLDER: data}
    if any(not isinstance(folder, dict) or not all(is_style(value) for value in folder.values())
           for folder in data.values()):
        raise web.HTTPConflict(reason="Invalid styles.json; restore it before saving")
    return data


def save_styles(path, styles):
    styles = {folder: items for folder, items in styles.items() if items}
    pending = path.with_suffix(".json.tmp")
    pending.write_text(json.dumps(styles, ensure_ascii=False, indent=2), encoding="utf-8")
    if path.exists():
        shutil.copy2(path, path.with_suffix(".json.bak"))
    os.replace(pending, path)


def read_key(body, key):
    value = body.get(key)
    if not isinstance(value, str) or not value.strip():
        return None
    return value.strip()


async def list_styles(request):
    return web.json_response({"styles": load_styles(styles_path(request))})


async def put_style(request):
    body = await request.json()
    folder, name = read_key(body, "folder"), read_key(body, "name")
    if not folder or not name:
        return web.json_response({"error": "A folder and a style name are required"}, status=400)
    if not all(isinstance(body.get(key), str) for key in ("positive", "negative")):
        return web.json_response({"error": "Positive and negative must be text"}, status=400)
    path = styles_path(request)
    styles = load_styles(path)
    if name in styles.get(folder, {}) and body.get("overwrite") is not True:
        return web.json_response({"error": "A style with this name already exists"}, status=409)
    styles.setdefault(folder, {})[name] = {"positive": body["positive"], "negative": body["negative"]}
    save_styles(path, styles)
    return web.json_response({"folder": folder, "name": name})


async def delete_style(request):
    body = await request.json()
    folder, name = body.get("folder"), body.get("name")
    path = styles_path(request)
    styles = load_styles(path)
    if not isinstance(folder, str) or not isinstance(name, str) or name not in styles.get(folder, {}):
        return web.json_response({"error": "Style not found"}, status=404)
    del styles[folder][name]
    save_styles(path, styles)
    return web.json_response({"ok": True})


async def move_style(request):
    """Rename a style, move it to another folder, or both; with "copy" the original stays."""
    body = await request.json()
    folder, name = body.get("folder"), body.get("name")
    to_folder, to_name = read_key(body, "to_folder"), read_key(body, "to_name")
    if not to_folder or not to_name:
        return web.json_response({"error": "A folder and a style name are required"}, status=400)
    path = styles_path(request)
    styles = load_styles(path)
    if not isinstance(folder, str) or not isinstance(name, str) or name not in styles.get(folder, {}):
        return web.json_response({"error": "Style not found"}, status=404)
    if (folder, name) == (to_folder, to_name):
        return web.json_response({"folder": to_folder, "name": to_name})
    if to_name in styles.get(to_folder, {}) and body.get("overwrite") is not True:
        return web.json_response({"error": "A style with this name already exists"}, status=409)
    style = styles[folder][name] if body.get("copy") is True else styles[folder].pop(name)
    styles.setdefault(to_folder, {})[to_name] = dict(style)
    save_styles(path, styles)
    return web.json_response({"folder": to_folder, "name": to_name})


_server = getattr(PromptServer, "instance", None)
if _server is not None:
    _server.routes.get("/prompt_preset_builder/styles")(list_styles)
    _server.routes.post("/prompt_preset_builder/style")(put_style)
    _server.routes.post("/prompt_preset_builder/style/delete")(delete_style)
    _server.routes.post("/prompt_preset_builder/style/move")(move_style)
