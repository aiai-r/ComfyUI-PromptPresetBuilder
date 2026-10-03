import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const DEFAULT_FOLDER = "Uncategorized";
const NEW_FOLDER = "";
const INPUT_STYLE = "min-height:28px;padding:2px 6px;box-sizing:border-box;color:var(--input-text,#ddd);background:var(--comfy-input-bg,#222);border:1px solid #666;border-radius:4px";
const BUTTON_STYLE = "padding:4px 8px;cursor:pointer;color:var(--input-text,#ddd);background:var(--comfy-input-bg,#222);border:1px solid #666;border-radius:4px";
let dialogCount = 0;

function applyStyle(prompt, style) {
    return style.includes("{prompt}")
        ? style.split("{prompt}").join(prompt)
        : [prompt.trim(), style.trim()].filter(Boolean).join(", ");
}

function makeButton(label, onClick) {
    const button = document.createElement("button");
    button.textContent = label;
    button.style.cssText = BUTTON_STYLE;
    button.addEventListener("click", onClick);
    return button;
}

function setEnabled(button, enabled) {
    button.disabled = !enabled;
    button.style.opacity = enabled ? "" : "0.5";
    button.style.cursor = enabled ? "pointer" : "default";
}

function makeField(label, ...controls) {
    const field = document.createElement("label");
    field.style.cssText = "display:flex;flex-direction:column;gap:4px";
    const caption = document.createElement("span");
    caption.textContent = label;
    field.append(caption, ...controls);
    return field;
}

function makeSelect(values, value) {
    const select = document.createElement("select");
    select.style.cssText = INPUT_STYLE;
    for (const option of values) select.add(new Option(option, option));
    select.value = value;
    return select;
}

// A folder list ending in "+ New folder...", which reveals a text box for the new name.
function makeFolderPicker(folders, folder, onChange) {
    const select = makeSelect([...new Set([...folders, folder])].sort(), folder);
    select.add(new Option("+ New folder...", NEW_FOLDER));
    const input = document.createElement("input");
    input.placeholder = "New folder name";
    input.style.cssText = INPUT_STYLE;
    const sync = () => { input.style.display = select.value === NEW_FOLDER ? "" : "none"; };
    select.addEventListener("change", () => {
        sync();
        if (select.value === NEW_FOLDER) input.focus();
        onChange();
    });
    input.addEventListener("input", onChange);
    sync();
    return { select, input, read: () => (select.value === NEW_FOLDER ? input.value : select.value).trim() };
}

// The overlay shared by every dialog. close() removes it and resolves; Cancel, Escape or a
// click outside resolves null, and Enter outside a button calls onEnter.
function openModal(title, resolve, onEnter) {
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5)";
    const box = document.createElement("div");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.style.cssText = "width:min(360px,calc(100vw - 32px));display:flex;flex-direction:column;gap:10px;padding:16px;box-sizing:border-box;border:1px solid #666;border-radius:8px;background:var(--comfy-menu-bg,#353535);color:var(--input-text,#ddd);font:13px sans-serif;box-shadow:0 8px 24px rgba(0,0,0,0.5)";
    overlay.append(box);
    const heading = document.createElement("div");
    heading.textContent = title;
    heading.style.cssText = "font-weight:bold;font-size:14px";
    box.append(heading);
    const close = (result) => {
        overlay.remove();
        resolve(result);
    };
    overlay.addEventListener("mousedown", (event) => {
        if (event.target === overlay) close(null);
    });
    // keep keys away from ComfyUI's canvas shortcuts while the dialog is open
    box.addEventListener("keydown", (event) => {
        event.stopPropagation();
        if (event.key === "Escape") close(null);
        // a focused button handles Enter itself
        else if (event.key === "Enter" && event.target.tagName !== "BUTTON" && onEnter) {
            event.preventDefault();
            onEnter();
        }
    });
    return { overlay, box, close };
}

function makeWarning() {
    const warning = document.createElement("div");
    warning.style.cssText = "color:#e8a33d;white-space:pre-wrap";
    return warning;
}

