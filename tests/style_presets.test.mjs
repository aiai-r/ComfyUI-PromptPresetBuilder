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
    library["SDXL/base"] = { positive: "quality, {prompt}", negative: "bad quality" };
    library["anima/base"] = { positive: "anima positive", negative: "anima negative" };
    const dialogs = { names: [], accept: true };
    const api = {
        async fetchApi(path, options) {
            let data;
            let status = 200;
            const body = options.body ? JSON.parse(options.body) : null;
            if (path.endsWith("/styles")) data = { styles: structuredClone(library) };
            else if (path.endsWith("/style/delete")) {
                delete library[body.name];
                data = { ok: true };
            } else if (Object.hasOwn(library, body.name) && !body.overwrite) {
                status = 409;
                data = { error: "exists" };
            } else {
                library[body.name] = { positive: body.positive, negative: body.negative };
                data = { name: body.name };
            }
            return { ok: status === 200, status, json: async () => data, text: async () => JSON.stringify(data) };
        },
    };
    vm.runInNewContext(source, {
        app: { registerExtension(value) { extension = value; } }, api,
        document: { createElement() { return new Element(); } },
        Option: class { constructor(text, value) { this.text = text; this.value = value; } },
        window: { prompt() { return dialogs.names.shift(); }, confirm() { return dialogs.accept; } },
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
    const [select, buttons, status] = node.widgets[0].element.children;
    return {
        node, extension, library, dialogs, positive, negative, select, status, serialize,
        choose(name) { select.value = name; select.events.change(); },
        async click(name) { await buttons.children.find((button) => button.textContent === name).events.click(); },
    };
}

test("save, load, edit, save as and delete operate on pairs without clearing drafts", async () => {
    const f = await fixture();
    f.positive.value = "日本語\n{a|0.4::b}";
    f.negative.value = "negative\ntext";
    f.dialogs.names.push("anima/custom");
    await f.click("Save as");
    assert.deepEqual(f.library["anima/custom"], { positive: f.positive.value, negative: f.negative.value });
    f.choose("SDXL/base");
    await f.click("Load");
    assert.equal(f.positive.value, "quality, {prompt}");
    assert.equal(f.negative.value, "bad quality");
    f.positive.value = "edited positive";
    f.negative.value = "edited negative";
    await f.click("Save");
    assert.deepEqual(f.library["SDXL/base"], { positive: "edited positive", negative: "edited negative" });
    await f.click("Delete");
    assert.equal(Object.hasOwn(f.library, "SDXL/base"), false);
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
    assert.equal(f.library["SDXL/base"].positive, "quality, {prompt}");
    f.choose("anima/base");
    await f.click("Apply");
    assert.equal(f.positive.value, "quality, a cat, anima positive");
    assert.equal(f.negative.value, "blur, bad quality, anima negative");
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
    f.dialogs.names.push("SDXL/base");
    await f.click("Save as");
    await f.click("Delete");
    assert.equal(f.library["SDXL/base"].positive, "quality, {prompt}");
});

test("restore keeps ordinary text widgets, selection, and existing serialization", async () => {
    const f = await fixture();
    f.positive.value = "restored local positive";
    f.negative.value = "restored local negative";
    f.node.properties = { promptStyleName: "anima/base" };
    f.node.onConfigure({});
    assert.equal(f.select.value, "anima/base");
    assert.equal(f.positive.value, "restored local positive");
    assert.equal(f.negative.value, "restored local negative");
    assert.deepEqual(f.node.widgets.filter((w) => w.serialize !== false).map((w) => w.name), ["positive", "negative"]);
    assert.equal(f.node.onSerialize, f.serialize);
    assert.doesNotThrow(() => structuredClone(f.node.properties));
    f.extension.nodeCreated(Object.freeze({ comfyClass: "PromptPresetBuilder" }));
});
