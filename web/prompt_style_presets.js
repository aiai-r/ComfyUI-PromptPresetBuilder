import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const DEFAULT_FOLDER = "Uncategorized";
const NEW_FOLDER = "";

function applyStyle(prompt, style) {
    return style.includes("{prompt}")
        ? style.split("{prompt}").join(prompt)
        : [prompt.trim(), style.trim()].filter(Boolean).join(", ");
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
    selectors.append(folderSelect, select);
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
        status.textContent = "";
        try {
            await action();
        } catch (error) {
            status.textContent = error.message;
        } finally {
            busy = false;
            select.disabled = folderSelect.disabled = false;
            for (const button of controls.children) button.disabled = false;
        }
    }

    function addButton(label, title, action) {
        const button = document.createElement("button");
        button.textContent = label;
        button.title = title;
        button.style.cssText = "padding:4px 8px;cursor:pointer;color:var(--input-text,#ddd);background:var(--comfy-input-bg,#222);border:1px solid #666;border-radius:4px";
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

    async function save(asNew) {
        const folder = currentFolder();
        const current = select.value;
        let name = current;
        if (asNew || !current) {
            name = window.prompt(`Style name in "${folder}"`, asNew ? "" : current)?.trim();
            if (!name) return;
        }
        const prompts = readPrompts();
        await refresh();
        const exists = Object.hasOwn(stylesIn(folder), name);
        if (exists && !window.confirm(`Overwrite style "${folder} / ${name}"?\nBoth positive and negative prompts will be replaced.`)) return;
        await request("style", { folder, name, ...prompts, overwrite: exists });
        node.properties.promptStyleFolder = folder;
        node.properties.promptStyleName = name;
        baseline = JSON.stringify(prompts);
        await refresh();
        status.textContent = `Saved: ${folder} / ${name}`;
        markChanged();
    }

    async function move(toFolder, toName) {
        const folder = currentFolder();
        const name = select.value;
        if (toFolder === folder && toName === name) return;
        await refresh();
        if (!Object.hasOwn(stylesIn(folder), name)) throw new Error("Select an existing style first.");
        const exists = Object.hasOwn(stylesIn(toFolder), toName);
        if (exists && !window.confirm(`Overwrite style "${toFolder} / ${toName}"?\nBoth positive and negative prompts will be replaced.`)) return;
        await request("style/move", { folder, name, to_folder: toFolder, to_name: toName, overwrite: exists });
        node.properties.promptStyleFolder = toFolder;
        node.properties.promptStyleName = toName;
        await refresh();
        status.textContent = `Moved: ${folder} / ${name} -> ${toFolder} / ${toName}`;
        markChanged();
    }

    addButton("Load", "Replace both text boxes with the saved style for editing", () => {
        const style = selectedStyle();
        if (JSON.stringify(readPrompts()) !== baseline
            && !window.confirm("Replace the edited positive and negative prompts?")) return;
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
    addButton("Save as", "Save both text boxes as a new named style", () => save(true));
    addButton("Rename", "Rename the selected style", async () => {
        selectedStyle();
        const name = window.prompt("New style name", select.value)?.trim();
        if (name) await move(currentFolder(), name);
    });
    addButton("Move", "Move the selected style to another folder", async () => {
        selectedStyle();
        const others = Object.keys(library).filter((folder) => folder !== currentFolder()).sort();
        const message = `Move "${select.value}" to folder (a new name creates the folder)`
            + (others.length ? `\nExisting: ${others.join(", ")}` : "");
        const folder = window.prompt(message, "")?.trim();
        if (folder) await move(folder, select.value);
    });
    addButton("Delete", "Delete the selected style; keep the current text boxes", async () => {
        selectedStyle();
        const folder = currentFolder();
        const name = select.value;
        if (!window.confirm(`Delete style "${folder} / ${name}"?`)) return;
        await request("style/delete", { folder, name });
        node.properties.promptStyleName = "";
        await refresh();
        status.textContent = `Deleted: ${folder} / ${name}. Current text is unchanged.`;
        markChanged();
    });
    addButton("Refresh", "Reload styles saved by other nodes or workflows", refresh);
    folderSelect.addEventListener("change", () => {
        let folder = folderSelect.value;
        if (folder === NEW_FOLDER) {
            folder = window.prompt("New folder name", "")?.trim();
            if (!folder) {
                fillOptions();
                return;
            }
        }
        node.properties.promptStyleFolder = folder;
        node.properties.promptStyleName = "";
        fillOptions();
        status.textContent = Object.hasOwn(library, folder) ? "" : `New folder "${folder}": use Save as to add a style. Empty folders are not kept.`;
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
