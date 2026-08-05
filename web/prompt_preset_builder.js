import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_NAME = "PromptPresetBuilder";

// how many elements stay visible before the list starts scrolling
const PPB_MAX_ROWS = 8;

// layout metrics (px) - the height is computed from these, never measured from
// the DOM: the element is inside a box we size ourselves, so measuring it would
// just feed our own (collapsed) value back in.
const ROW_H = 22;          // collapsed prompt box
const EXPANDED_H = 72;     // while it has focus (unless dragged to a size)
const ROW_GAP = 3;
const BAR_H = 22;
const ADD_H = 22;
const PREVIEW_H = 20;
// padding + label/preset bar + button bar + add button + preview
const CHROME_H = 8 + BAR_H + 4 + BAR_H + 4 + 4 + ADD_H + 4 + PREVIEW_H;
// the list never claims more than this - past it the node stops growing and
// the elements scroll inside it
const MAX_LIST_H = PPB_MAX_ROWS * ROW_H + (PPB_MAX_ROWS - 1) * ROW_GAP;

const STYLE = `
.ppb-root { display:flex; flex-direction:column; gap:4px; padding:4px; box-sizing:border-box;
            width:100%; height:100%; font-family:inherit; font-size:12px;
            color:var(--input-text,#ddd); overflow:hidden; }
/* only the row list may absorb/give up space, everything else keeps its height */
.ppb-root > .ppb-bar, .ppb-root > button, .ppb-root > .ppb-preview, .ppb-row { flex:none; }
.ppb-bar { display:flex; gap:4px; align-items:center; }
.ppb-bar select { flex:1; min-width:0; background:var(--comfy-input-bg,#222); color:var(--input-text,#ddd);
                  border:1px solid var(--border-color,#444); border-radius:4px; padding:2px; height:22px; }
/* "*" while the elements differ from the preset they came from */
.ppb-dirty { flex:none; width:9px; text-align:center; opacity:.85; }
.ppb-root button { background:var(--comfy-input-bg,#222); color:var(--input-text,#ddd);
                   border:1px solid var(--border-color,#444); border-radius:4px; cursor:pointer;
                   padding:2px 6px; height:22px; font-size:11px; white-space:nowrap; }
.ppb-root button:hover { filter:brightness(1.4); }
.ppb-root button:disabled { opacity:.3; cursor:default; filter:none; }
/* the per-row move/remove buttons: keep them narrow, the prompt box needs the space */
.ppb-root button.ppb-mini { padding:2px 3px; min-width:17px; }
/* one element = one line, list scrolls once it passes PPB_MAX_ROWS entries */
.ppb-rows { display:flex; flex-direction:column; gap:3px; overflow-y:auto; overflow-x:hidden;
            padding-right:2px; flex:1 1 auto; min-height:0; }
.ppb-row { display:flex; align-items:flex-start; gap:4px; }
.ppb-root input[type=text], .ppb-root textarea {
    background:var(--comfy-input-bg,#222); color:var(--input-text,#ddd);
    border:1px solid var(--border-color,#444); border-radius:4px; padding:2px 4px;
    font-family:inherit; font-size:12px; box-sizing:border-box; height:22px; }
.ppb-label { width:84px; flex:none; }
/* height is driven from JS (collapsed / focused / dragged), so no :focus rule
   here - an inline height set by dragging the corner must win and stick */
/* the box may also carry .comfy-multiline-input (it comes from the frontend's
   own widget factory), whose rules set resize:none / border:none / padding:2px -
   same specificity, so qualify ours to make sure it wins either way */
.ppb-root textarea.ppb-text { flex:1; min-width:0; resize:vertical; overflow:auto;
            white-space:pre-wrap; line-height:16px; padding:2px 4px;
            border:1px solid var(--border-color,#444); font-size:12px; }
.ppb-preview { border-top:1px dashed var(--border-color,#444); padding-top:3px; opacity:.75;
               font-size:11px; white-space:pre-wrap; word-break:break-word;
               min-height:14px; max-height:80px; overflow:auto; }

/* --- preset manager modal (lives on document.body, above the canvas) --- */
.ppb-modal-back { position:fixed; inset:0; background:rgba(0,0,0,.55); z-index:10000;
                  display:flex; align-items:center; justify-content:center; }
.ppb-modal { background:var(--comfy-menu-bg,#252525); color:var(--input-text,#ddd);
             border:1px solid var(--border-color,#444); border-radius:8px; padding:12px;
             width:min(560px, 92vw); max-height:86vh; display:flex; flex-direction:column;
             gap:8px; font-family:inherit; font-size:13px; box-shadow:0 8px 32px rgba(0,0,0,.5); }
.ppb-modal h2 { margin:0; font-size:15px; font-weight:600; }
.ppb-modal-head { display:flex; align-items:center; justify-content:space-between; gap:8px; }
.ppb-modal .ppb-hint { margin:0; font-size:11px; opacity:.7; line-height:1.5; }
.ppb-modal-bar { display:flex; gap:6px; align-items:center; }
.ppb-modal-list { flex:1 1 auto; min-height:60px; overflow:auto; border:1px solid var(--border-color,#444);
                  border-radius:6px; padding:6px; display:flex; flex-direction:column; gap:4px; }
.ppb-modal-row { display:flex; gap:6px; align-items:center; }
.ppb-modal-row input[type=text] { flex:1; min-width:0; }
.ppb-modal-field { display:flex; gap:6px; align-items:center; }
.ppb-modal-field > span { flex:none; width:80px; opacity:.8; font-size:12px; }
.ppb-modal-field input[type=text] { flex:1; min-width:0; }
.ppb-modal-foot { display:flex; justify-content:space-between; align-items:center; gap:8px; }
.ppb-modal input[type=text], .ppb-modal select {
    background:var(--comfy-input-bg,#222); color:var(--input-text,#ddd);
    border:1px solid var(--border-color,#444); border-radius:4px; padding:3px 5px;
    font-family:inherit; font-size:12px; box-sizing:border-box; height:24px; }
.ppb-modal button { background:var(--comfy-input-bg,#222); color:var(--input-text,#ddd);
                    border:1px solid var(--border-color,#444); border-radius:4px; cursor:pointer;
                    padding:3px 8px; height:24px; font-size:12px; white-space:nowrap; }
.ppb-modal button:hover { filter:brightness(1.4); }
.ppb-modal-empty { opacity:.6; font-size:12px; padding:6px; }
`;

