import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

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
    const select = document.createElement("select");
    select.setAttribute("aria-label", "Style preset");
    select.style.cssText = "width:100%;min-height:28px;color:var(--input-text,#ddd);background:var(--comfy-input-bg,#222)";
    const status = document.createElement("div");
    status.setAttribute("role", "status");
    status.style.cssText = "min-height:16px;white-space:normal";
    panel.append(select, controls, status);

    function markChanged() {
        node.setDirtyCanvas(true, true);
    }

    function fillOptions() {
        const selected = node.properties.promptStyleName || "";
        select.replaceChildren(new Option("Select a style", ""));
        for (const name of Object.keys(library).sort()) select.add(new Option(name, name));
        if (selected && !Object.hasOwn(library, selected)) {
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
        select.disabled = true;
        for (const button of controls.children) button.disabled = true;
        status.textContent = "";
        try {
            await action();
        } catch (error) {
            status.textContent = error.message;
        } finally {
            busy = false;
            select.disabled = false;
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
        const style = Object.hasOwn(library, select.value) ? library[select.value] : null;
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
        const current = select.value;
        let name = current;
        if (asNew || !current) {
            name = window.prompt("Style name", asNew ? "" : current)?.trim();
            if (!name) return;
        }
        const prompts = readPrompts();
        await refresh();
        const exists = Object.hasOwn(library, name);
        if (exists && (asNew || name !== current)
            && !window.confirm(`Overwrite style "${name}"?`)) return;
        await request("style", { name, ...prompts, overwrite: exists });
        node.properties.promptStyleName = name;
        baseline = JSON.stringify(prompts);
        await refresh();
        status.textContent = `Saved: ${name}`;
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
    addButton("Delete", "Delete the selected style; keep the current text boxes", async () => {
        selectedStyle();
        const name = select.value;
        if (!window.confirm(`Delete style "${name}"?`)) return;
        await request("style/delete", { name });
        node.properties.promptStyleName = "";
        await refresh();
        status.textContent = `Deleted: ${name}. Current text is unchanged.`;
        markChanged();
    });
    addButton("Refresh", "Reload styles saved by other nodes or workflows", refresh);
    select.addEventListener("change", () => {
        node.properties.promptStyleName = select.value;
        markChanged();
    });

    const toolbar = node.addDOMWidget("style_presets", "PromptStylePresetsToolbar", panel, {
        serialize: false, hideOnZoom: false,
        getMinHeight: () => 110, getMaxHeight: () => 110,
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
