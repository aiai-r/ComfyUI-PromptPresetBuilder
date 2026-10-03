import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../web/prompt_style_presets.js", import.meta.url), "utf8")
    .replace(/^import .*;\r?\n/gm, "");

class Element {
    constructor() {
        this.children = [];
        this.events = {};
        this.style = {};
        this.value = "";
    }
    append(...children) { this.children.push(...children); }
    add(child) { this.append(child); }
    replaceChildren(...children) { this.children = children; }
    setAttribute() {}
    addEventListener(name, callback) { this.events[name] = callback; }
}

async function fixture() {
    let extension;
    const library = Object.create(null);
    library.SDXL = { base: { positive: "quality, {prompt}", negative: "bad quality" } };
    library.anima = { base: { positive: "anima positive", negative: "anima negative" } };
    const dialogs = { names: [], accept: true, confirmations: [] };
    const writes = [];
    const api = {
        async fetchApi(path, options) {
            let data;
            let status = 200;
            const body = options.body ? JSON.parse(options.body) : null;
            if (body) writes.push({ path, body });
            if (path.endsWith("/styles")) data = { styles: structuredClone(library) };
            else if (path.endsWith("/style/delete")) {
                delete library[body.folder][body.name];
                data = { ok: true };
            } else if (Object.hasOwn(library[body.folder] ?? {}, body.name) && !body.overwrite) {
                status = 409;
                data = { error: "exists" };
            } else {
                library[body.folder] ??= {};
                library[body.folder][body.name] = { positive: body.positive, negative: body.negative };
                data = { folder: body.folder, name: body.name };
            }
            return { ok: status === 200, status, json: async () => data, text: async () => JSON.stringify(data) };
        },
    };
    vm.runInNewContext(source, {
        app: { registerExtension(value) { extension = value; } }, api,
        document: { createElement() { return new Element(); } },
        Option: class { constructor(text, value) { this.text = text; this.value = value; } },
        window: {
            prompt() { return dialogs.names.shift(); },
            confirm(message) { dialogs.confirmations.push(message); return dialogs.accept; },
        },
    });
    const serialize = () => {};
    const node = {
        comfyClass: "PromptStylePresets", properties: {}, size: [200, 200],
        onSerialize: serialize,
        widgets: [{ name: "positive", value: "" }, { name: "negative", value: "" }],
        addDOMWidget(name, type, element, options) {
            const widget = { name, type, element, serialize: options.serialize };
            this.widgets.push(widget);
            return widget;
        },
        setSize(size) { this.size = size; }, setDirtyCanvas() {},
    };
    const [positive, negative] = node.widgets;
    extension.nodeCreated(node);
    await new Promise(setImmediate);
    const [selectors, buttons, status] = node.widgets[0].element.children;
    const [folderSelect, select] = selectors.children;
    return {
        node, extension, library, dialogs, positive, negative, folderSelect, select, status, serialize, writes,
        choose(path) {
            const [folder, name] = path.split("/");
            folderSelect.value = folder;
            folderSelect.events.change();
            select.value = name;
            select.events.change();
        },
        async click(name) { await buttons.children.find((button) => button.textContent === name).events.click(); },
    };
}

test("save, load, edit, save as and delete operate on pairs without clearing drafts", async () => {
    const f = await fixture();
    f.positive.value = "日本語\n{a|0.4::b}";
    f.negative.value = "negative\ntext";
    f.choose("anima/");
    f.dialogs.names.push("custom");
    await f.click("Save as");
    assert.deepEqual(f.library.anima.custom, { positive: f.positive.value, negative: f.negative.value });
    f.choose("SDXL/base");
    await f.click("Load");
    assert.equal(f.positive.value, "quality, {prompt}");
    assert.equal(f.negative.value, "bad quality");
    f.positive.value = "edited positive";
    f.negative.value = "edited negative";
    await f.click("Save");
    assert.deepEqual(f.library.SDXL.base, { positive: "edited positive", negative: "edited negative" });
    await f.click("Delete");
    assert.equal(Object.hasOwn(f.library.SDXL, "base"), false);
    assert.equal(f.positive.value, "edited positive");
    assert.equal(f.negative.value, "edited negative");
    assert.equal(f.node.properties.promptStyleName, "");
});

test("Apply follows Forge template and append rules without changing the saved style", async () => {
    const f = await fixture();
    f.positive.value = "a cat";
    f.negative.value = "blur";
    f.choose("SDXL/base");
    await f.click("Apply");
    assert.equal(f.positive.value, "quality, a cat");
    assert.equal(f.negative.value, "blur, bad quality");
    assert.equal(f.library.SDXL.base.positive, "quality, {prompt}");
    f.choose("anima/base");
    await f.click("Apply");
    assert.equal(f.positive.value, "quality, a cat, anima positive");
    assert.equal(f.negative.value, "blur, bad quality, anima negative");
});

test("Save requires confirmation for the selected existing preset and cancellation sends no write", async () => {
    const f = await fixture();
    f.choose("SDXL/base");
    const original = structuredClone(f.library.SDXL.base);
    f.positive.value = "new positive";
    f.negative.value = "new negative";
    f.dialogs.accept = false;
    await f.click("Save");
    assert.equal(f.dialogs.confirmations.length, 1);
    assert.match(f.dialogs.confirmations[0], /SDXL \/ base/);
    assert.match(f.dialogs.confirmations[0], /positive and negative/);
    assert.equal(f.writes.length, 0);
    assert.deepEqual(f.library.SDXL.base, original);
    assert.equal(f.positive.value, "new positive");
    assert.equal(f.negative.value, "new negative");
    assert.equal(f.select.value, "base");
    f.dialogs.accept = true;
    await f.click("Save");
    assert.equal(f.dialogs.confirmations.length, 2);
    assert.equal(f.writes.length, 1);
    assert.deepEqual(f.library.SDXL.base, { positive: "new positive", negative: "new negative" });
});

test("saving a new name does not ask to overwrite", async () => {
    const f = await fixture();
    f.dialogs.names.push("new");
    await f.click("Save");
    assert.equal(f.dialogs.confirmations.length, 0);
    assert.equal(f.writes.length, 1);
    assert.equal(f.writes[0].body.overwrite, false);
});

test("cancelled replacement, overwrite and deletion keep text and library", async () => {
    const f = await fixture();
    f.positive.value = "unsaved draft";
    f.negative.value = "unsaved negative";
    f.choose("SDXL/base");
    f.dialogs.accept = false;
    await f.click("Load");
    assert.equal(f.positive.value, "unsaved draft");
    assert.equal(f.negative.value, "unsaved negative");
    f.dialogs.names.push("base");
    await f.click("Save as");
    await f.click("Delete");
    assert.equal(f.library.SDXL.base.positive, "quality, {prompt}");
});

test("restore keeps ordinary text widgets, selection, and existing serialization", async () => {
    const f = await fixture();
    f.positive.value = "restored local positive";
    f.negative.value = "restored local negative";
    f.node.properties = { promptStyleFolder: "anima", promptStyleName: "base" };
    f.node.onConfigure({});
    assert.equal(f.folderSelect.value, "anima");
    assert.equal(f.select.value, "base");
    assert.equal(f.positive.value, "restored local positive");
    assert.equal(f.negative.value, "restored local negative");
    assert.deepEqual(f.node.widgets.filter((w) => w.serialize !== false).map((w) => w.name), ["positive", "negative"]);
    assert.equal(f.node.onSerialize, f.serialize);
    assert.doesNotThrow(() => structuredClone(f.node.properties));
    f.extension.nodeCreated(Object.freeze({ comfyClass: "PromptPresetBuilder" }));
});