const PROMPT_PLACEHOLDER = "prompt  {a|b|0.4::c} ok";

// --- prompt box -----------------------------------------------------------
// Autocomplete extensions (Autocomplete Plus, Custom Scripts, ...) hook the
// frontend's ComfyWidgets.STRING factory and attach themselves to every
// textarea it produces - that is why they work on CLIP Text Encode out of the
// box. A textarea we build ourselves never passes through there, so we borrow
// the factory instead: we let it build the element, then throw the widget away.
//
// Feeding it our own addDOMWidget keeps the widget out of node.widgets (we lay
// the boxes out ourselves, one per element), and calling the widget's onRemove
// detaches the frontend's own bindings - notably a wheel handler that pushes
// the event straight to the canvas, which would zoom the graph instead of
// scrolling our element list.
function createPromptBox(node) {
    const factory = window.comfyAPI?.widgets?.ComfyWidgets;
    if (typeof factory?.STRING === "function" && typeof node.addDOMWidget === "function") {
        const owned = Object.prototype.hasOwnProperty.call(node, "addDOMWidget");
        const original = node.addDOMWidget;
        let widget = null;
        node.addDOMWidget = (name, type, el, options) => {
            widget = { name, type, element: el, options: options || {},
                       value: el.value, callback: null };
            return widget;
        };
        try {
            // "text" is the input name CLIP Text Encode uses, so extensions that
            // key their settings off the input name treat these boxes the same
            factory.STRING(node, "text", ["STRING", {
                multiline: true, default: "", placeholder: PROMPT_PLACEHOLDER,
            }], app);
        } catch (e) {
            console.warn("[PromptPresetBuilder] ComfyWidgets.STRING failed, using a"
                         + " plain prompt box (autocomplete extensions may not attach)", e);
            widget = null;
        } finally {
            if (owned) node.addDOMWidget = original;
            else delete node.addDOMWidget;
        }
        if (widget?.element) {
            try { widget.onRemove?.(); } catch (e) { /* nothing was bound */ }
            return { el: widget.element, viaFactory: true };
        }
    }
    return { el: document.createElement("textarea"), viaFactory: false };
}

