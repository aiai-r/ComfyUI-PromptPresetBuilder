import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const DEFAULT_FOLDER = "Uncategorized";
const NEW_FOLDER = "";
const INPUT_STYLE = "min-height:28px;padding:2px 6px;box-sizing:border-box;color:var(--input-text,#ddd);background:var(--comfy-input-bg,#222);border:1px solid #666;border-radius:4px";
const BUTTON_STYLE = "padding:4px 8px;cursor:pointer;color:var(--input-text,#ddd);background:var(--comfy-input-bg,#222);border:1px solid #666;border-radius:4px";

function applyStyle(prompt, style) {
    return style.includes("{prompt}")
        ? style.split("{prompt}").join(prompt)
        : [prompt.trim(), style.trim()].filter(Boolean).join(", ");
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
        if (message) {
            const text = document.createElement("div");
            text.textContent = message;
            text.style.cssText = "white-space:pre-wrap";
            box.append(text);
        }

        let folderSelect;
        let newFolder;
        let nameInput;
        function addField(label, ...controls) {
            const field = document.createElement("label");
            field.style.cssText = "display:flex;flex-direction:column;gap:4px";
            const caption = document.createElement("span");
            caption.textContent = label;
            field.append(caption, ...controls);
            box.append(field);
        }
        if (form && showFolder) {
            folderSelect = document.createElement("select");
            folderSelect.style.cssText = INPUT_STYLE;
            for (const option of [...new Set([...folders, folder])].sort()) folderSelect.add(new Option(option, option));
            folderSelect.add(new Option("+ New folder...", NEW_FOLDER));
            folderSelect.value = folder;
            newFolder = document.createElement("input");
            newFolder.placeholder = "New folder name";
            newFolder.style.cssText = INPUT_STYLE;
            addField("Folder", folderSelect, newFolder);
        }
        if (form) {
            nameInput = document.createElement("input");
            nameInput.value = name;
            nameInput.placeholder = nameLabel;
            nameInput.style.cssText = INPUT_STYLE;
            addField(nameLabel, nameInput);
        }

        const warning = document.createElement("div");
        warning.style.cssText = "color:#e8a33d;white-space:pre-wrap";
        const buttons = document.createElement("div");
        buttons.style.cssText = "display:flex;justify-content:flex-end;gap:6px";
        const cancel = document.createElement("button");
        cancel.textContent = "Cancel";
        const ok = document.createElement("button");
        ok.textContent = okLabel;
        cancel.style.cssText = ok.style.cssText = BUTTON_STYLE;
        buttons.append(cancel);
        for (const label of choices) {
            const choice = document.createElement("button");
            choice.textContent = label;
            choice.style.cssText = BUTTON_STYLE;
            choice.addEventListener("click", () => close(label));
            buttons.append(choice);
        }
        if (!choices.length) buttons.append(ok);
        box.append(warning, buttons);

        const readForm = () => ({
            folder: !showFolder ? folder
                : (folderSelect.value === NEW_FOLDER ? newFolder.value : folderSelect.value).trim(),
            name: nameInput.value.trim(),
        });
        function update() {
            if (!form) return;
            if (showFolder) newFolder.style.display = folderSelect.value === NEW_FOLDER ? "" : "none";
            const target = readForm();
            const clash = Boolean(target.folder && target.name && exists(target.folder, target.name));
            ok.disabled = !target.folder || !target.name || (clash && !canOverwrite);
            ok.style.opacity = ok.disabled ? "0.5" : "";
            ok.style.cursor = ok.disabled ? "default" : "pointer";
            ok.textContent = clash && canOverwrite ? "Overwrite" : okLabel;
            warning.textContent = !clash ? ""
                : !canOverwrite ? `"${target.name}" already exists.`
                : `"${target.folder} / ${target.name}" already exists.\nIts positive and negative prompts will be replaced.`;
        }
        function close(result) {
            overlay.remove();
            resolve(result);
        }
        function submit() {
            if (!ok.disabled) close(form ? readForm() : true);
        }

        ok.addEventListener("click", submit);
        cancel.addEventListener("click", () => close(null));
        overlay.addEventListener("mousedown", (event) => {
            if (event.target === overlay) close(null);
        });
        // keep keys away from ComfyUI's canvas shortcuts while the dialog is open
        box.addEventListener("keydown", (event) => {
            event.stopPropagation();
            if (event.key === "Escape") close(null);
            // a focused button handles Enter itself
            else if (event.key === "Enter" && event.target.tagName !== "BUTTON") {
                event.preventDefault();
                submit();
            }
        });
        if (form && showFolder) {
            folderSelect.addEventListener("change", () => {
                update();
                if (folderSelect.value === NEW_FOLDER) newFolder.focus();
            });
            newFolder.addEventListener("input", update);
        }
        if (form) nameInput.addEventListener("input", update);
        document.body.append(overlay);
        update();
        if (form) {
            nameInput.focus();
            nameInput.select();
        } else {
            buttons.children[buttons.children.length - 1].focus();
        }
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
    const selectors = document.createElement("div");
    selectors.style.cssText = "display:flex;gap:5px";
    const folderSelect = document.createElement("select");
    folderSelect.setAttribute("aria-label", "Style folder");
    folderSelect.style.cssText = "flex:2;min-width:0;min-height:28px;color:var(--input-text,#ddd);background:var(--comfy-input-bg,#222)";
    const select = document.createElement("select");
    select.setAttribute("aria-label", "Style preset");
    select.style.cssText = "flex:3;min-width:0;min-height:28px;color:var(--input-text,#ddd);background:var(--comfy-input-bg,#222)";
    const folderButton = document.createElement("button");
    folderButton.textContent = "Folder";
    folderButton.title = "Create or delete a folder";
    folderButton.style.cssText = BUTTON_STYLE;
    selectors.append(folderSelect, folderButton, select);
    const status = document.createElement("div");
    status.setAttribute("role", "status");
    status.style.cssText = "min-height:16px;white-space:normal";
    panel.append(selectors, controls, status);

    function markChanged() {
        node.setDirtyCanvas(true, true);
    }

    function currentFolder() {
        if (node.properties.promptStyleFolder) return node.properties.promptStyleFolder;
        // workflows saved before folders only know the name, which now lives in DEFAULT_FOLDER
        if (node.properties.promptStyleName) return DEFAULT_FOLDER;
        return Object.keys(library).sort()[0] ?? DEFAULT_FOLDER;
    }

    function stylesIn(folder) {
        return Object.hasOwn(library, folder) ? library[folder] : {};
    }

    function fillOptions() {
        const folder = currentFolder();
        const folders = Object.keys(library).sort();
        if (!folders.includes(folder)) folders.push(folder);
        folderSelect.replaceChildren(...folders.map((name) => new Option(name, name)));
        folderSelect.value = folder;
        const styles = stylesIn(folder);
        const selected = node.properties.promptStyleName || "";
        select.replaceChildren(new Option("Select a style", ""));
        for (const name of Object.keys(styles).sort()) select.add(new Option(name, name));
        if (selected && !Object.hasOwn(styles, selected)) {
            select.add(new Option(`${selected} (not in library)`, selected));
        }
        select.value = selected;
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
        select.disabled = folderSelect.disabled = folderButton.disabled = true;
        for (const button of controls.children) button.disabled = true;
        status.textContent = "";
        try {
            await action();
        } catch (error) {
            status.textContent = error.message;
        } finally {
            busy = false;
            select.disabled = folderSelect.disabled = folderButton.disabled = false;
            for (const button of controls.children) button.disabled = false;
        }
    }

    function addButton(label, title, action) {
        const button = document.createElement("button");
        button.textContent = label;
        button.title = title;
        button.style.cssText = BUTTON_STYLE;
        button.addEventListener("click", () => run(action));
        controls.append(button);
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
                folders: Object.keys(library), exists: (f, n) => Object.hasOwn(stylesIn(f), n),
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

    async function transfer(copy) {
        await refresh();
        selectedStyle();
        const folder = currentFolder();
        const name = select.value;
        const target = await showDialog({
            title: copy ? "Copy style" : "Move / rename style", okLabel: copy ? "Copy" : "Move", folder, name,
            folders: Object.keys(library),
            exists: (f, n) => Object.hasOwn(stylesIn(f), n) && !(f === folder && n === name),
        });
        if (!target || (target.folder === folder && target.name === name)) return;
        const overwrite = Object.hasOwn(stylesIn(target.folder), target.name);
        await request("style/move", {
            folder, name, to_folder: target.folder, to_name: target.name, overwrite, copy,
        });
        choose(target.folder, target.name);
        await refresh();
        status.textContent = `${copy ? "Copied" : "Moved"}: ${folder} / ${name} -> ${target.folder} / ${target.name}`;
        markChanged();
    }

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
    addButton("Move", "Move or rename the selected style", () => transfer(false));
    addButton("Copy", "Copy the selected style to a folder and name", () => transfer(true));
    addButton("Delete", "Delete the selected style; keep the current text boxes", async () => {
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
    addButton("Refresh", "Reload styles saved by other nodes or workflows", refresh);
    folderButton.addEventListener("click", () => run(async () => {
        await refresh();
        const folder = currentFolder();
        const known = Object.hasOwn(library, folder);
        const count = Object.keys(stylesIn(folder)).length;
        const choice = await showDialog({
            title: `Folder "${folder}"`,
            message: known ? `${count} style${count === 1 ? "" : "s"} in this folder.` : "This folder is not saved yet.",
            choices: known ? ["Delete folder", "New folder"] : ["New folder"],
        });
        if (choice === "New folder") {
            const target = await showDialog({
                title: "New folder", okLabel: "Create", name: "", nameLabel: "Folder name",
                showFolder: false, folder, canOverwrite: false, exists: (_, name) => Object.hasOwn(library, name),
            });
            if (!target) return;
            await request("style/folder", { folder: target.name });
            choose(target.name, "");
            await refresh();
            status.textContent = `Created folder: ${target.name}`;
            markChanged();
        } else if (choice === "Delete folder") {
            const message = count
                ? `Delete folder "${folder}" and the ${count} style${count === 1 ? "" : "s"} in it?\nThis cannot be undone from here.`
                : `Delete the empty folder "${folder}"?`;
            if (!await showDialog({ title: "Delete folder", okLabel: "Delete", message })) return;
            await request("style/folder/delete", { folder });
            choose("", "");
            await refresh();
            status.textContent = `Deleted folder: ${folder}. Current text is unchanged.`;
            markChanged();
        }
    }));
    folderSelect.addEventListener("change", () => {
        choose(folderSelect.value, "");
        fillOptions();
        markChanged();
    });
    select.addEventListener("change", () => {
        node.properties.promptStyleName = select.value;
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
