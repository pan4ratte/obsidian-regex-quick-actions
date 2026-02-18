import { App, ButtonComponent, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, Menu, TFile, TAbstractFile, ToggleComponent } from 'obsidian';
import { t } from './i18n';

interface RegexQuickActionsSettings {
    rules: string[];
    defaultRule: string | null;
}

const DEFAULT_SETTINGS: RegexQuickActionsSettings = {
    rules: [],
    defaultRule: null
}

export default class RegexQuickActions extends Plugin {
    settings: RegexQuickActionsSettings;
    pathToRulesets: string;

    async onload() {
        await this.loadSettings();
        this.pathToRulesets = this.app.vault.configDir + "/regex-rulesets";
        this.addSettingTab(new RegexQuickActionsSettingsTab(this.app, this));

        this.settings.rules.forEach(ruleName => {
            this.addRuleCommand(ruleName);
        });

        this.registerEvent(
            this.app.workspace.on("file-menu", (menu: Menu, file: TAbstractFile) => {
                if (file instanceof TFile && this.settings.defaultRule) {
                    menu.addItem((item) => {
                        item
                            .setTitle(t('PERFORM_DEFAULT'))
                            .setIcon("play")
                            .onClick(async () => {
                                await this.applyRulesetToFile(file, this.settings.defaultRule!);
                            });
                    });
                }
            })
        );

        this.registerEvent(
            this.app.workspace.on("editor-menu", (menu: Menu) => {
                if (this.settings.defaultRule) {
                    menu.addItem((item) => {
                        item
                            .setTitle(t('PERFORM_DEFAULT'))
                            .setIcon("play")
                            .onClick(async () => {
                                await this.applyRuleset(this.pathToRulesets + "/" + this.settings.defaultRule);
                            });
                    });
                }
            })
        );

        await this.reloadRulesets();
    }