// --- Autocomplete Plus (fallback path only) --------------------------------
// That extension only attaches itself to textareas built by ComfyWidgets.STRING,
// so our hand-built boxes never get it. Borrow its event handler and wire it up
// ourselves. Resolve the module through the extension list so we import the very
// same URL it was loaded from - a different path would give us a second module
// instance with no tag data and none of the user's settings.
let acHandlerPromise = null;

function getAutocompleteHandler() {
    if (acHandlerPromise) return acHandlerPromise;
    acHandlerPromise = (async () => {
        try {
            const list = (await api.getExtensions()) || [];
            const main = list.find((u) => /autocomplete.*plus.*\/main\.js$/i.test(u));
            const base = main
                ? main.replace(/main\.js(\?.*)?$/i, "")
                : "/extensions/comfyui-autocomplete-plus/js/";
            const mod = await import(base + "autocomplete.js");
            return new mod.AutocompleteEventHandler();
        } catch (e) {
            console.info("[PromptPresetBuilder] Autocomplete Plus not available:", e?.message ?? e);
            return null;
        }
    })();
    return acHandlerPromise;
}

const AC_EVENTS = {
    input: "handleInput",
    focus: "handleFocus",
    blur: "handleBlur",
    keydown: "handleKeyDown",
    keyup: "handleKeyUp",
    mousemove: "handleMouseMove",
    click: "handleClick",
};

function attachAutocomplete(el) {
    getAutocompleteHandler().then((h) => {
        if (!h || !el.isConnected) return;
        for (const [ev, method] of Object.entries(AC_EVENTS)) {
            if (typeof h[method] === "function") {
                el.addEventListener(ev, (e) => h[method](e));
            }
        }
    });
}

function injectStyle() {
    if (document.getElementById("ppb-style")) return;
    const s = document.createElement("style");
    s.id = "ppb-style";
    s.textContent = STYLE;
    document.head.appendChild(s);
}

function hideWidget(w) {
    if (!w) return;
    w.hidden = true;
    w.type = "hidden";
    w.computeSize = () => [0, -4];
}

// Keyboard/pointer events inside inputs must not reach the canvas
// (otherwise Delete removes the node, space pans, etc.)
function isolate(el) {
    for (const ev of ["keydown", "keyup", "keypress", "pointerdown", "wheel"]) {
        el.addEventListener(ev, (e) => e.stopPropagation());
    }
}

// --- preset manager modal -------------------------------------------------
// One modal for the whole page: the preset file is shared by every node, so
// after each edit all open nodes refresh their dropdowns.
const NEW_LABEL = "\u0000new";   // sentinel option value, cannot collide with a label

async function apiJson(path, body) {
    const r = await api.fetchApi("/prompt_preset_builder" + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    let data = null;
    try { data = await r.json(); } catch (e) { /* empty body */ }
    return { ok: r.ok, status: r.status, data };
}

function refreshAllNodes() {
    for (const n of app.graph?.nodes ?? []) n.ppbRefreshPresets?.();
}

// Ask for a save destination in one dialog. The label field is a datalist
// input so an existing label can be picked from the list or a new one simply
// typed. Resolves to {label, name} or null when cancelled.
function askPreset(title, initLabel, initName, labels) {
    return new Promise((resolve) => {
        const back = document.createElement("div");
        back.className = "ppb-modal-back";
        const box = document.createElement("div");
        box.className = "ppb-modal";
        box.style.width = "min(380px, 92vw)";
        back.appendChild(box);

        for (const ev of ["keydown", "keyup", "keypress", "pointerdown", "wheel"]) {
            back.addEventListener(ev, (e) => e.stopPropagation());
        }

        const head = document.createElement("div");
        head.className = "ppb-modal-head";
        const h = document.createElement("h2");
        h.textContent = title;
        head.append(h);

        const listId = "ppb-labels-" + Math.random().toString(36).slice(2);
        const datalist = document.createElement("datalist");
        datalist.id = listId;
        for (const l of labels) datalist.appendChild(new Option(l, l));

        const field = (caption, value, list) => {
            const wrap = document.createElement("div");
            wrap.className = "ppb-modal-field";
            const cap = document.createElement("span");
            cap.textContent = caption;
            const input = document.createElement("input");
            input.type = "text";
            input.spellcheck = false;
            input.value = value || "";
            if (list) input.setAttribute("list", list);
            wrap.append(cap, input);
            return { wrap, input };
        };
        const label = field("Label", initLabel, listId);
        const name = field("Preset name", initName, null);
        label.wrap.appendChild(datalist);

        const foot = document.createElement("div");
        foot.className = "ppb-modal-foot";
        const buttons = document.createElement("div");
        buttons.style.display = "flex";
        buttons.style.gap = "6px";
        const btnCancel = document.createElement("button");
        btnCancel.textContent = "Cancel";
        const btnOk = document.createElement("button");
        btnOk.textContent = "OK";
        buttons.append(btnCancel, btnOk);
        foot.append(document.createElement("span"), buttons);

        let done = false;
        const finish = (value) => {
            if (done) return;
            done = true;
            back.remove();
            document.removeEventListener("keydown", onKey, true);
            resolve(value);
        };
        const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); finish(null); } };
        const submit = () => {
            const n = name.input.value.trim();
            if (!n) { name.input.focus(); return; }
            finish({ label: label.input.value.trim(), name: n });
        };
        document.addEventListener("keydown", onKey, true);
        back.addEventListener("mousedown", (e) => { if (e.target === back) finish(null); });
        btnCancel.addEventListener("click", () => finish(null));
        btnOk.addEventListener("click", submit);
        for (const el of [label.input, name.input]) {
            el.addEventListener("keydown", (e) => {
                if (e.key === "Enter") { e.preventDefault(); submit(); }
            });
        }

        box.append(head, label.wrap, name.wrap, foot);
        document.body.appendChild(back);
        name.input.focus();
        name.input.select();
    });
}

