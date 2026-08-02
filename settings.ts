import { AbstractInputSuggest, App, ButtonComponent, Modal, Platform, PluginSettingTab, Setting, SettingDefinitionItem, ToggleComponent, Notice, setIcon } from 'obsidian';
import { t } from './i18n';
import type RegexQuickActions from './main';
import type { ActionSequence, RulesetEntry } from './types';

/** Replays the invalid-field border animation on an element. */
function flashFieldError(el: HTMLElement) {
    if (!el) return;
    el.classList.remove('field-error');
    void el.offsetWidth;
    el.classList.add('field-error');
}

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
            .setDestructive()
            .onClick(() => {
                this.onConfirm();
                this.close();
            });
    }

    onClose() {
        this.contentEl.empty();
    }
}

/** Autosuggest over the saved quick action names, attached to a plain text input. */
class ActionSuggest extends AbstractInputSuggest<string> {
    constructor(
        app: App,
        private searchEl: HTMLInputElement,
        private names: () => string[],
        private onPick: (name: string) => void
    ) {
        super(app, searchEl);
    }

    protected getSuggestions(query: string): string[] {
        const lowered = query.trim().toLowerCase();
        return this.names().filter(name => name.toLowerCase().includes(lowered));
    }

    renderSuggestion(value: string, el: HTMLElement) {
        el.setText(value);
    }

    /**
     * Overridden instead of going through onSelect, whose default handling closes the
     * popover after a pick and so forces a refocus before the next one. Clearing the
     * query and replaying an input event leaves the full list open and ready, which is
     * what building a sequence of several actions needs.
     */
    selectSuggestion(value: string) {
        this.onPick(value);
        this.setValue("");
        this.searchEl.focus();
        this.searchEl.dispatchEvent(new Event('input'));
    }
}

/**
 * Builds an action sequence: a name, plus an ordered list of quick actions picked from
 * an autosuggest. The order is the run order, so the list is reorderable — by drag
 * on desktop, and by up/down buttons on mobile, where dragging is not dependable.
 */
export class SequenceModal extends Modal {
    private name: string;
    private steps: string[];
    private draggingIdx: number | null = null;

    private nameInputEl: HTMLInputElement;
    private stepsListEl: HTMLElement;

    constructor(
        app: App,
        private plugin: RegexQuickActions,
        private editing: ActionSequence | null,
        private onSaved: () => void
    ) {
        super(app);
        this.name = editing?.name ?? "";
        this.steps = [...(editing?.steps ?? [])];
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.addClass('orp-sequence-modal');
        this.titleEl.setText(this.editing ? t('SEQUENCE_EDIT_TITLE') : t('SEQUENCE_NEW_TITLE'));

        const nameWrap = contentEl.createDiv({ cls: 'orp-sequence-field orp-sequence-name-field' });
        nameWrap.createEl('small', { text: t('SEQUENCE_NAME'), cls: 'orp-sequence-label' });
        this.nameInputEl = nameWrap.createEl('input', {
            type: 'text',
            value: this.name,
            placeholder: t('PLACEHOLDER_SEQUENCE_NAME'),
            cls: 'orp-sequence-input orp-sequence-name-input'
        });
        this.nameInputEl.addEventListener('input', (e) =>
            this.name = (e.target as HTMLInputElement).value
        );

        const searchWrap = contentEl.createDiv({ cls: 'orp-sequence-field orp-sequence-search-field' });
        searchWrap.createEl('small', { text: t('SEQUENCE_PICKER'), cls: 'orp-sequence-label' });
        const search = searchWrap.createEl('input', {
            type: 'text',
            placeholder: t('PLACEHOLDER_SEQUENCE_SEARCH'),
            cls: 'orp-sequence-input orp-sequence-search-input'
        });
        // The same action may be added more than once: repeating a step is legitimate.
        new ActionSuggest(this.app, search, () => this.plugin.settings.rules, (name) => {
            this.steps.push(name);
            this.renderSteps();
        });

        this.stepsListEl = contentEl.createDiv({ cls: 'orp-sequence-steps' });
        this.renderSteps();

        const buttons = contentEl.createDiv({ cls: 'orp-sequence-buttons' });
        new ButtonComponent(buttons)
            .setButtonText(t('SAVE'))
            .setCta()
            .onClick(() => void this.save())
            .buttonEl.addClass('orp-sequence-save');
    }