    private getCommandId(name: string): string {
        return `apply-rule-${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
    }

    addRuleCommand(name: string) {
        this.addCommand({
            id: this.getCommandId(name),
            name: `${name}`,
            checkCallback: (checking: boolean) => {
                const activeMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (activeMarkdownView) {
                    if (!checking) {
                        this.applyRuleset(this.pathToRulesets + "/" + name);
                    }
                    return true;
                }
                return false;
            }
        });
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async reloadRulesets() {
        if (!await this.app.vault.adapter.exists(this.pathToRulesets)) {
            await this.app.vault.createFolder(this.pathToRulesets);
        }
    }

    async createRuleset(name: string, content: string): Promise<boolean> {
        const path = this.pathToRulesets + "/" + name;
        if (await this.app.vault.adapter.exists(path)) return false;
        
        await this.app.vault.adapter.write(path, content);
        if (!this.settings.rules.includes(name)) {
            this.settings.rules.push(name);
            await this.saveSettings();
            this.addRuleCommand(name);
        }
        return true;
    }

    async updateRuleset(oldName: string, newName: string, content: string): Promise<boolean> {
        const oldPath = this.pathToRulesets + "/" + oldName;
        const newPath = this.pathToRulesets + "/" + newName;
        
        if (oldName !== newName && await this.app.vault.adapter.exists(newPath)) return false;

        await this.app.vault.adapter.write(newPath, content);
        
        if (oldName !== newName) {
            if (await this.app.vault.adapter.exists(oldPath)) {
                await this.app.vault.adapter.remove(oldPath);
            }
            (this.app as any).commands.removeCommand(`${this.manifest.id}:${this.getCommandId(oldName)}`);

            const index = this.settings.rules.indexOf(oldName);
            if (index !== -1) {
                this.settings.rules[index] = newName;
                if (this.settings.defaultRule === oldName) this.settings.defaultRule = newName;
                await this.saveSettings();
                this.addRuleCommand(newName);
            }
        }
        return true;
    }

    async deleteRuleset(name: string): Promise<void> {
        const path = this.pathToRulesets + "/" + name;
        if (await this.app.vault.adapter.exists(path)) {
            await this.app.vault.adapter.remove(path);
        }
        
        (this.app as any).commands.removeCommand(`${this.manifest.id}:${this.getCommandId(name)}`);

        this.settings.rules = this.settings.rules.filter(r => r !== name);
        if (this.settings.defaultRule === name) this.settings.defaultRule = null;
        await this.saveSettings();
    }

    async applyRulesetToFile(file: TFile, rulesetName: string) {
        const path = this.pathToRulesets + "/" + rulesetName;
        if (!await this.app.vault.adapter.exists(path)) return;

        const ruleText = await this.app.vault.adapter.read(path);
        const fileContent = await this.app.vault.read(file);
        const result = this.processRegex(fileContent, ruleText, rulesetName);
        
        await this.app.vault.modify(file, result.content);
        new Notice(t('EXECUTED_MSG', rulesetName, result.count));
    }

    private processRegex(subject: string, ruleText: string, rulesetName: string): { content: string, count: number } {
        const ruleParser = /^"(.+?)"([a-z]*?)(?:\r\n|\r|\n)?->(?:\r\n|\r|\n)?"(.*?)"([a-z]*?)(?:\r\n|\r|\n)?$/gmus;
        let count = 0;
        let ruleMatches;
        let output = subject;

        while ((ruleMatches = ruleParser.exec(ruleText)) !== null) {
            const [ , pattern, flags, replacement, mode ] = ruleMatches;
            try {
                const matchRule = new RegExp(pattern, flags || 'gm');
                output = mode === 'x' ? output.replace(matchRule, '') : output.replace(matchRule, replacement);
                count++;
            } catch (e) {
                console.error(`Regex Quick Actions: Invalid Regex in ${rulesetName}`, e);
            }
        }
        return { content: output, count };
    }

    async applyRuleset(rulesetPath: string) {
        if (!await this.app.vault.adapter.exists(rulesetPath)) {
            new Notice(rulesetPath + t('NOT_FOUND_ERR'));
            return;
        }

        const ruleText = await this.app.vault.adapter.read(rulesetPath);
        const activeMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeMarkdownView) return;

        const editor = activeMarkdownView.editor;
        let subject = editor.somethingSelected() ? editor.getSelection() : editor.getValue();
        const pos = editor.getScrollInfo();
        
        const result = this.processRegex(subject, ruleText, rulesetPath);

        if (editor.somethingSelected()) editor.replaceSelection(result.content);
        else editor.setValue(result.content);
        
        editor.scrollTo(0, pos.top);
        new Notice(t('EXECUTED_MSG', rulesetPath.split('/').pop() || '', result.count));
    }
}

class ConfirmationModal extends Modal {
    constructor(app: App, private title: string, private message: string, private onConfirm: () => void) {
        super(app);
    }

    onOpen() {
        const { contentEl } = this;
        this.titleEl.setText(this.title);
        contentEl.createEl("p", { text: this.message });
        const btnContainer = contentEl.createEl("div", { cls: "orp-modal-buttons" });
        
        new ButtonComponent(btnContainer).setButtonText(t('CANCEL')).onClick(() => this.close());
        new ButtonComponent(btnContainer).setButtonText(t('DELETE_TOOLTIP')).setWarning().onClick(() => {
            this.onConfirm();
            this.close();
        });
    }

    onClose() { this.contentEl.empty(); }
}

class RegexQuickActionsSettingsTab extends PluginSettingTab {
    plugin: RegexQuickActions;
    showCreationForm = false;
    editingRule: string | null = null;
    tempName = "";
    tempPattern = "";
    tempFlags = "gm";
    tempReplacement = "";

    constructor(app: App, plugin: RegexQuickActions) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl("h2", { text: t('PLUGIN_NAME') });
        containerEl.createEl("p", { text: t('PLUGIN_DESC'), cls: "orp-settings-description" });
        containerEl.createEl("h2", { text: t('MANAGE_RULESETS') });

        new Setting(containerEl)
            .setName(t('CREATE_NEW_RULESET'))
            .addButton(btn => btn
                .setButtonText(t('CREATE_NEW'))
                .setCta()
                .onClick(() => {
                    this.resetTempFields();
                    this.showCreationForm = !this.showCreationForm;
                    this.display();
                }));

        if (this.showCreationForm) {
            const formContainer = containerEl.createEl("div", { cls: "orp-creation-row" });
            this.renderFormFields(formContainer, () => this.handleSave());
        }

        const listWrapper = containerEl.createEl("div", { cls: "orp-saved-list" });
        this.plugin.settings.rules.forEach(async name => {
            const itemRow = listWrapper.createEl("div", { cls: "orp-saved-rule-item" });
            if (this.editingRule === name) {
                this.renderFormFields(itemRow, () => this.handleUpdate(name), true);
            } else {
                let content = "";
                try { content = await this.plugin.app.vault.adapter.read(this.plugin.pathToRulesets + "/" + name); } catch (e) {}

                const { pattern, flags, replacement } = this.parseRuleContent(content);
                const nameWrap = itemRow.createEl("div", { cls: "orp-input-wrap orp-name-field" });
                nameWrap.createEl("small", { text: t('NAME'), cls: "orp-label" });
                nameWrap.createEl("div", { text: name, cls: "orp-saved-text-display" });

                const fieldsRow = itemRow.createEl("div", { cls: "orp-fields-row" });
                this.createDisplayField(fieldsRow, t('SEARCH_REGEX'), pattern, "orp-pattern-field");
                this.createDisplayField(fieldsRow, t('FLAGS'), flags, "orp-flags-field");
                this.createDisplayField(fieldsRow, t('REPLACEMENT'), replacement, "orp-replacement-field");

                const actionsWrap = itemRow.createEl("div", { cls: "orp-input-wrap orp-creation-actions" });
                
                // Toggle instead of Checkbox
                const defaultWrap = actionsWrap.createEl("div", { cls: "orp-default-toggle-wrap" });
                
                const toggle = new ToggleComponent(defaultWrap)
                    .setValue(this.plugin.settings.defaultRule === name)
                    .onChange(async (value) => {
                        this.plugin.settings.defaultRule = value ? name : null;
                        await this.plugin.saveSettings();
                        this.display();
                    });

                defaultWrap.createSpan({ text: t('SET_AS_DEFAULT'), cls: "orp-toggle-label" });

                const buttons = actionsWrap.createEl("div", { cls: "orp-action-buttons" });

                new ButtonComponent(buttons).setButtonText(t('EDIT_TOOLTIP')).onClick(() => {
                    this.parseContentToFields(name, content);
                    this.editingRule = name;
                    this.showCreationForm = false;
                    this.display();
                });

                new ButtonComponent(buttons).setButtonText(t('DELETE_TOOLTIP')).setWarning().onClick(() => {
                    new ConfirmationModal(this.app, t('DELETE_TOOLTIP'), t('DELETE_CONFIRM', name), async () => {
                        await this.plugin.deleteRuleset(name);
                        this.display();
                    }).open();
                });
            }
        });
    }

    private createDisplayField(parent: HTMLElement, label: string, val: string, cls: string) {
        const wrap = parent.createEl("div", { cls: `orp-input-wrap ${cls}` });
        wrap.createEl("small", { text: label, cls: "orp-label" });
        wrap.createEl("div", { text: val, cls: "orp-saved-text-display" });
    }

    private renderFormFields(container: HTMLElement, onConfirm: () => void, isUpdate = false) {
        const nameWrap = container.createEl("div", { cls: "orp-input-wrap orp-name-field" });
        nameWrap.createEl("small", { text: t('NAME'), cls: "orp-label" });
        const nameInput = nameWrap.createEl("input", { type: "text", value: this.tempName, placeholder: t('PLACEHOLDER_NAME'), cls: "orp-input" });
        nameInput.addEventListener("input", (e) => this.tempName = (e.target as HTMLInputElement).value);

        const fieldsRow = container.createEl("div", { cls: "orp-fields-row" });
        this.createInputField(fieldsRow, t('SEARCH_REGEX'), this.tempPattern, t('PLACEHOLDER_SEARCH'), "orp-pattern-field", (v) => this.tempPattern = v);
        this.createInputField(fieldsRow, t('FLAGS'), this.tempFlags, t('PLACEHOLDER_FLAGS'), "orp-flags-field", (v) => this.tempFlags = v);
        this.createInputField(fieldsRow, t('REPLACEMENT'), this.tempReplacement, t('PLACEHOLDER_REPLACEMENT'), "orp-replacement-field", (v) => this.tempReplacement = v);

        const actionsWrap = container.createEl("div", { cls: "orp-input-wrap orp-creation-actions" });
        const buttons = actionsWrap.createEl("div", { cls: "orp-action-buttons" });
        new ButtonComponent(buttons).setButtonText(isUpdate ? t('UPDATE') : t('SAVE')).setCta().onClick(onConfirm);
        new ButtonComponent(buttons).setButtonText(t('CANCEL')).onClick(() => {
            this.editingRule = null;
            this.showCreationForm = false;
            this.display();
        });
    }

    private createInputField(parent: HTMLElement, label: string, val: string, ph: string, cls: string, onChange: (v: string) => void) {
        const wrap = parent.createEl("div", { cls: `orp-input-wrap ${cls}` });
        wrap.createEl("small", { text: label, cls: "orp-label" });
        const input = wrap.createEl("input", { type: "text", value: val, placeholder: ph, cls: "orp-input" });
        input.addEventListener("input", (e) => onChange((e.target as HTMLInputElement).value));
    }

    private async handleSave() {
        const content = `"${this.tempPattern}"${this.tempFlags}\n->\n"${this.tempReplacement}"`;
        if (await this.plugin.createRuleset(this.tempName, content)) {
            this.showCreationForm = false;
            this.display();
        } else new Notice(t('NAME_EXISTS_ERR'));
    }

    private async handleUpdate(oldName: string) {
        const content = `"${this.tempPattern}"${this.tempFlags}\n->\n"${this.tempReplacement}"`;
        if (await this.plugin.updateRuleset(oldName, this.tempName, content)) {
            this.editingRule = null;
            this.display();
        } else new Notice(t('NAME_EXISTS_ERR'));
    }

    private parseRuleContent(content: string) {
        const parser = /^"(.+?)"([a-z]*?)(?:\r\n|\r|\n)?->(?:\r\n|\r|\n)?"(.*?)"([a-z]*?)$/mus;
        const match = parser.exec(content);
        return {
            pattern: match ? match[1] : "",
            flags: match ? match[2] : "gm",
            replacement: match ? match[3] : ""
        };
    }

    private parseContentToFields(name: string, content: string) {
        const data = this.parseRuleContent(content);
        this.tempName = name;
        this.tempPattern = data.pattern;
        this.tempFlags = data.flags;
        this.tempReplacement = data.replacement;
    }

    private resetTempFields() {
        this.tempName = "";
        this.tempPattern = "";
        this.tempFlags = "gm";
        this.tempReplacement = "";
        this.editingRule = null;
    }
}