function makeButtonRow(...buttons) {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;justify-content:flex-end;gap:6px";
    row.append(...buttons);
    return row;
}

// A modal in place of window.prompt/confirm. With `name` given it asks for a name (and a
// folder unless showFolder is false) and resolves {folder, name}; with `choices` it resolves
// the clicked label; otherwise it is a confirmation resolving true.
// Cancel, Escape or a click outside resolves null.
function showDialog({
    title, message = "", okLabel = "OK", folder, name, folders = [], exists = () => false,
    showFolder = true, nameLabel = "Name", canOverwrite = true, choices = [],
}) {
    const form = name !== undefined;
    return new Promise((resolve) => {
        const modal = openModal(title, resolve, choices.length ? null : () => submit());
        const { box } = modal;
        if (message) {
            const text = document.createElement("div");
            text.textContent = message;
            text.style.cssText = "white-space:pre-wrap";
            box.append(text);
        }

        let picker;
        let nameInput;
        if (form && showFolder) {
            picker = makeFolderPicker(folders, folder, update);
            box.append(makeField("Folder", picker.select, picker.input));
        }
        if (form) {
            nameInput = document.createElement("input");
            nameInput.value = name;
            nameInput.placeholder = nameLabel;
            nameInput.style.cssText = INPUT_STYLE;
            nameInput.addEventListener("input", update);
            box.append(makeField(nameLabel, nameInput));
        }

        const warning = makeWarning();
        const ok = makeButton(okLabel, () => submit());
        const buttons = makeButtonRow(makeButton("Cancel", () => modal.close(null)));
        for (const label of choices) buttons.append(makeButton(label, () => modal.close(label)));
        if (!choices.length) buttons.append(ok);
        box.append(warning, buttons);

        function readForm() {
            return { folder: picker ? picker.read() : folder, name: nameInput.value.trim() };
        }
        function update() {
            if (!form) return;
            const target = readForm();
            const clash = Boolean(target.folder && target.name && exists(target.folder, target.name));
            setEnabled(ok, target.folder && target.name && !(clash && !canOverwrite));
            ok.textContent = clash && canOverwrite ? "Overwrite" : okLabel;
            warning.textContent = !clash ? ""
                : !canOverwrite ? `"${target.name}" already exists.`
                : `"${target.folder} / ${target.name}" already exists.\nIts positive and negative prompts will be replaced.`;
        }
        function submit() {
            if (!ok.disabled) modal.close(form ? readForm() : true);
        }

        document.body.append(modal.overlay);
        update();
        if (form) {
            nameInput.focus();
            nameInput.select();
        } else {
            buttons.children[buttons.children.length - 1].focus();
        }
    });
}