    onClose() {
        this.contentEl.empty();
    }

    private renderSteps() {
        this.stepsListEl.empty();
        if (this.steps.length === 0) {
            this.stepsListEl.createDiv({ text: t('SEQUENCE_EMPTY'), cls: 'orp-sequence-hint' });
            return;
        }
        this.steps.forEach((step, idx) => this.renderStepRow(step, idx));
    }

    private renderStepRow(step: string, idx: number) {
        const row = this.stepsListEl.createDiv({ cls: 'orp-sequence-step' });

        if (Platform.isMobile) {
            // Touch drags fight the modal's own scrolling, so mobile reorders by button.
            const arrows = row.createDiv({ cls: 'orp-sequence-reorder' });
            const up = arrows.createEl('button', {
                cls: 'clickable-icon orp-sequence-move-up',
                attr: { 'aria-label': t('MOVE_UP') }
            });
            setIcon(up, 'arrow-up');
            up.onclick = () => this.moveStep(idx, idx - 1);
            const down = arrows.createEl('button', {
                cls: 'clickable-icon orp-sequence-move-down',
                attr: { 'aria-label': t('MOVE_DOWN') }
            });
            setIcon(down, 'arrow-down');
            down.onclick = () => this.moveStep(idx, idx + 1);
        } else {
            if (this.draggingIdx === idx) row.addClass('is-dragging');
            row.draggable = true;
            const handle = row.createDiv({ cls: 'clickable-icon orp-sequence-drag-handle' });
            setIcon(handle, 'lucide-grip-vertical');

            row.addEventListener('dragstart', () => {
                this.draggingIdx = idx;
                row.addClass('is-dragging');
            });

            row.addEventListener('dragend', () => {
                this.draggingIdx = null;
                row.removeClass('is-dragging');
                this.renderSteps();
            });

            row.addEventListener('dragover', (e) => {
                e.preventDefault();
                if (this.draggingIdx === null || this.draggingIdx === idx) return;
                const moved = this.steps.splice(this.draggingIdx, 1)[0];
                this.steps.splice(idx, 0, moved);
                this.draggingIdx = idx;
                this.renderSteps();
            });
        }

        row.createSpan({ text: `${idx + 1}`, cls: 'orp-sequence-step-index' });
        row.createDiv({ text: step, cls: 'orp-sequence-step-name' });

        const remove = row.createEl('button', {
            cls: 'clickable-icon orp-sequence-step-remove',
            attr: { 'aria-label': t('REMOVE') }
        });
        setIcon(remove, 'x');
        remove.onclick = () => {
            this.steps.splice(idx, 1);
            this.renderSteps();
        };
    }

    private moveStep(from: number, to: number) {
        if (to < 0 || to >= this.steps.length) return;
        const moved = this.steps.splice(from, 1)[0];
        this.steps.splice(to, 0, moved);
        this.renderSteps();
    }

    private async save() {
        const name = this.name.trim();
        if (!name) {
            new Notice(t('NAME_EMPTY_ERR'));
            flashFieldError(this.nameInputEl);
            return;
        }
        if (this.plugin.isNameTaken(name, this.editing?.name)) {
            new Notice(t('SEQUENCE_NAME_EXISTS_ERR'));
            flashFieldError(this.nameInputEl);
            return;
        }
        // A single action is just that action: a sequence needs something to sequence.
        if (this.steps.length < 2) {
            new Notice(t('SEQUENCE_TOO_SHORT_ERR'));
            return;
        }

        if (this.editing) await this.plugin.updateSequence(this.editing.name, name, this.steps);
        else await this.plugin.createSequence(name, this.steps);

        this.onSaved();
        this.close();
    }
}

type ManagerTab = 'actions' | 'sequences';

