import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../web/prompt_style_presets.js", import.meta.url), "utf8")
    .replace(/^import .*;\r?\n/gm, "");

class Element {
    constructor(tagName) {
        this.tagName = tagName;
        this.children = [];
        this.events = {};
        this.style = {};
        this.value = "";
        this.textContent = "";
    }
    append(...children) { this.children.push(...children); }
    add(child) { this.append(child); }
    replaceChildren(...children) { this.children = children; }
    setAttribute() {}
    addEventListener(name, callback) { this.events[name] = callback; }
    remove() {}
    focus() {}
    select() {}
}

function descendants(element) {
    return [element, ...element.children.filter((child) => child instanceof Element).flatMap(descendants)];
}

const textOf = (elements) => elements.map((element) => element.textContent).join("\n");

function pickFolder(folderSelect, newFolder, folder) {
    const known = folderSelect.children.some((option) => option.value === folder);
    folderSelect.value = known ? folder : "";
    newFolder.value = known ? "" : folder;
    folderSelect.events.change();
    newFolder.events.input();
}

// Answers the Move / Copy dialog with the next entry of dialogs.transfers:
// {from: "folder/name", copy, to: "folder", click: "Move" | "Copy" | "Overwrite" | "Keep both"}.
// The text and the visible buttons after filling it in land in dialogs.shown.
function answerTransfer(elements, dialogs) {
    const [fromFolder, fromName, toFolder] = elements.filter((element) => element.tagName === "select");
    const [moveRadio, copyRadio] = elements.filter((element) => element.type === "radio");
    const newFolder = elements.find((element) => element.tagName === "input" && element.type !== "radio");
    const buttons = elements.filter((element) => element.tagName === "button");
    const entry = dialogs.transfers.shift() ?? { click: "Cancel" };
    if (entry.from) {
        const [folder, name] = entry.from.split("/");
        fromFolder.value = folder;
        fromFolder.events.change();
        fromName.value = name;
        fromName.events.change();
    }
    if (entry.copy) {
        moveRadio.checked = false;
        copyRadio.checked = true;
        copyRadio.events.change();
    }
    if (entry.to) pickFolder(toFolder, newFolder, entry.to);
    const visible = buttons.filter((button) => button.style.display !== "none");
    dialogs.shown.push({
        from: `${fromFolder.value}/${fromName.value}`, to: toFolder.value, text: textOf(elements),
        buttons: visible.map((button) => button.textContent + (button.disabled ? " (disabled)" : "")),
    });
    const target = visible.find((button) => button.textContent === entry.click && !button.disabled);
    (target ?? buttons[0]).events.click();
}

// Answers each modal as it opens: a form takes the next entry of dialogs.names
// ("name" or {folder, name}; none cancels), a confirmation follows dialogs.accept.
// Both the overwrite warning of a form and a confirmation message land in dialogs.confirmations.
// A form whose button stays disabled is cancelled and its text lands in dialogs.refused.
function answerDialog(overlay, dialogs) {
    const elements = descendants(overlay);
    if (elements.some((element) => element.type === "radio")) return answerTransfer(elements, dialogs);
    const [cancel, ok] = elements.filter((element) => element.tagName === "button");
    const inputs = elements.filter((element) => element.tagName === "input");
    const [newFolder, nameInput] = inputs.length === 1 ? [null, inputs[0]] : inputs;
    if (!nameInput) {
        dialogs.confirmations.push(elements.map((element) => element.textContent).join("\n"));
        return (dialogs.accept ? ok : cancel).events.click();
    }
    const entry = dialogs.names.shift();
    if (entry === undefined) return cancel.events.click();
    const { folder, name } = typeof entry === "string" ? { name: entry } : entry;
    if (folder !== undefined) pickFolder(elements.find((element) => element.tagName === "select"), newFolder, folder);
    nameInput.value = name;
    nameInput.events.input();
    if (ok.disabled) {
        dialogs.refused.push(textOf(elements));
        return cancel.events.click();
    }
    if (ok.textContent === "Overwrite") {
        dialogs.confirmations.push(elements.map((element) => element.textContent).join("\n"));
        if (!dialogs.accept) return cancel.events.click();
    }
    ok.events.click();
}

