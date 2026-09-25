import { AbstractInputSuggest, App, ButtonComponent, Menu, Modal, Platform, PluginSettingTab, Setting, SettingDefinitionItem, ToggleComponent, Notice, debounce, setIcon, setTooltip } from 'obsidian';
import { t } from './i18n';
import { renderChangelogNotice } from './changelog';
import type RegexQuickActions from './main';
import type { ActionSequence, QuickFindOptions, RegexRule, RulesetEntry } from './types';

/** Replays the invalid-field border animation on an element. */
function flashFieldError(el: HTMLElement) {
    if (!el) return;
    el.classList.remove('field-error');
    void el.offsetWidth;
    el.classList.add('field-error');
}

/** A labelled text input, in the shape every quick action field uses. */
function createInputField(
    parent: HTMLElement,
    label: string,
    val: string,
    ph: string,
    cls: string,
    onChange: (v: string) => void
): HTMLInputElement {
    const wrap = parent.createDiv({ cls: `orp-input-wrap ${cls}` });
    wrap.createEl("small", { text: label, cls: "orp-label" });
    const input = wrap.createEl("input", { type: "text", value: val, placeholder: ph, cls: "orp-input" });
    input.addEventListener("input", (e) => onChange((e.target as HTMLInputElement).value));
    return input;
}

/** Checks that the pattern is not blank and compiles with its flags. */
function validatePattern(
    pattern: string,
    flags: string,
    patternEl: HTMLInputElement,
    flagsEl: HTMLInputElement
): boolean {
    if (!pattern.trim()) {
        new Notice(t('PATTERN_EMPTY_ERR'));
        flashFieldError(patternEl);
        return false;
    }
    return checkRegex(pattern, flags, patternEl, flagsEl);
}