export class RegexQuickActionsSettingsTab extends PluginSettingTab {
    plugin: RegexQuickActions;
    activeTab: ManagerTab = 'actions';
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
                    },
                    {
                        name: t('EXPORT_IMPORT'),
                        // Export writes a file through a download, which the mobile app has
                        // no way to handle, so the row says so and the button is disabled.
                        desc: Platform.isMobile
                            ? `${t('EXPORT_IMPORT_DESC')} ${t('EXPORT_MOBILE_UNAVAILABLE')}`
                            : t('EXPORT_IMPORT_DESC'),
                        aliases: [t('EXPORT'), t('IMPORT')],
                        render: (setting) => {
                            // Drops the buttons onto their own line under the text; see styles.css.
                            setting.settingEl.addClass('orp-stacked-row');
                            setting.addButton(btn => {
                                this.labelIconButton(btn, 'upload', t('EXPORT'));
                                btn.onClick(() => this.exportQuickActions());
                                if (Platform.isMobile) {
                                    btn.setDisabled(true).setTooltip(t('EXPORT_MOBILE_UNAVAILABLE'));
                                }
                            });
                            setting.addButton(btn => {
                                this.labelIconButton(btn, 'download', t('IMPORT'));
                                btn.onClick(() => this.pickImportFile());
                            });
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
                        t('FLAGS'), t('REPLACEMENT'), t('SET_AS_DEFAULT'), t('EDIT'), t('DELETE'),
                        t('TAB_SEQUENCES'), t('ADD_SEQUENCE')
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
        // The strip and the tab's "new item" row are two halves of one bordered card,
        // which is why they share a parent; everything else goes in the panel below it.
        const card = root.createDiv({ cls: 'orp-tab-card' });
        this.renderTabs(card);
        const panel = root.createDiv({ cls: 'orp-tab-panel', attr: { role: 'tabpanel' } });
        if (this.activeTab === 'actions') this.renderActionsTab(card, panel);
        else this.renderSequencesTab(card, panel);
    }

    /**
     * Redraws the manager with the settings pane left where it was. Rebuilding the panel
     * costs it its scroll position, so it is read before the redraw and written back after.
     */
    private rerenderInPlace() {
        const scroller = this.findScroller(this.managerRootEl);
        const top = scroller?.scrollTop ?? 0;
        this.rerender();
        if (scroller) scroller.scrollTop = top;
    }

    /**
     * The pane that actually scrolls around the manager: the settings dialog's content
     * area on desktop, the tab body on mobile. Returns null when nothing scrolls yet.
     */
    private findScroller(el: HTMLElement | null): HTMLElement | null {
        for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
            const overflowY = getComputedStyle(node).overflowY;
            const scrolls = overflowY === 'auto' || overflowY === 'scroll';
            if (scrolls && node.scrollHeight > node.clientHeight) return node;
        }
        return null;
    }

    /**
     * The tab strip over the two saved lists. Switching tabs drops any half-finished
     * creation or edit, since the form it belongs to is about to leave the screen.
     */
    private renderTabs(root: HTMLElement) {
        const bar = root.createDiv({ cls: 'orp-tabs', attr: { role: 'tablist' } });
        const tabs: { id: ManagerTab, label: string, short: string, count: number }[] = [
            {
                id: 'actions',
                label: t('TAB_ACTIONS'),
                short: t('TAB_ACTIONS_SHORT'),
                count: this.plugin.settings.rules.length
            },
            {
                id: 'sequences',
                label: t('TAB_SEQUENCES'),
                short: t('TAB_SEQUENCES_SHORT'),
                count: this.plugin.settings.sequences.length
            }
        ];

        for (const { id, label, short, count } of tabs) {
            const isActive = this.activeTab === id;
            const tab = bar.createEl('button', {
                cls: isActive ? 'orp-tab is-active' : 'orp-tab',
                attr: { role: 'tab', 'aria-selected': String(isActive) }
            });
            // Both labels are rendered and CSS picks one, so the swap happens with the
            // width of the card rather than of the screen; see the narrow layouts section.
            tab.createSpan({ text: label, cls: 'orp-tab-label' });
            tab.createSpan({ text: short, cls: 'orp-tab-label-short' });
            tab.createSpan({ text: String(count), cls: 'orp-tab-count' });
            tab.onclick = () => {
                if (isActive) return;
                this.activeTab = id;
                this.resetTempFields();
                this.showCreationForm = false;
                this.rerenderInPlace();
            };
        }
    }

    /** The saved quick actions, with the inline creation form above them. */
    private renderActionsTab(card: HTMLElement, root: HTMLElement) {
        this.renderCreateRow(card, t('ADD_QUICK_ACTION'), () => {
            this.resetTempFields();
            this.showCreationForm = !this.showCreationForm;
            this.rerender();
        });

        if (this.showCreationForm) {
            const formContainer = root.createEl("div", { cls: "orp-creation-row" });
            this.renderFormFields(formContainer, () => this.handleSave());
        }

        if (this.plugin.settings.rules.length === 0) {
            // The open form already says what the tab is for, so the hint would only repeat it.
            if (!this.showCreationForm) this.renderEmptyState(root, t('NO_ACTIONS_YET'));
            return;
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
                new ButtonComponent(buttons).setButtonText(t('DELETE')).setDestructive().onClick(() => {
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

    /** The saved sequences. Building one is a modal, so this tab has no inline form. */
    private renderSequencesTab(card: HTMLElement, root: HTMLElement) {
        this.renderCreateRow(card, t('ADD_SEQUENCE'), () => {
            if (this.plugin.settings.rules.length === 0) {
                new Notice(t('SEQUENCE_NEEDS_ACTIONS_ERR'));
                return;
            }
            new SequenceModal(this.app, this.plugin, null, () => this.rerender()).open();
        });

        const sequences = this.plugin.settings.sequences;
        if (sequences.length === 0) {
            this.renderEmptyState(root, t('NO_SEQUENCES_YET'));
            return;
        }

        const listWrapper = root.createEl("div", { cls: "orp-saved-list" });
        sequences.forEach(sequence => {
            const itemRow = listWrapper.createEl("div", { cls: "orp-saved-rule-item" });
            const nameWrap = itemRow.createEl("div", { cls: "orp-input-wrap orp-name-field" });
            nameWrap.createEl("small", { text: t('SEQUENCE_NAME'), cls: "orp-label" });
            nameWrap.createEl("div", { text: sequence.name, cls: "orp-saved-text-display" });

            const stepsWrap = itemRow.createEl("div", { cls: "orp-input-wrap" });
            stepsWrap.createEl("small", { text: t('SEQUENCE_STEPS_LABEL'), cls: "orp-label" });
            stepsWrap.createEl("div", {
                text: sequence.steps.join("  →  "),
                cls: "orp-saved-text-display"
            });

            const buttons = itemRow.createEl("div", { cls: "orp-sequence-actions" });
            new ButtonComponent(buttons).setButtonText(t('EDIT')).onClick(() => {
                new SequenceModal(this.app, this.plugin, sequence, () => this.rerender()).open();
            });
            new ButtonComponent(buttons).setButtonText(t('DELETE')).setDestructive().onClick(() => {
                new ConfirmationModal(
                    this.app,
                    t('DELETE_SEQUENCE_HEADER'),
                    t('DELETE_SEQUENCE_CONFIRM', sequence.name),
                    t('YES'),
                    async () => {
                        await this.plugin.deleteSequence(sequence.name);
                        this.rerender();
                    }
                ).open();
            });
        });
    }

    /**
     * The tab's "new item" button, which is the whole row: no name or description of its
     * own, and no chrome separating button from row — the button says what it does, and
     * the entire row is its click target (see .orp-create-row). It goes into the card
     * under the tab strip, whose lower half it is. Both tabs use the same plus icon:
     * the row sits in the same place on either, and only the label differs.
     */
    private renderCreateRow(card: HTMLElement, label: string, onClick: () => void) {
        const createRow = new Setting(card);
        createRow.settingEl.addClass('orp-stacked-row', 'orp-buttons-only', 'orp-create-row');
        createRow.addButton(btn => {
            this.labelIconButton(btn, 'plus', label);
            btn.onClick(onClick);
        });
    }

    private renderEmptyState(root: HTMLElement, text: string) {
        root.createDiv({ text, cls: 'orp-empty-list' });
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
        flashFieldError(el);
    }

    private validateInputs(isUpdate = false): boolean {
        const trimmedName = this.tempName.trim();
        if (!trimmedName) {
            new Notice(t('NAME_EMPTY_ERR'));
            this.triggerFieldError(this.nameInputEl);
            return false;
        }

        // Sequences share the command palette with actions, so the names cannot collide.
        const nameExists = this.plugin.settings.rules.some(name =>
            name.toLowerCase() === trimmedName.toLowerCase() &&
            (!isUpdate || name !== this.editingRule)
        ) || this.plugin.settings.sequences.some(sequence =>
            sequence.name.toLowerCase() === trimmedName.toLowerCase()
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

    /**
     * Gives a button a Lucide icon followed by its label. The label is appended to the
     * element instead of going through setButtonText, which would drop the icon.
     */
    private labelIconButton(btn: ButtonComponent, icon: string, label: string) {
        btn.setIcon(icon);
        btn.buttonEl.createSpan({ text: label });
    }

    /** Hands the whole action set to the user as a JSON download. Desktop only. */
    private exportQuickActions() {
        const { rules, rulesets, sequences, defaultRule } = this.plugin.settings;
        if (rules.length === 0) {
            new Notice(t('EXPORT_EMPTY_ERR'));
            return;
        }

        const payload = {
            plugin: this.plugin.manifest.id,
            version: this.plugin.manifest.version,
            exportedAt: new Date().toISOString(),
            defaultRule,
            rules,
            rulesets,
            sequences
        };

        const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
        const link = activeDocument.body.createEl('a', {
            href: url,
            attr: { download: `regex-quick-actions-${new Date().toISOString().slice(0, 10)}.json` }
        });
        link.click();
        link.remove();
        URL.revokeObjectURL(url);

        new Notice(t('EXPORT_DONE_MSG', rules.length));
    }

    /** Opens the system file picker and imports whatever the user chooses. */
    private pickImportFile() {
        const input = createEl('input', { type: 'file', attr: { accept: 'application/json,.json' } });
        input.addEventListener('change', () => {
            const file = input.files?.[0];
            if (file) void this.importQuickActions(file);
        });
        input.click();
    }

    private async importQuickActions(file: File) {
        let raw: string;
        try {
            raw = await file.text();
        } catch {
            new Notice(t('IMPORT_READ_ERR'));
            return;
        }

        let data: unknown;
        try {
            data = JSON.parse(raw);
        } catch {
            new Notice(t('IMPORT_PARSE_ERR'));
            return;
        }

        const entries = this.readImportEntries(data);
        if (!entries) {
            new Notice(t('IMPORT_INVALID_ERR'));
            return;
        }
        const sequences = this.readImportSequences(data);
        if (entries.length === 0 && sequences.length === 0) {
            new Notice(t('IMPORT_EMPTY_ERR'));
            return;
        }

        const defaultRule = this.readDefaultRule(data);
        const result = await this.plugin.importData(entries, sequences, defaultRule);
        this.rerender();
        new Notice(t('IMPORT_DONE_MSG', result.added, result.renamed, result.skipped));
    }

    /**
     * Pulls the usable actions out of a parsed export file. Returns null when the file is
     * not an export at all; entries that are malformed or unparseable as a rule are
     * dropped, so one bad action cannot block the rest of the import.
     */
    private readImportEntries(data: unknown): RulesetEntry[] | null {
        if (typeof data !== 'object' || data === null) return null;

        const { rules, rulesets } = data as { rules?: unknown, rulesets?: unknown };
        if (typeof rulesets !== 'object' || rulesets === null || Array.isArray(rulesets)) return null;

        const map = rulesets as Record<string, unknown>;
        // `rules` carries the display order; anything only present in `rulesets` is appended.
        const ordered = Array.isArray(rules) ? rules.filter((name): name is string => typeof name === 'string') : [];
        const names = [
            ...ordered.filter(name => name in map),
            ...Object.keys(map).filter(name => !ordered.includes(name))
        ];

        const entries: RulesetEntry[] = [];
        for (const name of names) {
            const content = map[name];
            const trimmed = name.trim();
            if (!trimmed || typeof content !== 'string') continue;
            if (!this.parseRuleContent(content).pattern) continue;
            entries.push({ name: trimmed, content });
        }
        return entries;
    }

    /**
     * Pulls the sequences out of a parsed export file. Missing or malformed sequences
     * are simply absent: a file written before sequences existed still imports.
     */
    private readImportSequences(data: unknown): ActionSequence[] {
        const value = (data as { sequences?: unknown }).sequences;
        if (!Array.isArray(value)) return [];

        const sequences: ActionSequence[] = [];
        for (const item of value) {
            if (typeof item !== 'object' || item === null) continue;
            const { name, steps } = item as { name?: unknown, steps?: unknown };
            if (typeof name !== 'string' || !name.trim() || !Array.isArray(steps)) continue;

            const validSteps = steps.filter((step): step is string => typeof step === 'string');
            if (validSteps.length === 0) continue;
            sequences.push({ name: name.trim(), steps: validSteps });
        }
        return sequences;
    }

    private readDefaultRule(data: unknown): string | null {
        const value = (data as { defaultRule?: unknown }).defaultRule;
        return typeof value === 'string' ? value : null;
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