async function fixture() {
    let extension;
    const library = Object.create(null);
    library.SDXL = { base: { positive: "quality, {prompt}", negative: "bad quality" } };
    library.anima = { base: { positive: "anima positive", negative: "anima negative" } };
    const dialogs = { names: [], accept: true, confirmations: [], refused: [], transfers: [], shown: [] };
    const writes = [];
    const api = {
        async fetchApi(path, options) {
            let data;
            let status = 200;
            const body = options.body ? JSON.parse(options.body) : null;
            if (body) writes.push({ path, body });
            const exists = (folder, name) => Object.hasOwn(library[folder] ?? {}, name);
            if (path.endsWith("/styles")) data = { styles: structuredClone(library) };
            else if (path.endsWith("/style/move")) {
                if (exists(body.to_folder, body.to_name) && !body.overwrite) {
                    status = 409;
                } else {
                    const style = library[body.folder][body.name];
                    if (!body.copy) delete library[body.folder][body.name];
                    library[body.to_folder] ??= {};
                    library[body.to_folder][body.to_name] = { ...style };
                }
            } else if (path.endsWith("/style/folder")) {
                if (Object.hasOwn(library, body.folder)) status = 409;
                else library[body.folder] = {};
            } else if (path.endsWith("/style/folder/rename")) {
                library[body.to_folder] = library[body.folder];
                delete library[body.folder];
            } else if (path.endsWith("/style/folder/delete")) {
                delete library[body.folder];
            } else if (path.endsWith("/style/delete")) {
                delete library[body.folder][body.name];
                data = { ok: true };
            } else if (exists(body.folder, body.name) && !body.overwrite) {
                status = 409;
                data = { error: "exists" };
            } else {
                library[body.folder] ??= {};
                library[body.folder][body.name] = { positive: body.positive, negative: body.negative };
                data = { folder: body.folder, name: body.name };
            }
            data ??= status === 200 ? {} : { error: "exists" };
            return { ok: status === 200, status, json: async () => data, text: async () => JSON.stringify(data) };
        },
    };
    vm.runInNewContext(source, {
        app: { registerExtension(value) { extension = value; } }, api,
        document: {
            createElement(tagName) { return new Element(tagName); },
            body: { append(overlay) { queueMicrotask(() => answerDialog(overlay, dialogs)); } },
        },
        Option: class { constructor(text, value) { this.text = text; this.value = value; } },
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
    const [folderRow, presetRow, buttons, status] = node.widgets[0].element.children;
    const [folderSelect, renameFolderButton, deleteFolderButton] = folderRow.children;
    const [select, renameButton, deleteButton] = presetRow.children;
    return {
        node, extension, library, dialogs, positive, negative, folderSelect, renameFolderButton, deleteFolderButton,
        select, renameButton, deleteButton, buttons, status, serialize, writes,
        choose(path) {
            const [folder, name] = path.split("/");
            folderSelect.value = folder;
            folderSelect.events.change();
            select.value = name;
            select.events.change();
        },
        async click(name) {
            await [...buttons.children, renameButton, deleteButton].find((button) => button.textContent === name).events.click();
        },
        folderOptions() { return folderSelect.children.map((option) => option.value); },
        async newFolder() {
            folderSelect.value = "";
            folderSelect.events.change();
            for (let i = 0; i < 10; i++) await new Promise(setImmediate);
        },
    };
}

test("save, load, edit, save as and delete operate on pairs without clearing drafts", async () => {
    const f = await fixture();
    f.positive.value = "日本語\n{a|0.4::b}";
    f.negative.value = "negative\ntext";
    f.dialogs.names.push({ folder: "anima", name: "custom" });
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

test("Apply appends to both prompts without changing the saved style", async () => {
    const f = await fixture();
    f.positive.value = "a cat";
    f.negative.value = "blur";
    f.choose("SDXL/base");
    await f.click("Apply");
    assert.equal(f.positive.value, "a cat, quality, {prompt}");
    assert.equal(f.negative.value, "blur, bad quality");
    assert.equal(f.library.SDXL.base.positive, "quality, {prompt}");
    f.choose("anima/base");
    await f.click("Apply");
    assert.equal(f.positive.value, "a cat, quality, {prompt}, anima positive");
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

test("Move / Copy picks source and destination in one dialog and keeps names unless they clash", async () => {
    const f = await fixture();
    f.dialogs.transfers.push({ to: "anima", click: "Keep both" });
    await f.click("Move / Copy");
    const [first] = f.dialogs.shown;
    assert.equal(first.from, "SDXL/base");
    assert.deepEqual(first.buttons, ["Cancel", "Overwrite", "Keep both"]);
    assert.match(first.text, /"anima \/ base" already exists[\s\S]*"base_2"/);
    assert.equal(f.library.SDXL.base, undefined);
    assert.deepEqual(f.library.anima.base_2, { positive: "quality, {prompt}", negative: "bad quality" });
    assert.deepEqual(f.library.SDXL, {});
    assert.equal(f.folderSelect.value, "anima");
    assert.equal(f.select.value, "base_2");

    f.dialogs.transfers.push({ from: "anima/base", copy: true, to: "anima", click: "Keep both" });
    await f.click("Move / Copy");
    assert.deepEqual(f.dialogs.shown.at(-1).buttons, ["Cancel", "Keep both"]);
    assert.ok(f.library.anima.base && f.library.anima.base_3);

    const writes = f.writes.length;
    f.dialogs.transfers.push({ from: "anima/base", to: "anima", click: "Move" });
    await f.click("Move / Copy");
    assert.deepEqual(f.dialogs.shown.at(-1).buttons, ["Cancel", "Move (disabled)"]);
    assert.equal(f.writes.length, writes);

    f.dialogs.transfers.push({ from: "anima/base", copy: true, to: "krea2", click: "Copy" });
    await f.click("Move / Copy");
    assert.deepEqual(f.library.krea2.base, f.library.anima.base);

    f.library.anima.base = { positive: "new", negative: "" };
    f.dialogs.transfers.push({ from: "anima/base", copy: true, to: "krea2", click: "Overwrite" });
    await f.click("Move / Copy");
    assert.deepEqual(f.library.krea2, { base: { positive: "new", negative: "" } });

    const before = f.writes.length;
    await f.click("Move / Copy");
    assert.equal(f.writes.length, before);
});

test("folder row creates, renames and deletes folders; Uncategorized is fixed", async () => {
    const f = await fixture();
    assert.deepEqual(f.folderOptions(), ["SDXL", "Uncategorized", "anima", ""]);
    f.choose("Uncategorized/");
    assert.equal(f.renameFolderButton.disabled, true);
    assert.equal(f.deleteFolderButton.disabled, true);

    await f.newFolder();
    assert.equal(f.folderSelect.value, "Uncategorized");
    f.dialogs.names.push("anima");
    await f.newFolder();
    assert.match(f.dialogs.refused.at(-1), /"anima" already exists/);
    f.dialogs.names.push("krea2");
    await f.newFolder();
    assert.deepEqual(f.library.krea2, {});
    assert.equal(f.folderSelect.value, "krea2");

    f.choose("anima/base");
    for (const name of ["SDXL", "Uncategorized"]) {
        f.dialogs.names.push(name);
        await f.renameFolderButton.events.click();
        assert.match(f.dialogs.refused.at(-1), new RegExp(`"${name}" already exists`));
    }
    f.dialogs.names.push("anima2");
    await f.renameFolderButton.events.click();
    assert.equal(f.library.anima, undefined);
    assert.equal(f.folderSelect.value, "anima2");
    assert.equal(f.select.value, "base");

    f.dialogs.accept = false;
    await f.deleteFolderButton.events.click();
    assert.match(f.dialogs.confirmations.at(-1), /Delete folder "anima2" and the 1 style in it/);
    assert.ok(f.library.anima2);
    f.dialogs.accept = true;
    await f.deleteFolderButton.events.click();
    assert.equal(f.library.anima2, undefined);
    assert.ok(!f.folderOptions().includes("anima2"));
});

test("preset row renames and deletes only the selected preset", async () => {
    const f = await fixture();
    assert.equal(f.renameButton.disabled, true);
    assert.equal(f.deleteButton.disabled, true);
    f.choose("SDXL/base");
    assert.equal(f.renameButton.disabled, false);
    f.dialogs.names.push("renamed");
    await f.click("Rename");
    assert.deepEqual(Object.keys(f.library.SDXL), ["renamed"]);
    assert.equal(f.select.value, "renamed");
    await f.click("Delete");
    assert.deepEqual(f.library.SDXL, {});
    assert.ok(f.folderOptions().includes("SDXL"));
    assert.equal(f.deleteButton.disabled, true);
    assert.deepEqual(f.buttons.children.map((button) => button.textContent),
        ["Load", "Apply", "Save", "Save as", "Move / Copy", "Refresh"]);
});

test("workflows saved before folders find their style in Uncategorized", async () => {
    const f = await fixture();
    f.library.Uncategorized = { old: { positive: "old positive", negative: "" } };
    await f.click("Refresh");
    f.node.properties = { promptStyleName: "old" };
    f.node.onConfigure({});
    assert.equal(f.folderSelect.value, "Uncategorized");
    assert.equal(f.select.value, "old");
    await f.click("Load");
    assert.equal(f.positive.value, "old positive");
});