function openPresetManager() {
    let index = {};        // { label: [name, ...] }
    let current = "";      // selected label

    const back = document.createElement("div");
    back.className = "ppb-modal-back";
    const box = document.createElement("div");
    box.className = "ppb-modal";
    back.appendChild(box);

    // keep every key and wheel event away from the graph canvas
    for (const ev of ["keydown", "keyup", "keypress", "pointerdown", "wheel"]) {
        back.addEventListener(ev, (e) => e.stopPropagation());
    }
    const onEsc = (e) => { if (e.key === "Escape") close(); };
    back.addEventListener("keydown", onEsc);
    back.addEventListener("mousedown", (e) => { if (e.target === back) close(); });

    function close() {
        back.remove();
        document.removeEventListener("keydown", onEsc, true);
        refreshAllNodes();
    }
    document.addEventListener("keydown", onEsc, true);

    const head = document.createElement("div");
    head.className = "ppb-modal-head";
    const title = document.createElement("h2");
    title.textContent = "Preset manager";
    const btnClose = document.createElement("button");
    btnClose.textContent = "✕";
    btnClose.addEventListener("click", close);
    head.append(title, btnClose);

    const hint = document.createElement("p");
    hint.className = "ppb-hint";
    hint.textContent = "Pick a label to list its presets. Edit a name in place "
        + "(Enter or clicking away commits it), use the dropdown to move a preset to "
        + "another label, or Del to remove it. Every change is saved immediately.";

    const bar = document.createElement("div");
    bar.className = "ppb-modal-bar";
    const labelSelect = document.createElement("select");
    labelSelect.style.flex = "1";
    const btnRenameLabel = document.createElement("button");
    btnRenameLabel.textContent = "✎ Rename label";
    bar.append(labelSelect, btnRenameLabel);

    const list = document.createElement("div");
    list.className = "ppb-modal-list";

    const foot = document.createElement("div");
    foot.className = "ppb-modal-foot";
    const count = document.createElement("span");
    count.className = "ppb-hint";
    foot.append(count);

    box.append(head, hint, bar, list, foot);
    document.body.appendChild(back);

    function labelOptions(select, selected, withNew) {
        select.innerHTML = "";
        for (const l of Object.keys(index)) select.add(new Option(l, l));
        if (selected && !(selected in index)) select.add(new Option(selected, selected));
        if (withNew) select.add(new Option("+ New label...", NEW_LABEL));
        select.value = selected;
    }

    async function reload(keepLabel) {
        const r = await api.fetchApi("/prompt_preset_builder/presets");
        const data = await r.json();
        if (!data.labels) {
            console.error("[PromptPresetBuilder] the server is running an older "
                          + "version of this node - restart ComfyUI");
            return;
        }
        index = data.labels;
        const labels = Object.keys(index);
        current = keepLabel && labels.includes(keepLabel) ? keepLabel : (labels[0] ?? "");
        labelOptions(labelSelect, current, false);
        render();
    }

    // move / rename in one call; asks before overwriting an existing entry
    async function move(from, to) {
        let res = await apiJson("/preset/move", { from, to });
        if (res.status === 409) {
            const msg = `"${to.label} / ${to.name}" already exists. Overwrite it?`;
            if (!window.confirm(msg)) return false;
            res = await apiJson("/preset/move", { from, to, overwrite: true });
        }
        if (!res.ok) {
            console.error("[PromptPresetBuilder] move failed", res.status, res.data);
            return false;
        }
        await reload(to.label);
        refreshAllNodes();
        return true;
    }

    function row(name) {
        const el = document.createElement("div");
        el.className = "ppb-modal-row";

        const input = document.createElement("input");
        input.type = "text";
        input.value = name;
        input.spellcheck = false;

        const arrow = document.createElement("span");
        arrow.className = "ppb-hint";
        arrow.textContent = "→";

        const target = document.createElement("select");
        labelOptions(target, current, true);

        const del = document.createElement("button");
        del.textContent = "Del";

        const rename = async () => {
            const now = input.value.trim();
            if (!now || now === name) { input.value = name; return; }
            if (!(await move({ label: current, name }, { label: current, name: now }))) {
                input.value = name;
            }
        };
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") { e.preventDefault(); input.blur(); }
        });
        input.addEventListener("blur", rename);

        target.addEventListener("change", async () => {
            let dest = target.value;
            if (dest === NEW_LABEL) {
                dest = (window.prompt("New label name") || "").trim();
                if (!dest) { target.value = current; return; }
            }
            if (dest === current) return;
            if (!(await move({ label: current, name }, { label: dest, name }))) {
                target.value = current;
            }
        });

        del.addEventListener("click", async () => {
            if (!window.confirm(`Delete "${current} / ${name}" ?`)) return;
            await apiJson("/preset/delete", { label: current, name });
            await reload(current);
            refreshAllNodes();
        });

        el.append(input, arrow, target, del);
        return el;
    }

    function render() {
        list.innerHTML = "";
        const names = index[current] ?? [];
        if (!names.length) {
            const empty = document.createElement("div");
            empty.className = "ppb-modal-empty";
            empty.textContent = "No presets under this label.";
            list.appendChild(empty);
        } else {
            for (const n of names) list.appendChild(row(n));
        }
        count.textContent = names.length === 1 ? "1 preset" : `${names.length} presets`;
    }

    labelSelect.addEventListener("change", () => { current = labelSelect.value; render(); });

    btnRenameLabel.addEventListener("click", async () => {
        if (!current) return;
        const to = (window.prompt("Label name", current) || "").trim();
        if (!to || to === current) return;
        let res = await apiJson("/label/rename", { from: current, to });
        if (res.status === 409) {
            const clash = (res.data?.conflicts ?? []).join(", ");
            const msg = `"${to}" already holds presets with the same name (${clash}). `
                + "Merge and overwrite them?";
            if (!window.confirm(msg)) return;
            res = await apiJson("/label/rename", { from: current, to, overwrite: true });
        }
        if (!res.ok) {
            console.error("[PromptPresetBuilder] label rename failed", res.status, res.data);
            return;
        }
        await reload(to);
        refreshAllNodes();
    });

    reload();
}