/** Compiles the pattern with its flags, reporting whichever of the two is at fault. */
function checkRegex(
    pattern: string,
    flags: string,
    patternEl: HTMLInputElement,
    flagsEl: HTMLInputElement
): boolean {
    try {
        new RegExp(pattern, flags || 'gm');
    } catch (e) {
        const errorMsg = e instanceof Error ? e.message.toLowerCase() : String(e).toLowerCase();
        const isFlagError = errorMsg.includes("flag") || /[^gimsuy]/.test(flags);

        if (isFlagError) {
            new Notice(t('FLAGS_INVALID_ERR'));
            flashFieldError(flagsEl);
        } else {
            new Notice(t('REGEX_INVALID_ERR'));
            flashFieldError(patternEl);
        }
        return false;
    }
    return true;
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
        const btnContainer = contentEl.createDiv({ cls: "orp-modal-buttons" });
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

/** A letter, digit or underscore in any script. `\b` knows only Latin, so it misses Cyrillic words. */
const WORD_CHAR = '[\\p{L}\\p{N}_]';

/** Past this length the live match count is skipped: it rescans the text on every keystroke. */
const MAX_PREVIEW_CHARS = 1_000_000;

/** The live match count stops here and shows "N+". */
const MAX_PREVIEW_MATCHES = 9_999;

/** Escapes every regex syntax character, so the text is found exactly as typed. */
function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/**
 * Builds the rule that runs from the typed fields and the search toggles. The toggles are
 * applied here and never written into the fields, so a field always holds what was typed.
 */
function buildQuickRule(pattern: string, flags: string, replacement: string, options: QuickFindOptions): RegexRule {
    let source = options.regex ? pattern : escapeRegExp(pattern);
    let finalFlags = flags || 'gm';
    const addFlag = (flag: string) => {
        if (!finalFlags.includes(flag)) finalFlags += flag;
    };

    // Without the group, the boundaries would bind to the outer branches of an alternation only.
    const bounded = options.wholeWord || options.lineStart || options.lineEnd;
    if (bounded && source.includes('|')) source = `(?:${source})`;
    if (options.wholeWord) {
        source = `(?<!${WORD_CHAR})${source}(?!${WORD_CHAR})`;
        addFlag('u');
    } else if (/\\[pP]\{/.test(source)) {
        addFlag('u');
    }
    if (options.lineStart) source = `^${source}`;
    if (options.lineEnd) source = `${source}$`;
    if (options.lineStart || options.lineEnd) addFlag('m');

    return {
        pattern: source,
        flags: finalFlags,
        // With regex off, "$1" and "$&" in the replacement are plain text as well.
        replacement: options.regex ? replacement : replacement.replace(/\$/g, '$$$$'),
        mode: ''
    };
}

/** Number of capturing groups in a regex, found by letting an empty alternative match "". */
function countGroups(pattern: string, flags: string): number {
    try {
        return (new RegExp(`${pattern}|`, flags).exec('')?.length ?? 1) - 1;
    } catch {
        return 0;
    }
}

/**
 * Puts syntax at the caret. A pair (`after` set) wraps the selected text, or takes the
 * caret inside when nothing is selected; a single token replaces the selection.
 */
function insertIntoField(input: HTMLInputElement, before: string, after: string) {
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    const selected = input.value.slice(start, end);
    const text = after ? before + selected + after : before;
    input.setRangeText(text, start, end);
    const caret = after && !selected ? start + before.length : start + text.length;
    input.focus();
    input.setSelectionRange(caret, caret);
    input.dispatchEvent(new Event('input'));
}

interface InsertItem {
    title: string;
    before: string;
    after?: string;
}

/**
 * A one-off find/replace over the note in front of the user. The card is the saved quick
 * action card without the parts that only a stored action has: the rule is applied once
 * and then forgotten, so it has no name, cannot be made the default, and has nothing to
 * edit or delete. Toggles and "insert" menus in the card build the regex for users who do
 * not know its syntax, and a preview shows the regex that will run and what it matches.
 * Under the card sit the note saying which text the run will reach and the button that
 * runs it.
 */
export class QuickFindReplaceModal extends Modal {
    private pattern = "";
    private flags: string;
    private replacement = "";
    private options: QuickFindOptions;

    private patternInputEl: HTMLInputElement;
    private patternLabelEl: HTMLElement | null;
    private flagsInputEl: HTMLInputElement;
    private replacementInputEl: HTMLInputElement;
    private previewEl: HTMLElement;
    private optionButtons = new Map<keyof QuickFindOptions, HTMLElement>();

    private schedulePreview = debounce(() => this.renderPreview(), 150, true);

    constructor(
        app: App,
        private plugin: RegexQuickActions,
        private useSelection: boolean,
        private subject: string,
        private onReplace: (rule: RegexRule) => void
    ) {
        super(app);
        this.options = plugin.settings.quickFindOptions;
        this.flags = this.options.matchCase ? 'gm' : 'gmi';
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.addClass('orp-find-replace-modal');
        this.titleEl.setText(t('QUICK_FIND_REPLACE'));

        const card = contentEl.createDiv({ cls: 'orp-creation-row' });
        const fieldsRow = card.createDiv({ cls: 'orp-fields-row' });
        this.patternInputEl = createInputField(fieldsRow, t('SEARCH_REGEX'), this.pattern,
            t('PLACEHOLDER_SEARCH'), 'orp-pattern-field', (v) => {
                this.pattern = v;
                this.schedulePreview();
            });
        this.flagsInputEl = createInputField(fieldsRow, t('FLAGS'), this.flags,
            t('PLACEHOLDER_FLAGS'), 'orp-flags-field', (v) => this.setFlags(v));
        this.replacementInputEl = createInputField(fieldsRow, t('REPLACEMENT'), this.replacement,
            t('PLACEHOLDER_REPLACEMENT'), 'orp-replacement-field', (v) => this.replacement = v);
        this.patternLabelEl = this.patternInputEl.parentElement?.querySelector<HTMLElement>('.orp-label') ?? null;

        this.addInsertButton(this.patternInputEl, (menu) => this.fillPatternMenu(menu));
        this.addInsertButton(this.replacementInputEl, (menu) => this.fillReplacementMenu(menu));

        const optionsRow = card.createDiv({ cls: 'orp-find-options' });
        this.addOptionButton(optionsRow, 'regex', 'regex', t('FIND_OPTION_REGEX'), t('FIND_OPTION_REGEX_DESC'));
        this.addOptionButton(optionsRow, 'matchCase', 'case-sensitive',
            t('FIND_OPTION_MATCH_CASE'), t('FIND_OPTION_MATCH_CASE_DESC'));
        this.addOptionButton(optionsRow, 'wholeWord', 'whole-word',
            t('FIND_OPTION_WHOLE_WORD'), t('FIND_OPTION_WHOLE_WORD_DESC'));
        this.addOptionButton(optionsRow, 'lineStart', 'arrow-left-to-line',
            t('FIND_OPTION_LINE_START'), t('FIND_OPTION_LINE_START_DESC'));
        this.addOptionButton(optionsRow, 'lineEnd', 'arrow-right-to-line',
            t('FIND_OPTION_LINE_END'), t('FIND_OPTION_LINE_END_DESC'));

        this.previewEl = card.createDiv({ cls: 'orp-find-preview' });
        // Phones cut the regex to one line (styles.css); a tap shows it whole.
        if (Platform.isPhone) {
            this.previewEl.addEventListener('click', () =>
                this.previewEl.toggleClass('is-expanded', !this.previewEl.hasClass('is-expanded'))
            );
        }

        // Enter runs the replacement from any field: there is nothing else to submit here.
        [this.patternInputEl, this.flagsInputEl, this.replacementInputEl].forEach(input => {
            input.addEventListener('keydown', (e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                this.replace();
            });
        });

        // Under the card: what the run will reach on the left, the button that runs it
        // on the right, so the scope is read on the way to the click.
        const footer = contentEl.createDiv({ cls: 'orp-find-replace-footer' });
        const note = footer.createDiv({ cls: 'orp-find-replace-note' });
        setIcon(note.createSpan({ cls: 'orp-find-replace-note-icon' }), 'info');
        note.createSpan({
            text: this.useSelection
                ? t('QUICK_FIND_REPLACE_SCOPE_SELECTION')
                : t('QUICK_FIND_REPLACE_SCOPE_NOTE')
        });

        new ButtonComponent(footer)
            .setButtonText(t('REPLACE'))
            .setCta()
            .onClick(() => this.replace())
            .buttonEl.addClass('orp-find-replace-run');

        this.renderOptions();
        this.renderPreview();
        this.patternInputEl.focus();
    }

    onClose() {
        this.schedulePreview.cancel();
        this.contentEl.empty();
    }

    private buildRule(): RegexRule {
        return buildQuickRule(this.pattern, this.flags, this.replacement, this.options);
    }

    private addOptionButton(parent: HTMLElement, key: keyof QuickFindOptions, icon: string, label: string, tooltip: string) {
        const button = parent.createEl('button', { cls: 'orp-find-option' });
        setIcon(button.createSpan({ cls: 'orp-find-option-icon' }), icon);
        button.createSpan({ text: label });
        setTooltip(button, tooltip);
        button.addEventListener('click', () => this.toggleOption(key));
        this.optionButtons.set(key, button);
    }

    private toggleOption(key: keyof QuickFindOptions) {
        this.options[key] = !this.options[key];
        // "Match case" and the "i" flag are one setting, shown in two places.
        if (key === 'matchCase') {
            const flags = this.flags || 'gm';
            this.flags = this.options.matchCase ? flags.replace(/i/g, '') : `${flags}i`;
            this.flagsInputEl.value = this.flags;
        }
        void this.plugin.saveSettings();
        this.renderOptions();
        this.renderPreview();
    }

    private setFlags(flags: string) {
        this.flags = flags;
        const matchCase = !flags.includes('i');
        if (matchCase !== this.options.matchCase) {
            this.options.matchCase = matchCase;
            void this.plugin.saveSettings();
            this.renderOptions();
        }
        this.schedulePreview();
    }

    /** Shows the toggle states, and the field labels and menus that depend on "Regex". */
    private renderOptions() {
        this.optionButtons.forEach((button, key) => {
            button.toggleClass('is-active', this.options[key]);
            button.setAttr('aria-pressed', String(this.options[key]));
        });
        const regex = this.options.regex;
        this.patternLabelEl?.setText(regex ? t('SEARCH_REGEX') : t('FIND_TEXT'));
        this.patternInputEl.placeholder = regex ? t('PLACEHOLDER_SEARCH') : t('PLACEHOLDER_FIND_TEXT');
        // Hides the insert buttons (styles.css): regex syntax means nothing in plain text.
        this.contentEl.toggleClass('is-regex', regex);
    }

    private addInsertButton(input: HTMLInputElement, fill: (menu: Menu) => void) {
        const button = input.parentElement?.createEl('button', { cls: 'clickable-icon orp-insert-button' });
        if (!button) return;
        setIcon(button, 'plus');
        setTooltip(button, t('INSERT_SYNTAX'));
        button.addEventListener('click', () => {
            const menu = new Menu();
            fill(menu);
            const rect = button.getBoundingClientRect();
            menu.showAtPosition({ x: rect.left, y: rect.bottom });
        });
    }

    private addInsertItem(menu: Menu, input: HTMLInputElement, { title, before, after = '' }: InsertItem) {
        menu.addItem(item => item
            .setTitle(createFragment(f => {
                f.createSpan({ text: title });
                f.createSpan({ text: after ? `${before}…${after}` : before, cls: 'orp-insert-token' });
            }))
            .onClick(() => insertIntoField(input, before, after)));
    }

    private fillPatternMenu(menu: Menu) {
        const sections: InsertItem[][] = [
            [
                { title: t('INSERT_ANY_CHAR'), before: '.' },
                { title: t('INSERT_ANY_TEXT'), before: '.*?' },
                { title: t('INSERT_LETTER'), before: '\\p{L}' },
                { title: t('INSERT_DIGIT'), before: '\\d' },
                { title: t('INSERT_SPACE'), before: '[ \\t]' }
            ],
            [
                { title: t('INSERT_ONE_OR_MORE'), before: '+' },
                { title: t('INSERT_ZERO_OR_MORE'), before: '*' },
                { title: t('INSERT_OPTIONAL'), before: '?' }
            ],
            [
                { title: t('INSERT_GROUP'), before: '(', after: ')' },
                { title: t('INSERT_OR'), before: '|' }
            ]
        ];
        sections.forEach((items, idx) => {
            if (idx > 0) menu.addSeparator();
            items.forEach(item => this.addInsertItem(menu, this.patternInputEl, item));
        });
    }

    private fillReplacementMenu(menu: Menu) {
        this.addInsertItem(menu, this.replacementInputEl, { title: t('INSERT_WHOLE_MATCH'), before: '$&' });
        menu.addSeparator();
        const rule = this.buildRule();
        // "$10" and up read as "$1" followed by a digit once there are fewer groups.
        const groups = Math.min(countGroups(rule.pattern, rule.flags), 9);
        if (groups === 0) {
            menu.addItem(item => item.setTitle(t('INSERT_NO_GROUPS')).setDisabled(true));
            return;
        }
        for (let n = 1; n <= groups; n++) {
            this.addInsertItem(menu, this.replacementInputEl, { title: t('INSERT_GROUP_REF', n), before: `$${n}` });
        }
    }

    /** The regex that will run and how many matches it has in the text the run will reach. */
    private renderPreview() {
        this.previewEl.empty();
        if (!this.pattern) {
            this.previewEl.createSpan({ text: t('FIND_PREVIEW_EMPTY'), cls: 'orp-find-preview-label' });
            return;
        }

        const rule = this.buildRule();
        this.previewEl.createSpan({ text: t('FIND_PREVIEW_LABEL'), cls: 'orp-find-preview-label' });
        this.previewEl.createEl('code', { text: `/${rule.pattern}/${rule.flags}`, cls: 'orp-find-preview-regex' });
        const status = this.previewEl.createSpan({ cls: 'orp-find-preview-count' });

        let regex: RegExp;
        try {
            regex = new RegExp(rule.pattern, rule.flags.includes('g') ? rule.flags : `${rule.flags}g`);
        } catch {
            status.setText(t('FIND_PREVIEW_INVALID'));
            status.addClass('mod-error');
            return;
        }
        if (this.subject.length > MAX_PREVIEW_CHARS) {
            status.remove();
            return;
        }

        let count = 0;
        while (count < MAX_PREVIEW_MATCHES) {
            const match = regex.exec(this.subject);
            if (!match) break;
            count++;
            // An empty match leaves lastIndex in place, which would find it again forever.
            if (match[0] === '') regex.lastIndex++;
        }
        // Without "g" only the first match is replaced.
        if (!rule.flags.includes('g')) count = Math.min(count, 1);
        status.setText(t('FIND_PREVIEW_MATCHES', count === MAX_PREVIEW_MATCHES ? `${count}+` : count));
    }

    private replace() {
        if (!this.pattern) {
            new Notice(t('PATTERN_EMPTY_ERR'));
            flashFieldError(this.patternInputEl);
            return;
        }
        // Only emptiness is checked on the typed text: spaces alone are a valid plain-text search.
        const rule = this.buildRule();
        if (!checkRegex(rule.pattern, rule.flags, this.patternInputEl, this.flagsInputEl)) return;
        this.onReplace(rule);
        this.close();
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

/** Tab order in the strip; the indicator is placed and animated by these indexes. */
const TAB_ORDER: ManagerTab[] = ['actions', 'sequences'];

export class RegexQuickActionsSettingsTab extends PluginSettingTab {
    plugin: RegexQuickActions;
    activeTab: ManagerTab = 'actions';
    /** The tab just switched away from, so the next render can animate the switch. */
    private switchedFrom: ManagerTab | null = null;
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
                // Holds only the "what's new" notice; Obsidian hides the group with it.
                type: 'group',
                cls: 'orp-settings-group',
                items: [{
                    name: t('COMMAND_SHOW_CHANGELOG'),
                    searchable: false,
                    visible: () => this.plugin.settings.dismissedChangelogVersion !== this.plugin.manifest.version,
                    render: (setting) => {
                        const root = this.acquireRoot(setting, 'orp-changelog-root');
                        root.empty();
                        const version = this.plugin.manifest.version;
                        renderChangelogNotice(root, {
                            app: this.app,
                            version,
                            dismissedVersion: this.plugin.settings.dismissedChangelogVersion,
                            onDismiss: () => {
                                this.plugin.settings.dismissedChangelogVersion = version;
                                void this.plugin.saveSettings();
                            },
                            onRemoved: () => this.update()
                        });
                    }
                }]
            },
            {
                type: 'group',
                cls: 'orp-settings-group orp-general-group',
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
                        'regex', 'regexp', t('RUN_QUICK_ACTION'), t('MANAGE_SECTION_HEADER'), t('ACTION_NAME'), t('SEARCH_REGEX'),
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
        // The strip and the tab's "new item" row are two halves of one bordered card.
        const card = root.createDiv({ cls: 'orp-tab-card' });
        this.renderTabs(card);
        const panel = root.createDiv({ cls: 'orp-tab-panel', attr: { role: 'tabpanel' } });
        if (this.activeTab === 'actions') this.renderActionsTab(card, panel);
        else this.renderSequencesTab(card, panel);

        if (this.switchedFrom) {
            this.animateTabSwitch(card, panel, this.switchedFrom);
            this.switchedFrom = null;
        }
    }

    /** Slides the indicator over from the previous tab and fades the new content in. */
    private animateTabSwitch(card: HTMLElement, panel: HTMLElement, from: ManagerTab) {
        if (card.win.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

        const shift = TAB_ORDER.indexOf(from) - TAB_ORDER.indexOf(this.activeTab);
        // A narrow card stacks the tabs (styles.css), and the indicator then moves vertically.
        const bar = card.querySelector<HTMLElement>('.orp-tabs');
        const axis = bar && card.win.getComputedStyle(bar).flexDirection === 'column' ? 'Y' : 'X';
        card.querySelector('.orp-tab-indicator')?.animate(
            [{ transform: `translate${axis}(${shift * 100}%)` }, { transform: `translate${axis}(0)` }],
            { duration: 250, easing: 'ease-in-out' }
        );

        // Opacity only: a sliding panel would briefly overflow the pane sideways.
        const content = Array.from(card.children).filter(el => !el.hasClass('orp-tabs'));
        for (const el of [...content, panel]) {
            el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250, easing: 'ease-out' });
        }
    }

    /** Redraws the manager with the settings pane left where it was. */
    private rerenderInPlace() {
        const scroller = this.findScroller(this.managerRootEl);
        const top = scroller?.scrollTop ?? 0;
        this.rerender();
        if (scroller) scroller.scrollTop = top;
    }

    /** The pane that scrolls around the manager, or null when nothing scrolls yet. */
    private findScroller(el: HTMLElement | null): HTMLElement | null {
        for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
            const overflowY = getComputedStyle(node).overflowY;
            const scrolls = overflowY === 'auto' || overflowY === 'scroll';
            if (scrolls && node.scrollHeight > node.clientHeight) return node;
        }
        return null;
    }

    /** The tab strip. Switching tabs drops any half-finished creation or edit with it. */
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
            // Both labels are rendered; CSS picks one by the width of the card.
            tab.createSpan({ text: label, cls: 'orp-tab-label' });
            tab.createSpan({ text: short, cls: 'orp-tab-label-short' });
            tab.createSpan({ text: String(count), cls: 'orp-tab-count' });
            tab.onclick = () => {
                if (isActive) return;
                this.switchedFrom = this.activeTab;
                this.activeTab = id;
                this.resetTempFields();
                this.showCreationForm = false;
                this.rerenderInPlace();
            };
        }

        // One underline for the active tab, so a switch can slide it across.
        bar.createDiv({ cls: 'orp-tab-indicator' });
        bar.setCssProps({
            '--orp-tab-count': String(TAB_ORDER.length),
            '--orp-tab-index': String(TAB_ORDER.indexOf(this.activeTab))
        });
    }

    /** The saved quick actions, with the inline creation form above them. */
    private renderActionsTab(card: HTMLElement, root: HTMLElement) {
        this.renderCreateRow(card, t('ADD_QUICK_ACTION'), () => {
            this.resetTempFields();
            this.showCreationForm = !this.showCreationForm;
            this.rerender();
        });

        if (this.showCreationForm) {
            const formContainer = root.createDiv({ cls: "orp-creation-row" });
            this.renderFormFields(formContainer, () => this.handleSave());
        }

        if (this.plugin.settings.rules.length === 0) {
            // An open form already says what the tab is for.
            if (!this.showCreationForm) this.renderEmptyState(root, t('NO_ACTIONS_YET'));
            return;
        }

        const listWrapper = root.createDiv({ cls: "orp-saved-list" });
        this.plugin.settings.rules.forEach(name => {
            const itemRow = listWrapper.createDiv({ cls: "orp-saved-rule-item" });
            if (this.editingRule === name) {
                this.renderFormFields(itemRow, () => this.handleUpdate(name), true);
            } else {
                const content = this.plugin.settings.rulesets[name] ?? "";
                const { pattern, flags, replacement } = this.parseRuleContent(content);
                const nameWrap = itemRow.createDiv({ cls: "orp-input-wrap orp-name-field" });
                nameWrap.createEl("small", { text: t('ACTION_NAME'), cls: "orp-label" });
                nameWrap.createDiv({ text: name, cls: "orp-saved-text-display" });
                const fieldsRow = itemRow.createDiv({ cls: "orp-fields-row" });
                this.createDisplayField(fieldsRow, t('SEARCH_REGEX'), pattern, "orp-pattern-field");
                this.createDisplayField(fieldsRow, t('FLAGS'), flags, "orp-flags-field");
                this.createDisplayField(fieldsRow, t('REPLACEMENT'), replacement, "orp-replacement-field");
                const actionsWrap = itemRow.createDiv({ cls: "orp-input-wrap orp-creation-actions" });
                const defaultWrap = actionsWrap.createDiv({ cls: "orp-default-toggle-wrap" });
                new ToggleComponent(defaultWrap)
                    .setValue(this.plugin.settings.defaultRule === name)
                    .onChange(async (value) => {
                        this.plugin.settings.defaultRule = value ? name : null;
                        await this.plugin.saveSettings();
                        this.rerender();
                    });
                defaultWrap.createSpan({ text: t('SET_AS_DEFAULT'), cls: "orp-toggle-label" });
                const buttons = actionsWrap.createDiv({ cls: "orp-action-buttons" });
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

        const listWrapper = root.createDiv({ cls: "orp-saved-list" });
        sequences.forEach(sequence => {
            const itemRow = listWrapper.createDiv({ cls: "orp-saved-rule-item" });
            const nameWrap = itemRow.createDiv({ cls: "orp-input-wrap orp-name-field" });
            nameWrap.createEl("small", { text: t('SEQUENCE_NAME'), cls: "orp-label" });
            nameWrap.createDiv({ text: sequence.name, cls: "orp-saved-text-display" });

            const stepsWrap = itemRow.createDiv({ cls: "orp-input-wrap" });
            stepsWrap.createEl("small", { text: t('SEQUENCE_STEPS_LABEL'), cls: "orp-label" });
            stepsWrap.createDiv({
                text: sequence.steps.join("  →  "),
                cls: "orp-saved-text-display"
            });

            const buttons = itemRow.createDiv({ cls: "orp-sequence-actions" });
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
     * The tab's "new item" button, which is the whole row: no name, no description, and
     * the entire row as its click target (see .orp-create-row). Goes into the tab card,
     * whose lower half it is.
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
        const wrap = parent.createDiv({ cls: `orp-input-wrap ${cls}` });
        wrap.createEl("small", { text: label, cls: "orp-label" });
        wrap.createDiv({ text: val, cls: "orp-saved-text-display" });
    }

    private renderFormFields(container: HTMLElement, onConfirm: () => unknown, isUpdate = false) {
        const nameWrap = container.createDiv({ cls: "orp-input-wrap orp-name-field" });
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

        const fieldsRow = container.createDiv({ cls: "orp-fields-row" });
        this.patternInputEl = createInputField(fieldsRow, t('SEARCH_REGEX'), this.tempPattern, t('PLACEHOLDER_SEARCH'), "orp-pattern-field", (v) => this.tempPattern = v);
        this.flagsInputEl = createInputField(fieldsRow, t('FLAGS'), this.tempFlags, t('PLACEHOLDER_FLAGS'), "orp-flags-field", (v) => this.tempFlags = v);
        createInputField(fieldsRow, t('REPLACEMENT'), this.tempReplacement, t('PLACEHOLDER_REPLACEMENT'), "orp-replacement-field", (v) => this.tempReplacement = v);

        const actionsWrap = container.createDiv({ cls: "orp-input-wrap orp-creation-actions" });
        const defaultWrap = actionsWrap.createDiv({ cls: "orp-default-toggle-wrap" });
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
        const buttons = actionsWrap.createDiv({ cls: "orp-action-buttons" });
        new ButtonComponent(buttons).setButtonText(t('SAVE')).setCta().onClick(onConfirm);
        new ButtonComponent(buttons).setButtonText(t('CANCEL')).onClick(() => {
            this.editingRule = null;
            this.showCreationForm = false;
            this.rerender();
        });
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

        return validatePattern(this.tempPattern, this.tempFlags, this.patternInputEl, this.flagsInputEl);
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
