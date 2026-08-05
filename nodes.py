import json
import random

from .dynamic_prompt import resolve


class PromptPresetBuilder:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                # UI state (label / text / enabled per element). Hidden by the JS side.
                "preset_data": ("STRING", {"default": "[]"}),
                "separator": ("STRING", {"default": ", "}),
                "seed": ("INT", {
                    "default": 0, "min": 0, "max": 0xffffffffffffffff,
                    "control_after_generate": True,
                }),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("prompt",)
    FUNCTION = "build"
    CATEGORY = "utils/prompt"
    DESCRIPTION = "Build a prompt from named elements. Supports {a|b|0.4::c} syntax and named presets."

    def build(self, preset_data, separator, seed):
        try:
            rows = json.loads(preset_data) if preset_data.strip() else []
        except ValueError:
            rows = []
        if not isinstance(rows, list):
            rows = []

        rng = random.Random(seed)
        sep = separator.replace("\\n", "\n")

        parts = []
        for row in rows:
            if not isinstance(row, dict) or not row.get("enabled", True):
                continue
            text = resolve(str(row.get("text", "")), rng).strip().strip(",").strip()
            if text:
                parts.append(text)

        result = sep.join(parts)
        return {"ui": {"text": [result]}, "result": (result,)}


NODE_CLASS_MAPPINGS = {"PromptPresetBuilder": PromptPresetBuilder}
NODE_DISPLAY_NAME_MAPPINGS = {"PromptPresetBuilder": "Prompt Preset Builder"}