function setupNode(node) {
    injectStyle();

    const dataWidget = node.widgets.find((w) => w.name === "preset_data");
    hideWidget(dataWidget);

    node.ppbRows = [];
    // the row set we know is already stored (see markSaved / isDirty below)
    let savedSnapshot = "[]";

    const root = document.createElement("div");
    root.className = "ppb-root";

    // --- preset bar: label -> preset, then the buttons --------------------
    const bar = document.createElement("div");
    bar.className = "ppb-bar";
    const labelSelect = document.createElement("select");
    const select = document.createElement("select");
    isolate(labelSelect);
    isolate(select);
    const dirtyMark = document.createElement("span");
    dirtyMark.className = "ppb-dirty";
    dirtyMark.title = "unsaved changes";
    bar.append(labelSelect, select, dirtyMark);

    const bar2 = document.createElement("div");
    bar2.className = "ppb-bar";
    const btnNew = mkButton("New");
    const btnSave = mkButton("Save");
    const btnSaveAs = mkButton("Save as");
    const btnManage = mkButton("⚙");
    btnNew.title = "start over with an empty element list";
    btnSave.title = "overwrite the selected preset";
    btnSaveAs.title = "store the elements under another name";
    btnManage.title = "manage presets (rename / move / delete)";
    for (const b of [btnNew, btnSave, btnSaveAs]) b.style.flex = "1";
    btnManage.addEventListener("click", openPresetManager);
    bar2.append(btnNew, btnSave, btnSaveAs, btnManage);

    // --- rows -------------------------------------------------------------
    const rowsEl = document.createElement("div");
    rowsEl.className = "ppb-rows";
    // scroll the list instead of zooming the canvas, but only while it can scroll
    rowsEl.addEventListener("wheel", (e) => {
        if (rowsEl.scrollHeight > rowsEl.clientHeight) e.stopPropagation();
    });

    const btnAdd = mkButton("+ Add element");
    const preview = document.createElement("div");
    preview.className = "ppb-preview";

    root.append(bar, bar2, rowsEl, btnAdd, preview);

    function minBodyHeight() {
        const rows = node.ppbRows;
        if (!rows.length) return CHROME_H + ROW_H;
        let h = (rows.length - 1) * ROW_GAP;
        for (const r of rows) h += r.h > ROW_H ? r.h : ROW_H;
        return CHROME_H + Math.min(MAX_LIST_H, h);
    }

    // The frontend sizes DOM widgets from getMinHeight() (default: 50px) and
    // hands out any space left over in the node up to getMaxHeight(). Leaving
    // the max open lets the row list absorb whatever the user gains by dragging
    // the node taller. Do NOT set widget.computeSize here: it takes priority
    // over this path and would pin the widget to a fixed height.
    const widget = node.addDOMWidget("ppb_ui", "ppb", root, {
        serialize: false,
        hideOnZoom: false,
        getMinHeight: () => minBodyHeight(),
    });

    // The element is laid out as `widget.width ?? node.width`, and a stale
    // widget.width leaves the UI narrower than the node the user just widened.
    // A DOM widget has no width of its own, so always defer to the node.
    try {
        Object.defineProperty(widget, "width", {
            get: () => undefined,
            set: () => {},
            configurable: true,
        });
    } catch (e) {
        console.warn("[PromptPresetBuilder] could not free the widget width", e);
    }

    // Show the UI above separator / seed / control_after_generate. Only the
    // layout order is changed: reordering node.widgets itself would shift the
    // saved widgets_values (they are written by index but read back by
    // position), which would corrupt older workflows.
    const baseLayoutWidgets = node.getLayoutWidgets;
    node.getLayoutWidgets = function () {
        const list = baseLayoutWidgets
            ? baseLayoutWidgets.call(this)
            : (this.widgets ?? []).filter((w) => !w.hidden);
        const i = list.indexOf(widget);
        if (i > 0) {
            list.splice(i, 1);
            list.unshift(widget);
        }
        return list;
    };

    function mkButton(label) {
        const b = document.createElement("button");
        b.textContent = label;
        isolate(b);
        return b;
    }

    function sync() {
        if (dataWidget) dataWidget.value = JSON.stringify(node.ppbRows);
        updateDirty();
    }

    // --- unsaved changes --------------------------------------------------
    // Picking a preset from the dropdown replaces the elements outright, so we
    // need to know whether anything would be lost. `savedSnapshot` holds the
    // rows as they were last stored - or, right after a workflow is opened,
    // whatever that workflow carries (nothing is at risk there yet).
    function snapshot() { return JSON.stringify(node.ppbRows); }
    function isDirty() { return snapshot() !== savedSnapshot; }
    function updateDirty() { dirtyMark.textContent = isDirty() ? "*" : ""; }
    function markSaved() { savedSnapshot = snapshot(); updateDirty(); }
    function confirmDiscard() {
        return !isDirty() || window.confirm("This node has unsaved changes. Discard them?");
    }

    // `snap` refits the node to its content; otherwise only grow, so a node the
    // user dragged taller keeps the extra room
    function resize(snap) {
        const fit = node.computeSize()[1];
        node.setSize([node.size[0], snap ? fit : Math.max(fit, node.size[1])]);
        node.setDirtyCanvas(true, true);
    }

    function moveRow(from, to) {
        if (to < 0 || to >= node.ppbRows.length) return;
        const [row] = node.ppbRows.splice(from, 1);
        node.ppbRows.splice(to, 0, row);
        renderRows(); sync();
    }

    function renderRows() {
        rowsEl.innerHTML = "";
        node.ppbRows.forEach((row, idx) => {
            const el = document.createElement("div");
            el.className = "ppb-row";

            const chk = document.createElement("input");
            chk.type = "checkbox";
            chk.checked = row.enabled !== false;
            chk.title = "include this element in the output";
            isolate(chk);
            chk.addEventListener("change", () => { row.enabled = chk.checked; sync(); });

            const label = document.createElement("input");
            label.type = "text";
            label.className = "ppb-label";
            label.placeholder = "label";
            label.value = row.label || "";
            isolate(label);
            label.addEventListener("input", () => { row.label = label.value; sync(); });

            const built = createPromptBox(node);
            const text = built.el;
            text.classList.add("ppb-text");
            text.placeholder = PROMPT_PLACEHOLDER;
            text.value = row.text || "";
            text.title = row.text || "";
            isolate(text);
            text.addEventListener("input", () => {
                row.text = text.value;
                text.title = text.value;
                sync();
            });

            // Height: collapsed by default, taller while focused, and whatever
            // the user dragged the corner to once they have done so (row.h).
            let expected = row.h > 0 ? row.h : ROW_H;
            text.style.height = expected + "px";
            const setH = (h) => { expected = h; text.style.height = h + "px"; };

            text.addEventListener("focus", () => {
                if (!(row.h > 0)) setH(EXPANDED_H);
                // keep the box in view when it grows near the bottom edge
                text.scrollIntoView({ block: "nearest" });
            });
            text.addEventListener("blur", () => {
                if (!(row.h > 0)) setH(ROW_H);
                // safety net: pick up anything written into the box by another
                // extension (autocomplete insertions) that we might have missed
                if (row.text !== text.value) {
                    row.text = text.value;
                    text.title = text.value;
                    sync();
                }
            });

            // the factory-built box is already wired by whatever autocomplete
            // extensions are installed; only the fallback needs our own hookup
            if (!built.viaFactory) attachAutocomplete(text);

            // a height we did not set ourselves means the user dragged it
            new ResizeObserver(() => {
                const h = text.offsetHeight;
                if (!h || Math.abs(h - expected) <= 1) return;
                expected = h;
                if (h <= ROW_H + 6) delete row.h;   // dragged back down -> auto again
                else row.h = h;
                sync();
                resize();
            }).observe(text);

            // the output follows the element order, so reordering is an edit
            const up = mkButton("↑");
            up.className = "ppb-mini";
            up.title = "move this element up";
            up.disabled = idx === 0;
            up.addEventListener("click", () => moveRow(idx, idx - 1));

            const down = mkButton("↓");
            down.className = "ppb-mini";
            down.title = "move this element down";
            down.disabled = idx === node.ppbRows.length - 1;
            down.addEventListener("click", () => moveRow(idx, idx + 1));

            const del = mkButton("x");
            del.className = "ppb-mini";
            del.title = "remove this element";
            del.addEventListener("click", () => {
                node.ppbRows.splice(idx, 1);
                renderRows(); sync(); resize(true);
            });

            el.append(chk, label, text, up, down, del);
            rowsEl.appendChild(el);
        });
    }

    node.ppbRender = () => { renderRows(); resize(); };
    node.ppbSetPreview = (t) => { preview.textContent = t || ""; };

    node.ppbLoadFromWidget = () => {
        let rows = [];
        try { rows = JSON.parse(dataWidget?.value || "[]"); } catch (e) { rows = []; }
        node.ppbRows = Array.isArray(rows) ? rows : [];
        renderRows();
        resize();
        markSaved();
        // properties (the remembered label/preset) are restored by now
        refreshPresetList();
    };

    btnAdd.addEventListener("click", () => {
        node.ppbRows.push({ label: "", text: "", enabled: true });
        renderRows(); sync(); resize();
    });

    // --- preset io --------------------------------------------------------
    // { label: [presetName, ...] }; presets under different labels are unrelated
    // even when they share a name.
    let presetIndex = {};
    let defaultLabel = "";
    // the preset the elements currently came from; lets us put the dropdown
    // back when the user cancels out of a switch
    let bound = "";

    function fillSelect(el, values, placeholder, selected) {
        el.innerHTML = "";
        const empty = document.createElement("option");
        empty.value = "";
        empty.textContent = placeholder;
        el.appendChild(empty);
        for (const v of values) {
            const o = document.createElement("option");
            o.value = v;
            o.textContent = v;
            el.appendChild(o);
        }
        el.value = values.includes(selected) ? selected : "";
    }

    function fillPresets(selected) {
        fillSelect(select, presetIndex[labelSelect.value] ?? [], "-- preset --", selected);
        bound = select.value;
    }

    async function refreshPresetList(label, name) {
        try {
            const r = await api.fetchApi("/prompt_preset_builder/presets");
            const data = await r.json();
            if (!data.labels) {
                // routes are registered at startup: a reloaded page can still be
                // talking to a server running the pre-label version
                console.error("[PromptPresetBuilder] the server is running an older " +
                              "version of this node - restart ComfyUI");
                return;
            }
            presetIndex = data.labels;
            defaultLabel = data.default_label || "";
            fillSelect(labelSelect, Object.keys(presetIndex), "-- label --",
                       label ?? node.properties?.ppb_label ?? "");
            fillPresets(name ?? node.properties?.ppb_preset ?? "");
        } catch (e) {
            console.error("[PromptPresetBuilder] failed to list presets", e);
        }
    }

    // remembered in properties (serialized by name, so widget order can't shift it)
    function remember() {
        node.properties = node.properties || {};
        node.properties.ppb_label = labelSelect.value;
        node.properties.ppb_preset = select.value;
    }

    async function loadPreset(label, name) {
        const q = `label=${encodeURIComponent(label)}&name=${encodeURIComponent(name)}`;
        const r = await api.fetchApi(`/prompt_preset_builder/preset?${q}`);
        if (!r.ok) {
            console.error("[PromptPresetBuilder] load failed", r.status);
            return false;
        }
        const data = await r.json();
        node.ppbRows = data.rows || [];
        renderRows(); sync(); resize(true);
        markSaved(); remember();
        return true;
    }

    async function savePreset(label, name) {
        const r = await api.fetchApi("/prompt_preset_builder/preset", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ label, name, rows: node.ppbRows }),
        });
        if (!r.ok) {
            console.error("[PromptPresetBuilder] save failed", r.status);
            return false;
        }
        const saved = await r.json();
        await refreshPresetList(saved.label, saved.name);
        markSaved(); remember();
        return true;
    }

    // used by "Save as", and by "Save" while the node is not bound to a preset
    async function saveAsDialog(title) {
        const dst = await askPreset(title, labelSelect.value || defaultLabel,
                                    select.value || "", Object.keys(presetIndex));
        if (!dst) return;
        const label = dst.label || defaultLabel;
        if ((presetIndex[label] ?? []).includes(dst.name)
            && !window.confirm(`"${label} / ${dst.name}" already exists. Overwrite it?`)) return;
        await savePreset(label, dst.name);
    }

    labelSelect.addEventListener("change", () => { fillPresets(""); remember(); });

    // picking a preset loads it right away - there is no Load button
    select.addEventListener("change", async () => {
        const name = select.value;
        if (!name) { bound = ""; remember(); return; }
        if (!confirmDiscard()) { select.value = bound; return; }
        if (await loadPreset(labelSelect.value, name)) bound = name;
        else select.value = bound;
    });

    // the manager edits the shared preset file -> every node re-reads the list
    node.ppbRefreshPresets = () => refreshPresetList();

    btnNew.addEventListener("click", () => {
        if (!confirmDiscard()) return;
        node.ppbRows = [{ label: "", text: "", enabled: true }];
        select.value = "";
        bound = "";
        renderRows(); sync(); resize(true);
        markSaved(); remember();
    });

    btnSave.addEventListener("click", async () => {
        if (select.value) await savePreset(labelSelect.value, select.value);
        else await saveAsDialog("Save preset");
    });

    btnSaveAs.addEventListener("click", () => saveAsDialog("Save preset as"));

    refreshPresetList();
    node.ppbLoadFromWidget();
    node.size = [420, node.computeSize()[1]];
}

app.registerExtension({
    name: "PromptPresetBuilder",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_NAME) return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const r = onNodeCreated?.apply(this, arguments);
            setupNode(this);
            return r;
        };

        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            const r = onConfigure?.apply(this, arguments);
            // widget values are restored by now -> rebuild the UI from them
            this.ppbLoadFromWidget?.();
            return r;
        };

        const onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (message) {
            const r = onExecuted?.apply(this, arguments);
            const t = message?.text;
            this.ppbSetPreview?.(Array.isArray(t) ? t.join("") : t);
            return r;
        };
    },
});