// Move or copy a style between folders, keeping its name. When the destination already has
// that name it offers Overwrite or Keep both (saved as name_2, name_3, ...).
// Resolves {folder, name, toFolder, toName, copy, overwrite} or null.
function showTransferDialog({ library, folders, folder, name, toFolder }) {
    return new Promise((resolve) => {
        const modal = openModal("Move / Copy style", resolve, () => {
            if (!primary.disabled) primary.click();
        });
        const stylesIn = (key) => (Object.hasOwn(library, key) ? library[key] : {});

        const fromFolder = makeSelect(folders, folder);
        const fromName = document.createElement("select");
        fromName.style.cssText = INPUT_STYLE;
        function fillNames(keep) {
            const names = Object.keys(stylesIn(fromFolder.value)).sort();
            fromName.replaceChildren(...names.map((key) => new Option(key, key)));
            if (!names.length) fromName.add(new Option("(no styles)", ""));
            fromName.value = names.includes(keep) ? keep : (names[0] ?? "");
        }
        fillNames(name);

        const modes = document.createElement("div");
        modes.style.cssText = "display:flex;gap:16px";
        const group = `ppb-transfer-${++dialogCount}`;
        const [moveRadio, copyRadio] = ["Move", "Copy"].map((label) => {
            const option = document.createElement("label");
            option.style.cssText = "display:flex;align-items:center;gap:4px;cursor:pointer";
            const radio = document.createElement("input");
            radio.type = "radio";
            radio.name = group;
            radio.addEventListener("change", update);
            option.append(radio, label);
            modes.append(option);
            return radio;
        });
        moveRadio.checked = true;

        const to = makeFolderPicker(folders, toFolder, update);
        const warning = makeWarning();
        const overwrite = makeButton("Overwrite", () => finish(true));
        const keepBoth = makeButton("Keep both", () => finish(false));
        const ok = makeButton("Move", () => finish(false));
        let primary = ok;
        modal.box.append(
            makeField("From", fromFolder, fromName),
            makeField("Action", modes),
            makeField("To folder", to.select, to.input),
            warning,
            makeButtonRow(makeButton("Cancel", () => modal.close(null)), overwrite, keepBoth, ok),
        );

        function freeName(key, base) {
            let index = 2;
            while (Object.hasOwn(stylesIn(key), `${base}_${index}`)) index++;
            return `${base}_${index}`;
        }
        function state() {
            const source = { folder: fromFolder.value, name: fromName.value, toFolder: to.read(), copy: copyRadio.checked };
            const same = source.toFolder === source.folder;
            // a copy into its own folder always needs a new name
            const clash = Boolean(source.name && source.toFolder)
                && (same ? source.copy : Object.hasOwn(stylesIn(source.toFolder), source.name));
            return { ...source, same, clash };
        }
        function update() {
            const current = state();
            ok.textContent = current.copy ? "Copy" : "Move";
            overwrite.style.display = current.clash && !current.same ? "" : "none";
            keepBoth.style.display = current.clash ? "" : "none";
            ok.style.display = current.clash ? "none" : "";
            setEnabled(ok, current.name && current.toFolder && !(current.same && !current.copy));
            primary = current.clash ? keepBoth : ok;
            warning.textContent = !current.name || !current.toFolder ? ""
                : current.same && !current.copy ? "It is already in this folder."
                : current.same ? `The copy will be saved as "${freeName(current.toFolder, current.name)}".`
                : current.clash ? `"${current.toFolder} / ${current.name}" already exists.\nOverwrite it, or keep both by saving this one as "${freeName(current.toFolder, current.name)}".`
                : "";
        }
        function finish(replace) {
            const current = state();
            modal.close({
                folder: current.folder, name: current.name, toFolder: current.toFolder, copy: current.copy,
                toName: current.clash && !replace ? freeName(current.toFolder, current.name) : current.name,
                overwrite: replace,
            });
        }

        fromFolder.addEventListener("change", () => {
            fillNames("");
            update();
        });
        fromName.addEventListener("change", update);
        document.body.append(modal.overlay);
        update();
        to.select.focus();
    });
}

