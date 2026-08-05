"""Preset storage + HTTP API for the Prompt Preset Builder node.

All presets live in a single JSON file, grouped by label:
    <ComfyUI>/user/<user>/prompt_preset_builder/presets.json

    {"portrait": {"basic": [{"label": "hair", "text": "...", "enabled": true}]},
     "landscape": {"basic": [...]}}

Labels are independent: "portrait/basic" and "landscape/basic" are two separate
presets that happen to share a name.

The file is resolved per request through ComfyUI's user manager, so a server
started with --multi-user gives every profile its own presets. On a normal
single-user server the user is always "default", i.e. the same path as before.

The pre-label format was a flat {name: rows} mapping; it is migrated into
DEFAULT_LABEL on first read, keeping a copy of the original file.
"""

import json
import os

from aiohttp import web

import folder_paths
from server import PromptServer

DEFAULT_LABEL = "Uncategorized"
SUBDIR = "prompt_preset_builder"


def _presets_path(request=None):
    """Path to the presets file of the user this request belongs to.

    Falls back to the single-user location when there is no request to
    identify (or the user manager rejects the id), which is also what
    --multi-user servers use for the "default" profile.
    """
    manager = getattr(getattr(PromptServer, "instance", None), "user_manager", None)
    if request is not None and manager is not None:
        try:
            path = manager.get_request_user_filepath(request, SUBDIR + "/presets.json")
        except (KeyError, ValueError):
            path = None
        if path:
            return path

    d = os.path.join(folder_paths.get_user_directory(), "default", SUBDIR)
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, "presets.json")


def _read_raw(request=None):
    path = _presets_path(request)
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def load_all(request=None):
    """Return {label: {name: rows}}, migrating the legacy flat format."""
    raw = _read_raw(request)
    if not raw:
        return {}

    labels = {k: v for k, v in raw.items() if isinstance(v, dict)}
    legacy = {k: v for k, v in raw.items() if isinstance(v, list)}
    if not legacy:
        return labels

    group = labels.setdefault(DEFAULT_LABEL, {})
    for name, rows in legacy.items():
        group.setdefault(name, rows)

    # keep the pre-migration file around before rewriting it
    backup = _presets_path(request) + ".legacy"
    if not os.path.exists(backup):
        try:
            with open(backup, "w", encoding="utf-8") as f:
                json.dump(raw, f, ensure_ascii=False, indent=2)
        except OSError:
            pass
    save_all(labels, request)
    return labels


def save_all(data, request=None):
    path = _presets_path(request)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def _normalize_rows(rows):
    out = []
    for r in rows or []:
        if not isinstance(r, dict):
            continue
        row = {
            "label": str(r.get("label", "")),
            "text": str(r.get("text", "")),
            "enabled": bool(r.get("enabled", True)),
        }
        # optional: the height the user dragged the prompt box to (UI only)
        try:
            h = float(r.get("h"))
            if h > 0:
                row["h"] = h
        except (TypeError, ValueError):
            pass
        out.append(row)
    return out


_server = getattr(PromptServer, "instance", None)

if _server is not None:
    routes = _server.routes

    @routes.get("/prompt_preset_builder/presets")
    async def _list_presets(request):
        data = load_all(request)
        return web.json_response({
            "labels": {label: sorted(names.keys()) for label, names in sorted(data.items())},
            "default_label": DEFAULT_LABEL,
        })

    @routes.get("/prompt_preset_builder/preset")
    async def _get_preset(request):
        label = request.query.get("label", "")
        name = request.query.get("name", "")
        data = load_all(request)
        rows = data.get(label, {}).get(name)
        if rows is None:
            return web.json_response({"error": "not found"}, status=404)
        return web.json_response({"label": label, "name": name, "rows": _normalize_rows(rows)})

    @routes.post("/prompt_preset_builder/preset")
    async def _save_preset(request):
        body = await request.json()
        label = str(body.get("label", "")).strip() or DEFAULT_LABEL
        name = str(body.get("name", "")).strip()
        if not name:
            return web.json_response({"error": "empty name"}, status=400)
        data = load_all(request)
        data.setdefault(label, {})[name] = _normalize_rows(body.get("rows"))
        save_all(data, request)
        return web.json_response({"ok": True, "label": label, "name": name})

    @routes.post("/prompt_preset_builder/preset/move")
    async def _move_preset(request):
        """Move and/or rename one preset. Renaming in place is the same call."""
        body = await request.json()
        src = body.get("from") or {}
        dst = body.get("to") or {}
        s_label = str(src.get("label", "")).strip()
        s_name = str(src.get("name", "")).strip()
        d_label = str(dst.get("label", "")).strip() or DEFAULT_LABEL
        d_name = str(dst.get("name", "")).strip()
        if not d_name:
            return web.json_response({"error": "empty name"}, status=400)

        data = load_all(request)
        group = data.get(s_label) or {}
        if s_name not in group:
            return web.json_response({"error": "not found"}, status=404)
        if (s_label, s_name) != (d_label, d_name):
            if d_name in (data.get(d_label) or {}) and not body.get("overwrite"):
                return web.json_response({"error": "exists"}, status=409)

        rows = group.pop(s_name)
        if not group:  # the label lost its last preset
            data.pop(s_label, None)
        data.setdefault(d_label, {})[d_name] = rows
        save_all(data, request)
        return web.json_response({"ok": True, "label": d_label, "name": d_name})

    @routes.post("/prompt_preset_builder/label/rename")
    async def _rename_label(request):
        """Rename a label. Renaming onto an existing label merges into it."""
        body = await request.json()
        old = str(body.get("from", "")).strip()
        new = str(body.get("to", "")).strip()
        if not new:
            return web.json_response({"error": "empty name"}, status=400)
        data = load_all(request)
        if old not in data:
            return web.json_response({"error": "not found"}, status=404)
        if old == new:
            return web.json_response({"ok": True, "label": new})

        target = data.get(new) or {}
        clash = sorted(set(target) & set(data[old]))
        if clash and not body.get("overwrite"):
            return web.json_response({"error": "exists", "conflicts": clash}, status=409)

        moved = data.pop(old)
        data.setdefault(new, {}).update(moved)
        save_all(data, request)
        return web.json_response({"ok": True, "label": new})

    @routes.post("/prompt_preset_builder/preset/delete")
    async def _delete_preset(request):
        body = await request.json()
        label = str(body.get("label", "")).strip()
        name = str(body.get("name", "")).strip()
        data = load_all(request)
        group = data.get(label)
        if group and name in group:
            del group[name]
            if not group:  # drop the label once it holds nothing
                del data[label]
            save_all(data, request)
        return web.json_response({"ok": True})
