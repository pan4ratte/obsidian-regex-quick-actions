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
            if (await this.app.vault.adapter.exists(oldPath)) await this.app.vault.adapter.remove(oldPath);
            this.settings.rules = this.settings.rules.map(r => r === oldName ? newName : r);
            await this.saveSettings();
        }
        return true;
    }

    async deleteRuleset(name: string): Promise<void> {
        const path = this.pathToRulesets + "/" + name;
        if (await this.app.vault.adapter.exists(path)) await this.app.vault.adapter.remove(path);
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

        let subject = activeMarkdownView.editor.somethingSelected() 
            ? activeMarkdownView.editor.getSelection() 
            : activeMarkdownView.editor.getValue();

        const pos = activeMarkdownView.editor.getScrollInfo();
        let count = 0;
        let ruleMatches;
        while ((ruleMatches = ruleParser.exec(ruleText)) !== null) {
            const matchRule = ruleMatches[2].length === 0 ? new RegExp(ruleMatches[1], 'gm') : new RegExp(ruleMatches[1], ruleMatches[2]);
            subject = ruleMatches[4] === 'x' ? subject.replace(matchRule, '') : subject.replace(matchRule, ruleMatches[3]);
            count++;
        }
        if (activeMarkdownView.editor.somethingSelected()) activeMarkdownView.editor.replaceSelection(subject);
        else activeMarkdownView.editor.setValue(subject);
        activeMarkdownView.editor.scrollTo(0, pos.top);
        new Notice(t('EXECUTED_MSG', ruleset, count));
    }
}

class ORPSettings extends PluginSettingTab {
    plugin: RegexPipeline;
    showCreationForm = false;
    isEditing = false;
    editingOriginalName = "";
    tempName = "";
    tempContent = "";

    constructor(app: App, plugin: RegexPipeline) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl("h2", { text: t('PLUGIN_NAME') });
        containerEl.createEl("p", { 
            text: t('PLUGIN_DESC'),
            cls: "orp-settings-description" 
        });

        containerEl.createEl("h2", { text: t('MANAGE_RULESETS') });

        new Setting(containerEl)
            .setName(t('CREATE_NEW_RULESET'))
            .addButton(btn => btn
                .setButtonText(t('CREATE_NEW'))
                .setCta()
                .onClick(() => {
                    this.isEditing = false;
                    this.tempName = "";
                    this.tempContent = "";
                    this.showCreationForm = !this.showCreationForm;
                    this.display();
                }));

        if (this.showCreationForm) {
            const rowContainer = containerEl.createEl("div", { cls: "orp-creation-row" });
            
            const nameWrap = rowContainer.createEl("div", { cls: "orp-input-wrap orp-creation-name" });
            nameWrap.createEl("small", { text: t('NAME'), cls: "orp-label" });
            const nameInput = nameWrap.createEl("input", { type: "text", value: this.tempName, placeholder: t('PLACEHOLDER_NAME'), cls: "orp-input" });
            nameInput.addEventListener("input", (e) => this.tempName = (e.target as HTMLInputElement).value);

            const rulesWrap = rowContainer.createEl("div", { cls: "orp-input-wrap orp-creation-rules" });
            rulesWrap.createEl("small", { text: t('RULES'), cls: "orp-label" });
            const rulesInput = rulesWrap.createEl("input", { type: "text", value: this.tempContent, placeholder: t('PLACEHOLDER_RULES'), cls: "orp-input" });
            rulesInput.addEventListener("input", (e) => this.tempContent = (e.target as HTMLInputElement).value);

            const actionsWrap = rowContainer.createEl("div", { cls: "orp-input-wrap orp-creation-actions" });
            const buttons = actionsWrap.createEl("div", { cls: "orp-action-buttons" });
            
            new ButtonComponent(buttons).setButtonText(this.isEditing ? t('UPDATE') : t('SAVE')).setCta().onClick(async () => {
                const success = this.isEditing 
                    ? await this.plugin.updateRuleset(this.editingOriginalName, this.tempName, this.tempContent)
                    : await this.plugin.createRuleset(this.tempName, this.tempContent);
                if (success) {
                    this.showCreationForm = false;
                    await this.plugin.reloadRulesets();
                    this.display();
                } else new Notice(t('NAME_EXISTS_ERR'));
            });

            new ButtonComponent(buttons).setButtonText(t('CANCEL')).onClick(() => {
                this.showCreationForm = false;
                this.display();
            });
        }

        const listWrapper = containerEl.createEl("div", { cls: "orp-saved-list" });
        this.plugin.settings.rules.forEach(async name => {
            const content = await this.plugin.app.vault.adapter.read(this.plugin.pathToRulesets + "/" + name);
            const itemRow = listWrapper.createEl("div", { cls: "orp-saved-rule-item orp-creation-row" });

            const nameWrap = itemRow.createEl("div", { cls: "orp-input-wrap orp-creation-name" });
            nameWrap.createEl("small", { text: t('NAME'), cls: "orp-label" });
            nameWrap.createEl("div", { text: name, cls: "orp-saved-text-display" });

            const rulesWrap = itemRow.createEl("div", { cls: "orp-input-wrap orp-creation-rules" });
            rulesWrap.createEl("small", { text: t('RULES'), cls: "orp-label" });
            rulesWrap.createEl("div", { text: content, cls: "orp-saved-text-display orp-font-monospace" });

            const actionsWrap = itemRow.createEl("div", { cls: "orp-input-wrap orp-creation-actions" });
            const buttons = actionsWrap.createEl("div", { cls: "orp-action-buttons" });

            new ButtonComponent(buttons).setIcon("pencil").setTooltip(t('EDIT_TOOLTIP')).onClick(() => {
                this.tempContent = content;
                this.tempName = name;
                this.editingOriginalName = name;
                this.isEditing = true;
                this.showCreationForm = true;
                this.display();
            });

            new ButtonComponent(buttons).setIcon("trash").setWarning().setTooltip(t('DELETE_TOOLTIP')).onClick(async () => {
                if (confirm(t('DELETE_CONFIRM', name))) {
                    await this.plugin.deleteRuleset(name);
                    this.display();
                }
            });
        });
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
            }).buttonEl.addClass("apply-ruleset-button");
        });
    }
    onClose() { this.contentEl.empty(); }
}