function setupStylePresets(node) {
    const positive = node.widgets.find((widget) => widget.name === "positive");
    const negative = node.widgets.find((widget) => widget.name === "negative");
    const readPrompts = () => ({ positive: positive.value, negative: negative.value });
    let library = {};
    let baseline = JSON.stringify(readPrompts());
    let busy = false;
    node.properties ??= {};

    const panel = document.createElement("div");
    panel.style.cssText = "display:flex;flex-direction:column;gap:6px;padding:6px;box-sizing:border-box;font:12px sans-serif;color:var(--input-text,#ddd)";
    const controls = document.createElement("div");
    controls.style.cssText = "display:flex;gap:5px;flex-wrap:wrap";
    const folderRow = document.createElement("div");
    folderRow.style.cssText = "display:flex;gap:5px";
    const folderSelect = document.createElement("select");
    folderSelect.setAttribute("aria-label", "Style folder");
    folderSelect.style.cssText = "flex:1;min-width:0;min-height:28px;color:var(--input-text,#ddd);background:var(--comfy-input-bg,#222)";
    const presetRow = document.createElement("div");
    presetRow.style.cssText = "display:flex;gap:5px";
    const select = document.createElement("select");
    select.setAttribute("aria-label", "Style preset");
    select.style.cssText = "flex:1;min-width:0;min-height:28px;color:var(--input-text,#ddd);background:var(--comfy-input-bg,#222)";
    const status = document.createElement("div");
    status.setAttribute("role", "status");
    status.style.cssText = "min-height:16px;white-space:normal";
    panel.append(folderRow, presetRow, controls, status);

    function markChanged() {
        node.setDirtyCanvas(true, true);
    }

    function currentFolder() {
        if (node.properties.promptStyleFolder) return node.properties.promptStyleFolder;
        // workflows saved before folders only know the name, which now lives in DEFAULT_FOLDER
        if (node.properties.promptStyleName) return DEFAULT_FOLDER;
        return Object.keys(library).sort()[0] ?? DEFAULT_FOLDER;
    }

    // DEFAULT_FOLDER is always listed and cannot be deleted
    function folderNames() {
        return [...new Set([DEFAULT_FOLDER, ...Object.keys(library)])].sort();
    }

    function stylesIn(folder) {
        return Object.hasOwn(library, folder) ? library[folder] : {};
    }

    function hasSelectedStyle() {
        return Object.hasOwn(stylesIn(currentFolder()), select.value);
    }

    // the buttons next to the lists only work on something that exists
    function updateRowButtons() {
        const folder = currentFolder();
        const editableFolder = !busy && folder !== DEFAULT_FOLDER && Object.hasOwn(library, folder);
        setEnabled(renameFolderButton, editableFolder);
        setEnabled(deleteFolderButton, editableFolder);
        setEnabled(renameButton, !busy && hasSelectedStyle());
        setEnabled(deleteButton, !busy && hasSelectedStyle());
    }

    function fillOptions() {
        const folder = currentFolder();
        const folders = folderNames();
        if (!folders.includes(folder)) folders.push(folder);
        folderSelect.replaceChildren(...folders.map((name) => new Option(name, name)), new Option("+ New folder...", NEW_FOLDER));
        folderSelect.value = folder;
        const styles = stylesIn(folder);
        const selected = node.properties.promptStyleName || "";
        select.replaceChildren(new Option("Select a style", ""));
        for (const name of Object.keys(styles).sort()) select.add(new Option(name, name));
        if (selected && !Object.hasOwn(styles, selected)) {
            select.add(new Option(`${selected} (not in library)`, selected));
        }
        select.value = selected;
        updateRowButtons();
    }

    async function request(path, body) {
        const response = await api.fetchApi(`/prompt_preset_builder/${path}`, body === undefined ? {} : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!response.ok) throw new Error(`Style request failed (${response.status}): ${await response.text()}`);
        return response.json();
    }

    async function refresh() {
        library = (await request("styles")).styles;
        fillOptions();
    }

    async function run(action) {
        if (busy) return;
        busy = true;
        select.disabled = folderSelect.disabled = true;
        for (const button of controls.children) button.disabled = true;
        updateRowButtons();
        status.textContent = "";
        try {
            await action();
        } catch (error) {
            status.textContent = error.message;
        } finally {
            busy = false;
            select.disabled = folderSelect.disabled = false;
            for (const button of controls.children) button.disabled = false;
            updateRowButtons();
        }
    }

    function makeActionButton(label, title, action) {
        const button = makeButton(label, () => run(action));
        button.title = title;
        return button;
    }

    function addButton(label, title, action) {
        controls.append(makeActionButton(label, title, action));
    }

    function selectedStyle() {
        const styles = stylesIn(currentFolder());
        const style = Object.hasOwn(styles, select.value) ? styles[select.value] : null;
        if (!style) throw new Error("Select an existing style first.");
        return style;
    }

    function writePrompts(prompts) {
        positive.value = prompts.positive;
        negative.value = prompts.negative;
        positive.callback?.(positive.value);
        negative.callback?.(negative.value);
        markChanged();
    }

    function choose(folder, name) {
        node.properties.promptStyleFolder = folder;
        node.properties.promptStyleName = name;
    }

    async function save(asNew) {
        const prompts = readPrompts();
        await refresh();
        let folder = currentFolder();
        let name = select.value;
        let exists = Object.hasOwn(stylesIn(folder), name);
        if (asNew || !name) {
            const target = await showDialog({
                title: asNew ? "Save as" : "Save", okLabel: "Save", folder, name,
                folders: folderNames(), exists: (f, n) => Object.hasOwn(stylesIn(f), n),
            });
            if (!target) return;
            ({ folder, name } = target);
            exists = Object.hasOwn(stylesIn(folder), name);
        } else if (exists && !await showDialog({
            title: "Overwrite style", okLabel: "Overwrite",
            message: `Overwrite "${folder} / ${name}"?\nBoth positive and negative prompts will be replaced.`,
        })) return;
        await request("style", { folder, name, ...prompts, overwrite: exists });
        choose(folder, name);
        baseline = JSON.stringify(prompts);
        await refresh();
        status.textContent = `Saved: ${folder} / ${name}`;
        markChanged();
    }

    async function createFolder() {
        const target = await showDialog({
            title: "New folder", okLabel: "Create", name: "", nameLabel: "Folder name",
            showFolder: false, folder: currentFolder(), canOverwrite: false,
            exists: (_, name) => folderNames().includes(name),
        });
        if (!target) {
            fillOptions();
            return;
        }
        await request("style/folder", { folder: target.name });
        choose(target.name, "");
        await refresh();
        status.textContent = `Created folder: ${target.name}`;
        markChanged();
    }

    const renameFolderButton = makeActionButton("Rename", "Rename this folder; its styles stay in it", async () => {
        await refresh();
        const folder = currentFolder();
        if (folder === DEFAULT_FOLDER || !Object.hasOwn(library, folder)) return;
        const target = await showDialog({
            title: "Rename folder", okLabel: "Rename", name: folder, nameLabel: "New name", showFolder: false, folder,
            canOverwrite: false, exists: (_, name) => name !== folder && folderNames().includes(name),
        });
        if (!target || target.name === folder) return;
        await request("style/folder/rename", { folder, to_folder: target.name });
        choose(target.name, node.properties.promptStyleName || "");
        await refresh();
        status.textContent = `Renamed folder: ${folder} -> ${target.name}`;
        markChanged();
    });
    const deleteFolderButton = makeActionButton("Delete", "Delete this folder and the styles in it", async () => {
        await refresh();
        const folder = currentFolder();
        if (folder === DEFAULT_FOLDER || !Object.hasOwn(library, folder)) return;
        const count = Object.keys(stylesIn(folder)).length;
        const message = count
            ? `Delete folder "${folder}" and the ${count} style${count === 1 ? "" : "s"} in it?\nThis cannot be undone from here.`
            : `Delete the empty folder "${folder}"?`;
        if (!await showDialog({ title: "Delete folder", okLabel: "Delete", message })) return;
        await request("style/folder/delete", { folder });
        choose("", "");
        await refresh();
        status.textContent = `Deleted folder: ${folder}. Current text is unchanged.`;
        markChanged();
    });
    const renameButton = makeActionButton("Rename", "Rename the selected style", async () => {
        await refresh();
        selectedStyle();
        const folder = currentFolder();
        const name = select.value;
        const target = await showDialog({
            title: "Rename style", okLabel: "Rename", name, nameLabel: "New name", showFolder: false, folder,
            exists: (key, value) => value !== name && Object.hasOwn(stylesIn(key), value),
        });
        if (!target || target.name === name) return;
        const overwrite = Object.hasOwn(stylesIn(folder), target.name);
        await request("style/move", { folder, name, to_folder: folder, to_name: target.name, overwrite });
        choose(folder, target.name);
        await refresh();
        status.textContent = `Renamed: ${folder} / ${name} -> ${target.name}`;
        markChanged();
    });
    const deleteButton = makeActionButton("Delete", "Delete the selected style; keep the current text boxes", async () => {
        selectedStyle();
        const folder = currentFolder();
        const name = select.value;
        if (!await showDialog({ title: "Delete style", okLabel: "Delete", message: `Delete "${folder} / ${name}"?` })) return;
        await request("style/delete", { folder, name });
        node.properties.promptStyleName = "";
        await refresh();
        status.textContent = `Deleted: ${folder} / ${name}. Current text is unchanged.`;
        markChanged();
    });
    folderRow.append(folderSelect, renameFolderButton, deleteFolderButton);
    presetRow.append(select, renameButton, deleteButton);

    addButton("Load", "Replace both text boxes with the saved style for editing", async () => {
        const style = selectedStyle();
        if (JSON.stringify(readPrompts()) !== baseline && !await showDialog({
            title: "Load style", okLabel: "Replace",
            message: "Replace the edited positive and negative prompts?",
        })) return;
        writePrompts(style);
        baseline = JSON.stringify(readPrompts());
        status.textContent = "Loaded. Edit the text, then Save to update the preset.";
    });
    addButton("Apply", "Apply to both prompts: insert at {prompt}, otherwise append", () => {
        const style = selectedStyle();
        writePrompts({
            positive: applyStyle(positive.value, style.positive),
            negative: applyStyle(negative.value, style.negative),
        });
        status.textContent = "Applied to the text boxes. The saved style is unchanged.";
    });
    addButton("Save", "Save both text boxes to the selected style", () => save(false));
    addButton("Save as", "Save both text boxes under a folder and name", () => save(true));
    addButton("Move / Copy", "Move or copy a style to another folder", async () => {
        await refresh();
        const folders = folderNames();
        const hasStyles = (key) => Object.keys(stylesIn(key)).length > 0;
        const folder = hasStyles(currentFolder()) ? currentFolder() : folders.find(hasStyles);
        if (!folder) throw new Error("There are no styles to move or copy.");
        const result = await showTransferDialog({
            library, folders, folder, name: select.value, toFolder: folders.find((key) => key !== folder) ?? folder,
        });
        if (!result) return;
        await request("style/move", {
            folder: result.folder, name: result.name, to_folder: result.toFolder, to_name: result.toName,
            overwrite: result.overwrite, copy: result.copy,
        });
        choose(result.toFolder, result.toName);
        await refresh();
        status.textContent = `${result.copy ? "Copied" : "Moved"}: ${result.folder} / ${result.name} -> ${result.toFolder} / ${result.toName}`;
        markChanged();
    });
    addButton("Refresh", "Reload styles saved by other nodes or workflows", refresh);
    folderSelect.addEventListener("change", () => {
        if (folderSelect.value === NEW_FOLDER) {
            run(createFolder);
            return;
        }
        choose(folderSelect.value, "");
        fillOptions();
        markChanged();
    });
    select.addEventListener("change", () => {
        node.properties.promptStyleName = select.value;
        updateRowButtons();
        markChanged();
    });

    const toolbar = node.addDOMWidget("style_presets", "PromptStylePresetsToolbar", panel, {
        serialize: false, hideOnZoom: false,
        getMinHeight: () => 130, getMaxHeight: () => 130,
    });
    node.widgets.splice(node.widgets.indexOf(toolbar), 1);
    node.widgets.unshift(toolbar);
    const configure = node.onConfigure;
    node.onConfigure = function (...args) {
        configure?.apply(this, args);
        baseline = JSON.stringify(readPrompts());
        fillOptions();
    };
    node.setSize([Math.max(node.size[0], 480), Math.max(node.size[1], 500)]);
    run(refresh);
}

app.registerExtension({
    name: "PromptPresetBuilder.StylePresets",
    nodeCreated(node) {
        if (node.comfyClass === "PromptStylePresets") setupStylePresets(node);
    },
});
