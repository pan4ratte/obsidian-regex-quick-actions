import { App, ButtonComponent, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { t } from './i18n';

interface RegexPipelineSettings {
    rules: string[];
}

const DEFAULT_SETTINGS: RegexPipelineSettings = {
    rules: []
}

export default class RegexPipeline extends Plugin {
    settings: RegexPipelineSettings;
    pathToRulesets: string;
    menu: ApplyRuleSetMenu;

    async onload() {
        await this.loadSettings();
        this.pathToRulesets = this.app.vault.configDir + "/regex-rulesets";
        this.addSettingTab(new ORPSettings(this.app, this));
        this.menu = new ApplyRuleSetMenu(this.app, this);
        this.menu.contentEl.className = "rulesets-menu-content";

        this.addCommand({
            id: 'apply-ruleset',
            name: t('APPLY_RULESET'),
            checkCallback: (checking: boolean) => {
                let leaf = this.app.workspace.activeLeaf;
                if (leaf) {
                    if (!checking) {
                        this.menu.open();
                    }
                    return true;
                }
                return false;
            }
        });

        await this.reloadRulesets();
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
            const index = this.settings.rules.indexOf(oldName);
            if (index !== -1) {
                this.settings.rules[index] = newName;
                await this.saveSettings();
            }
        }
        return true;
    }

    async deleteRuleset(name: string): Promise<void> {
        const path = this.pathToRulesets + "/" + name;
        if (await this.app.vault.adapter.exists(path)) {
            await this.app.vault.adapter.remove(path);
        }
        this.settings.rules = this.settings.rules.filter(r => r !== name);
        await this.saveSettings();
    }

    async applyRuleset(ruleset: string) {
        if (!await this.app.vault.adapter.exists(ruleset)) {
            new Notice(ruleset + t('NOT_FOUND_ERR'));
            return;
        }

        const ruleParser = /^"(.+?)"([a-z]*?)(?:\r\n|\r|\n)?->(?:\r\n|\r|\n)?"(.*?)"([a-z]*?)(?:\r\n|\r|\n)?$/gmus;
        const ruleText = await this.app.vault.adapter.read(ruleset);
        
        const activeMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeMarkdownView) return;

        const editor = activeMarkdownView.editor;
        let subject = editor.somethingSelected() ? editor.getSelection() : editor.getValue();
        const pos = editor.getScrollInfo();
        
        let count = 0;
        let ruleMatches;
        
        while ((ruleMatches = ruleParser.exec(ruleText)) !== null) {
            const [ , pattern, flags, replacement, mode ] = ruleMatches;
            try {
                const matchRule = new RegExp(pattern, flags || 'gm');
                subject = mode === 'x' ? subject.replace(matchRule, '') : subject.replace(matchRule, replacement);
                count++;
            } catch (e) {
                console.error(`Regex Pipeline: Invalid Regex in ${ruleset}`, e);
            }
        }

        if (editor.somethingSelected()) editor.replaceSelection(subject);
        else editor.setValue(subject);
        
        editor.scrollTo(0, pos.top);
        new Notice(t('EXECUTED_MSG', ruleset, count));
    }
}

/**
 * Custom Confirmation Modal following Obsidian guidelines
 */
class ConfirmationModal extends Modal {
    constructor(app: App, private title: string, private message: string, private onConfirm: () => void) {
        super(app);
    }

    onOpen() {
        const { contentEl } = this;
        this.titleEl.setText(this.title);
        contentEl.createEl("p", { text: this.message });

        const btnContainer = contentEl.createEl("div", { cls: "orp-modal-buttons" });
        
        new ButtonComponent(btnContainer)
            .setButtonText(t('CANCEL'))
            .onClick(() => this.close());

        new ButtonComponent(btnContainer)
            .setButtonText(t('DELETE_TOOLTIP'))
            .setWarning()
            .onClick(() => {
                this.onConfirm();
                this.close();
            });
    }

    onClose() {
        this.contentEl.empty();
    }
}

class ORPSettings extends PluginSettingTab {
    plugin: RegexPipeline;
    showCreationForm = false;
    editingRule: string | null = null;
    
    tempName = "";
    tempPattern = "";
    tempFlags = "gm";
    tempReplacement = "";

