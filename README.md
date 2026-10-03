# ComfyUI-PromptPresetBuilder

## Prompt Style Presets

A separate node for plain positive/negative style pairs, under `utils/prompt`.
The original **Prompt Preset Builder** remains available with its existing data.
The two editable text boxes are stacked positive above negative, with separate
`STRING` outputs.

Presets are kept in folders (e.g. one per model: `krea2`, `anima`). Pick a folder,
then a preset; the same name in different folders is a separate preset.
Choose **+ New folder...** in the folder list to start a new folder.

- **Save as** registers both text boxes under a new name in the current folder.
- **Load** replaces both text boxes with the selected preset for editing.
- **Save** updates the selected preset, or asks for a name when none is selected.
- **Rename** renames the selected preset.
- **Move** moves the selected preset to another folder; typing a new folder name
  creates it.
- **Delete** removes the preset while keeping the current text boxes. A folder with
  no presets left disappears.
- **Apply** follows Forge/WebUI style rules on both prompts: substitute the current
  text at `{prompt}`, or append the style with a comma when no placeholder exists.
  Apply additional styles in sequence to combine them.
- **Refresh** reloads styles saved by other nodes or workflows.

Selecting a name alone does not change the text. Edits do not change the library
until Save is clicked. Both Save and Save as ask before overwriting any existing
name, identifying the preset and the replacement of both prompts. Cancelling
keeps the text boxes unchanged. Load asks before replacing an edited draft,
and Delete asks for confirmation.

Styles are shared across workflows for the same ComfyUI user, in
`user/<user>/prompt_preset_builder/styles.json`, with the previous version kept
as `styles.json.bak`. Styles saved before folders existed appear in the
`Uncategorized` folder; the original file is kept as `styles.json.legacy`.
Existing Builder presets and Forge files are untouched.
The selected folder, name and current text boxes use normal workflow persistence.
Outputs preserve the text verbatim; connect a wildcard processor or text encoder
downstream if needed.

*[日本語版はこちら / Japanese version](README.ja.md)*

A ComfyUI node that splits a prompt into named **elements** and stores the whole
set as a named **preset** you can switch between.

## The node

**Prompt Preset Builder** (category `utils/prompt`)

- `+ Add element` adds one more pair of *label* + *prompt* fields. Labels are free text.
- One element is one row. **Only the row you click expands**, so the node stays compact.
- Drag the bottom-right corner of a prompt box to any height. **A height you set by
  hand is remembered** and survives losing focus (drag it back down to the bottom to
  return to a single line).
- Past 8 elements the **node stops growing and the list scrolls inside it**
  (`PPB_MAX_ROWS` in `web/prompt_preset_builder.js`).
- Widening the node widens the prompt boxes with it.
- `separator` / `seed` / `control_after_generate` are shown below the UI, since you
  rarely touch them. Only the display order is changed (`getLayoutWidgets()`); the
  order of the serialized values is untouched, so older workflows still load.
- Each element has a checkbox to include or exclude it.
- `↑` `↓` reorder elements. The output is joined in element order, so to insert
  something in the middle, add it at the end and move it up.
- Presets are **grouped by label** (e.g. `portrait` / `landscape`). Pick a label, then
  a preset: **choosing it loads it right away** — there is no Load button.
- `New` clears the elements back to a single empty row and deselects the preset.
  Pressing `Save` from there asks where to store it.
- `Save` **overwrites the selected preset silently**; it only asks for a destination
  when no preset is selected. Use `Save as` to store the elements under another name.
  You are asked to confirm only when the destination already exists.
- When the elements differ from the preset they came from, a `*` appears next to the
  preset name. Only while that `*` is showing do switching presets and `New` ask
  before discarding.
- **Presets under different labels are unrelated**, even with the same name
  (`portrait/basic` and `landscape/basic` are two separate presets). To put the same
  content under another label, load it and `Save as` into that label.
- The selected label and preset are remembered in the node and restored with the
  workflow.
- `⚙` opens the preset manager: **rename, move to another label, delete, and rename
  labels themselves**, all saved as you go. Moving or renaming onto an existing name
  asks to overwrite; renaming a label onto an existing one merges into it (with a
  confirmation listing the clashes). Labels that end up empty disappear.
- The output is a single STRING: the prompts of the enabled elements joined with
  `separator` (default `", "`). Elements that resolve to nothing are skipped, so you
  never get a stray separator.
- After a run, the string that was actually produced is shown at the bottom of the node.

## Tag autocomplete

The prompt boxes are built by the frontend's own **`ComfyWidgets.STRING` factory**.
Autocomplete extensions all work by wrapping that factory and attaching themselves to
the textareas it produces, so these boxes get the same treatment as the ones in
**CLIP Text Encode**. Nothing here is written against one particular extension.

Mechanically: call the factory, keep the textarea it built, throw the widget away.
`node.addDOMWidget` is swapped out for the duration of the call so the widget never
lands in `node.widgets` (the boxes are laid out per element by this node), and the
widget's `onRemove()` is called right away to detach the frontend's own bindings —
in particular a wheel handler that pushes the event straight to the canvas, which
would zoom the graph instead of scrolling the element list.

If the factory is unavailable, the node falls back to a plain textarea and — only
then — hooks up [ComfyUI-Autocomplete-Plus](https://github.com/newtextdoc1111/ComfyUI-Autocomplete-Plus)'s
`AutocompleteEventHandler` directly. Without it you just get one informational line
in the console.

## Random syntax

One option inside `{ }` is picked at random. `seed` makes the result reproducible
(`control_after_generate` is supported).

```
{|wavy hair|0.4::{|high|low|side} ponytail|0.3::{low|short} hair}
```

- `|` separates options, and empty options are allowed (above, "emit nothing" has a
  1/2.7 chance)
- `weight::option` weights an option (default `1.0`)
- Groups nest
- `\{` `\|` `\}` escape a literal character
- A missing `}` is treated as closing at the end of the text

ComfyUI's built-in `dynamicPrompts` (CLIPTextEncode and friends) only handles
`{a|b|c}` with no weights, so this node resolves the syntax itself in Python.

## Where the data lives

```
<ComfyUI>/user/<user>/prompt_preset_builder/presets.json
```

The path is resolved per request through ComfyUI's user manager, so a server started
with `--multi-user` gives **every profile its own preset file**. On a normal
single-user server the user is always `default`, i.e.
`user/default/prompt_preset_builder/presets.json`.

```json
{ "portrait": { "basic": [ {"label": "hair", "text": "long hair", "enabled": true} ] },
  "landscape": { "basic": [ ... ] } }
```

What gets embedded in a workflow is each node's current set of elements
(`preset_data`). The presets themselves live in the file above and are shared by all
workflows.

The pre-label format (`{"preset name": [elements...]}`) is migrated into the
`Uncategorized` label on first read, keeping the original as `presets.json.legacy`.

## Layout

| File | Role |
|---|---|
| `nodes.py` | the node itself (joins the elements) |
| `dynamic_prompt.py` | random syntax parser |
| `presets.py` | preset storage and HTTP API |
| `web/prompt_preset_builder.js` | the dynamic element UI |

## License

MIT — see [LICENSE](LICENSE).
