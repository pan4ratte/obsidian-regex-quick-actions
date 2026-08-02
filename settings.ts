import { App, ButtonComponent, Modal, PluginSettingTab, Setting, SettingDefinitionItem, ToggleComponent, Notice } from 'obsidian';
import { t } from './i18n';
import type RegexQuickActions from './main';

export class ConfirmationModal extends Modal {
    constructor(
        app: App,
        private title: string,
        private message: string,
        private confirmBtnText: string,
        private onConfirm: () => unknown
    ) {
        super(app);
    }

    onOpen() {
        const { contentEl } = this;
        this.titleEl.setText(this.title);
        contentEl.createEl("p", { text: this.message });
        const btnContainer = contentEl.createEl("div", { cls: "orp-modal-buttons" });
        new ButtonComponent(btnContainer).setButtonText(t('CANCEL')).onClick(() => this.close());
        new ButtonComponent(btnContainer)
            .setButtonText(this.confirmBtnText)
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

export class RegexQuickActionsSettingsTab extends PluginSettingTab {
    plugin: RegexQuickActions;
    showCreationForm = false;
    editingRule: string | null = null;
    tempName = "";
    tempPattern = "";
    tempFlags = "gm";
    tempReplacement = "";
    tempIsDefault = false;

    nameInputEl: HTMLInputElement;
    patternInputEl: HTMLInputElement;
    flagsInputEl: HTMLInputElement;

    /** Render root of the quick action manager, kept so state changes can redraw it in place. */
    private managerRootEl: HTMLElement | null = null;

    constructor(app: App, plugin: RegexQuickActions) {
        super(app, plugin);
        this.plugin = plugin;
    }

    /**
     * Declarative settings (Obsidian 1.13+). Every item uses `render` so the plugin keeps
     * full control of its DOM; `control` is deliberately unused. The list is static, so
     * state changes redraw the plugin's own root instead of calling update().
     */
    getSettingDefinitions(): SettingDefinitionItem[] {
        return [
            {
                type: 'group',
                cls: 'orp-settings-group',
                heading: t('PLUGIN_SETTINGS_HEADER'),
                items: [{
                    name: t('PLUGIN_SETTINGS_HEADER'),
                    desc: t('PLUGIN_DESC'),
                    aliases: ['regex', 'regexp', t('RUN_QUICK_ACTION')],
                    render: (setting) => {
                        const root = this.acquireRoot(setting, 'orp-description-root');
                        root.empty();
                        root.createEl("p", { text: t('PLUGIN_DESC'), cls: "orp-settings-description" });
                    }
                }]
            },
            {
                type: 'group',
                cls: 'orp-settings-group',
                heading: t('GENERAL_SECTION_HEADER'),
                items: [
                    {
                        name: t('APPLY_TO_SELECTION'),
                        desc: t('APPLY_TO_SELECTION_DESC'),
                        aliases: [t('RUN_QUICK_ACTION'), t('APPLY_TO_SELECTION_ALIAS')],
                        render: (setting) => {
                            setting.addToggle(toggle => toggle
                                .setValue(this.plugin.settings.applyToSelection)
                                .onChange(async (value) => {
                                    this.plugin.settings.applyToSelection = value;
                                    await this.plugin.saveSettings();
                                }));
                        }
                    },
                    {
                        name: t('CONFIRM_FOLDER_ACTION'),
                        desc: t('CONFIRM_FOLDER_ACTION_DESC'),
                        aliases: [t('FOLDER_ACTION_CONFIRM_TITLE'), t('RUN_DEFAULT_ON_FOLDER')],
                        // Name and desc are applied to the row by Obsidian before render runs.
                        render: (setting) => {
                            setting.addToggle(toggle => toggle
                                .setValue(this.plugin.settings.confirmFolderAction)
                                .onChange(async (value) => {
                                    this.plugin.settings.confirmFolderAction = value;
                                    await this.plugin.saveSettings();
                                }));
                        }
                    }
                ]
            },
            {
                type: 'group',
                cls: 'orp-settings-group',
                heading: t('MANAGE_SECTION_HEADER'),
                items: [{
                    name: t('ADD_QUICK_ACTION'),
                    aliases: [
                        t('MANAGE_SECTION_HEADER'), t('ACTION_NAME'), t('SEARCH_REGEX'),
                        t('FLAGS'), t('REPLACEMENT'), t('SET_AS_DEFAULT'), t('EDIT'), t('DELETE')
                    ],
                    render: (setting) => {
                        const root = this.acquireRoot(setting, 'orp-settings-root');
                        this.managerRootEl = root;
                        this.renderManager(root);
                        return () => { this.managerRootEl = null; };
                    }
                }]
            }
        ];
    }

    /**
     * Returns the row's own render root, creating it only if absent.
     *
     * The root must live in `setting.settingEl`: after every render pass Obsidian resets
     * `group.listEl` to exactly the row elements it created, so anything appended there is
     * pruned away. `Setting.clear()` only empties `controlEl`, so `settingEl`'s own children
     * survive — which is also why the root has to be reused rather than appended afresh,
     * or a re-render would stack a second copy of the UI.
     */
    private acquireRoot(setting: Setting, cls: string): HTMLElement {
        setting.settingEl.addClass('orp-settings-anchor');
        const existing = setting.settingEl.querySelector<HTMLElement>(`:scope > .${cls}`);
        return existing ?? setting.settingEl.createDiv(cls);
    }

    /** Redraws the manager after a state change, without rebuilding the definition list. */
    private rerender() {
        if (this.managerRootEl) this.renderManager(this.managerRootEl);
    }

    private renderManager(root: HTMLElement) {
        root.empty();

        new Setting(root)
            .setName(t('ADD_QUICK_ACTION'))
            .addButton(btn => btn
                .setButtonText(t('ADD'))
                .setCta()
                .onClick(() => {
                    this.resetTempFields();
                    this.showCreationForm = !this.showCreationForm;
                    this.rerender();
                }));

        if (this.showCreationForm) {
            const formContainer = root.createEl("div", { cls: "orp-creation-row" });
            this.renderFormFields(formContainer, () => this.handleSave());
        }

        const listWrapper = root.createEl("div", { cls: "orp-saved-list" });
        this.plugin.settings.rules.forEach(name => {
            const itemRow = listWrapper.createEl("div", { cls: "orp-saved-rule-item" });
            if (this.editingRule === name) {
                this.renderFormFields(itemRow, () => this.handleUpdate(name), true);
            } else {
                const content = this.plugin.settings.rulesets[name] ?? "";
                const { pattern, flags, replacement } = this.parseRuleContent(content);
                const nameWrap = itemRow.createEl("div", { cls: "orp-input-wrap orp-name-field" });
                nameWrap.createEl("small", { text: t('ACTION_NAME'), cls: "orp-label" });
                nameWrap.createEl("div", { text: name, cls: "orp-saved-text-display" });
                const fieldsRow = itemRow.createEl("div", { cls: "orp-fields-row" });
                this.createDisplayField(fieldsRow, t('SEARCH_REGEX'), pattern, "orp-pattern-field");
                this.createDisplayField(fieldsRow, t('FLAGS'), flags, "orp-flags-field");
                this.createDisplayField(fieldsRow, t('REPLACEMENT'), replacement, "orp-replacement-field");
                const actionsWrap = itemRow.createEl("div", { cls: "orp-input-wrap orp-creation-actions" });
                const defaultWrap = actionsWrap.createEl("div", { cls: "orp-default-toggle-wrap" });
                new ToggleComponent(defaultWrap)
                    .setValue(this.plugin.settings.defaultRule === name)
                    .onChange(async (value) => {
                        this.plugin.settings.defaultRule = value ? name : null;
                        await this.plugin.saveSettings();
                        this.rerender();
                    });
                defaultWrap.createSpan({ text: t('SET_AS_DEFAULT'), cls: "orp-toggle-label" });
                const buttons = actionsWrap.createEl("div", { cls: "orp-action-buttons" });
                new ButtonComponent(buttons).setButtonText(t('EDIT')).onClick(() => {
                    this.parseContentToFields(name, content);
                    this.editingRule = name;
                    this.showCreationForm = false;
                    this.rerender();
                });
                new ButtonComponent(buttons).setButtonText(t('DELETE')).setWarning().onClick(() => {
                    new ConfirmationModal(
                        this.app,
                        t('DELETE_HEADER'),
                        t('DELETE_CONFIRM', name),
                        t('YES'),
                        async () => {
                            await this.plugin.deleteRuleset(name);
                            this.rerender();
                        }
                    ).open();
                });
            }
        });
    }

    private createDisplayField(parent: HTMLElement, label: string, val: string, cls: string) {
        const wrap = parent.createEl("div", { cls: `orp-input-wrap ${cls}` });
        wrap.createEl("small", { text: label, cls: "orp-label" });
        wrap.createEl("div", { text: val, cls: "orp-saved-text-display" });
    }

    private renderFormFields(container: HTMLElement, onConfirm: () => unknown, isUpdate = false) {
        const nameWrap = container.createEl("div", { cls: "orp-input-wrap orp-name-field" });
        nameWrap.createEl("small", { text: t('ACTION_NAME'), cls: "orp-label" });
        this.nameInputEl = nameWrap.createEl("input", {
            type: "text",
            value: this.tempName,
            placeholder: t('PLACEHOLDER_NAME'),
            cls: "orp-input"
        });
        this.nameInputEl.addEventListener("input", (e) =>
            this.tempName = (e.target as HTMLInputElement).value
        );

        const fieldsRow = container.createEl("div", { cls: "orp-fields-row" });
        this.patternInputEl = this.createInputField(fieldsRow, t('SEARCH_REGEX'), this.tempPattern, t('PLACEHOLDER_SEARCH'), "orp-pattern-field", (v) => this.tempPattern = v);
        this.flagsInputEl = this.createInputField(fieldsRow, t('FLAGS'), this.tempFlags, t('PLACEHOLDER_FLAGS'), "orp-flags-field", (v) => this.tempFlags = v);
        this.createInputField(fieldsRow, t('REPLACEMENT'), this.tempReplacement, t('PLACEHOLDER_REPLACEMENT'), "orp-replacement-field", (v) => this.tempReplacement = v);

        const actionsWrap = container.createEl("div", { cls: "orp-input-wrap orp-creation-actions" });
        const defaultWrap = actionsWrap.createEl("div", { cls: "orp-default-toggle-wrap" });
        const initialToggleValue = isUpdate
            ? (this.plugin.settings.defaultRule === this.editingRule)
            : this.tempIsDefault;
        new ToggleComponent(defaultWrap)
            .setValue(initialToggleValue)
            .onChange(async (value) => {
                if (isUpdate) {
                    this.plugin.settings.defaultRule = value ? this.tempName : null;
                    await this.plugin.saveSettings();
                } else {
                    this.tempIsDefault = value;
                }
            });
        defaultWrap.createSpan({ text: t('SET_AS_DEFAULT'), cls: "orp-toggle-label" });
        const buttons = actionsWrap.createEl("div", { cls: "orp-action-buttons" });
        new ButtonComponent(buttons).setButtonText(t('SAVE')).setCta().onClick(onConfirm);
        new ButtonComponent(buttons).setButtonText(t('CANCEL')).onClick(() => {
            this.editingRule = null;
            this.showCreationForm = false;
            this.rerender();
        });
    }

    private createInputField(
        parent: HTMLElement,
        label: string,
        val: string,
        ph: string,
        cls: string,
        onChange: (v: string) => void
    ): HTMLInputElement {
        const wrap = parent.createEl("div", { cls: `orp-input-wrap ${cls}` });
        wrap.createEl("small", { text: label, cls: "orp-label" });
        const input = wrap.createEl("input", { type: "text", value: val, placeholder: ph, cls: "orp-input" });
        input.addEventListener("input", (e) => onChange((e.target as HTMLInputElement).value));
        return input;
    }

    private triggerFieldError(el: HTMLElement) {
        if (!el) return;
        el.classList.remove('field-error');
        void el.offsetWidth;
        el.classList.add('field-error');
    }

    private validateInputs(isUpdate = false): boolean {
        const trimmedName = this.tempName.trim();
        if (!trimmedName) {
            new Notice(t('NAME_EMPTY_ERR'));
            this.triggerFieldError(this.nameInputEl);
            return false;
        }

        const nameExists = this.plugin.settings.rules.some(name =>
            name.toLowerCase() === trimmedName.toLowerCase() &&
            (!isUpdate || name !== this.editingRule)
        );
        if (nameExists) {
            new Notice(t('NAME_EXISTS_ERR'));
            this.triggerFieldError(this.nameInputEl);
            return false;
        }

        if (!this.tempPattern.trim()) {
            new Notice(t('PATTERN_EMPTY_ERR'));
            this.triggerFieldError(this.patternInputEl);
            return false;
        }

        try {
            new RegExp(this.tempPattern, this.tempFlags || 'gm');
        } catch (e) {
            const errorMsg = e instanceof Error ? e.message.toLowerCase() : String(e).toLowerCase();
            const isFlagError = errorMsg.includes("flag") || /[^gimsuy]/.test(this.tempFlags);

            if (isFlagError) {
                new Notice(t('FLAGS_INVALID_ERR'));
                this.triggerFieldError(this.flagsInputEl);
            } else {
                new Notice(t('REGEX_INVALID_ERR'));
                this.triggerFieldError(this.patternInputEl);
            }
            return false;
        }
        return true;
    }

    private async handleSave() {
        if (!this.validateInputs(false)) return;
        const content = `"${this.tempPattern}"${this.tempFlags}\n->\n"${this.tempReplacement}"`;
        await this.plugin.createRuleset(this.tempName, content);
        if (this.tempIsDefault) {
            this.plugin.settings.defaultRule = this.tempName;
            await this.plugin.saveSettings();
        }
        this.showCreationForm = false;
        this.rerender();
    }

    private async handleUpdate(oldName: string) {
        if (!this.validateInputs(true)) return;
        const content = `"${this.tempPattern}"${this.tempFlags}\n->\n"${this.tempReplacement}"`;
        await this.plugin.updateRuleset(oldName, this.tempName, content);
        this.editingRule = null;
        this.rerender();
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
        this.tempIsDefault = false;
        this.editingRule = null;
    }
}