    constructor(app: App, plugin: RegexPipeline) {
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
            const isEditing = this.editingRule === name;

            if (isEditing) {
                this.renderFormFields(itemRow, () => this.handleUpdate(name), true);
            } else {
                let content = "";
                try {
                    content = await this.plugin.app.vault.adapter.read(this.plugin.pathToRulesets + "/" + name);
                } catch (e) { content = ""; }

                const { pattern, flags, replacement } = this.parseRuleContent(content);

                const nameWrap = itemRow.createEl("div", { cls: "orp-input-wrap orp-name-field" });
                nameWrap.createEl("small", { text: t('NAME'), cls: "orp-label" });
                nameWrap.createEl("div", { text: name, cls: "orp-saved-text-display" });

                const fieldsRow = itemRow.createEl("div", { cls: "orp-fields-row" });

                const patternWrap = fieldsRow.createEl("div", { cls: "orp-input-wrap orp-pattern-field" });
                patternWrap.createEl("small", { text: "Search Regex", cls: "orp-label" });
                patternWrap.createEl("div", { text: pattern, cls: "orp-saved-text-display" });

                const flagsWrap = fieldsRow.createEl("div", { cls: "orp-input-wrap orp-flags-field" });
                flagsWrap.createEl("small", { text: "Flags", cls: "orp-label" });
                flagsWrap.createEl("div", { text: flags, cls: "orp-saved-text-display" });

                const replaceWrap = fieldsRow.createEl("div", { cls: "orp-input-wrap orp-replacement-field" });
                replaceWrap.createEl("small", { text: "Replacement", cls: "orp-label" });
                replaceWrap.createEl("div", { text: replacement, cls: "orp-saved-text-display" });

                const actionsWrap = itemRow.createEl("div", { cls: "orp-input-wrap orp-creation-actions" });
                const buttons = actionsWrap.createEl("div", { cls: "orp-action-buttons" });

                new ButtonComponent(buttons).setButtonText(t('EDIT_TOOLTIP')).onClick(() => {
                    this.parseContentToFields(name, content);
                    this.editingRule = name;
                    this.showCreationForm = false;
                    this.display();
                });

                new ButtonComponent(buttons).setButtonText(t('DELETE_TOOLTIP')).setWarning().onClick(() => {
                    new ConfirmationModal(
                        this.app, 
                        t('DELETE_TOOLTIP'), 
                        t('DELETE_CONFIRM', name), 
                        async () => {
                            await this.plugin.deleteRuleset(name);
                            this.display();
                        }
                    ).open();
                });
            }
        });
    }

    private renderFormFields(container: HTMLElement, onConfirm: () => void, isUpdate = false) {
        const nameWrap = container.createEl("div", { cls: "orp-input-wrap orp-name-field" });
        nameWrap.createEl("small", { text: t('NAME'), cls: "orp-label" });
        const nameInput = nameWrap.createEl("input", { type: "text", value: this.tempName, placeholder: t('PLACEHOLDER_NAME'), cls: "orp-input" });
        nameInput.addEventListener("input", (e) => this.tempName = (e.target as HTMLInputElement).value);

        const fieldsRow = container.createEl("div", { cls: "orp-fields-row" });

        const patternWrap = fieldsRow.createEl("div", { cls: "orp-input-wrap orp-pattern-field" });
        patternWrap.createEl("small", { text: "Search Regex", cls: "orp-label" });
        const patternInput = patternWrap.createEl("input", { type: "text", value: this.tempPattern, placeholder: "Search", cls: "orp-input" });
        patternInput.addEventListener("input", (e) => this.tempPattern = (e.target as HTMLInputElement).value);

        const flagsWrap = fieldsRow.createEl("div", { cls: "orp-input-wrap orp-flags-field" });
        flagsWrap.createEl("small", { text: "Flags", cls: "orp-label" });
        const flagsInput = flagsWrap.createEl("input", { type: "text", value: this.tempFlags, placeholder: "Flags", cls: "orp-input" });
        flagsInput.addEventListener("input", (e) => this.tempFlags = (e.target as HTMLInputElement).value);

        const replaceWrap = fieldsRow.createEl("div", { cls: "orp-input-wrap orp-replacement-field" });
        replaceWrap.createEl("small", { text: "Replacement", cls: "orp-label" });
        const replaceInput = replaceWrap.createEl("input", { type: "text", value: this.tempReplacement, placeholder: "Replace", cls: "orp-input" });
        replaceInput.addEventListener("input", (e) => this.tempReplacement = (e.target as HTMLInputElement).value);

        const actionsWrap = container.createEl("div", { cls: "orp-input-wrap orp-creation-actions" });
        const buttons = actionsWrap.createEl("div", { cls: "orp-action-buttons" });

        new ButtonComponent(buttons).setButtonText(isUpdate ? t('UPDATE') : t('SAVE')).setCta().onClick(onConfirm);
        new ButtonComponent(buttons).setButtonText(t('CANCEL')).onClick(() => {
            this.editingRule = null;
            this.showCreationForm = false;
            this.display();
        });
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

class ApplyRuleSetMenu extends Modal {
    plugin: RegexPipeline;
    constructor(app: App, plugin: RegexPipeline) {
        super(app);
        this.plugin = plugin;
    }
    onOpen() {
        this.titleEl.setText(t('APPLY_RULESET'));
        const grid = this.contentEl.createEl("div", { cls: "rulesets-menu-content" });
        this.plugin.settings.rules.forEach(rule => {
            new ButtonComponent(grid).setButtonText(rule).onClick(() => {
                this.plugin.applyRuleset(this.plugin.pathToRulesets + "/" + rule);
                this.close();
            });
        });
    }
    onClose() { this.contentEl.empty(); }
}