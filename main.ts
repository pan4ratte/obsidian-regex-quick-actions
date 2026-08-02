import { Editor, MarkdownView, Menu, MenuItem, Notice, Plugin, TAbstractFile, TFile, TFolder, Vault } from 'obsidian';

import { t } from './i18n';
import { ActionSequence, CommandApp, DEFAULT_SETTINGS, FileSnapshot, ImportResult, LastRun, MAX_REVERT_CHARS, QuickJob, RegexQuickActionsSettings, RulesetEntry } from './types';
import { ConfirmationModal, RegexQuickActionsSettingsTab } from './settings';

/**
 * Expands a replacement string ($1, $&, $<name>, ...) against the arguments
 * String.replace() hands to a replacer function, mirroring what replace()
 * would have produced with that string directly. Needed so a rule can tell
 * whether a match was actually changed or replaced with itself.
 */
function expandReplacement(replacement: string, args: unknown[]): string {
    const hasNamedGroups = typeof args[args.length - 1] === 'object';
    const tail = hasNamedGroups ? 3 : 2;
    const groups = (hasNamedGroups ? args[args.length - 1] : undefined) as Record<string, string | undefined> | undefined;
    const subject = args[args.length - tail + 1] as string;
    const offset = args[args.length - tail] as number;
    const match = args[0] as string;
    const captures = args.slice(1, args.length - tail) as (string | undefined)[];

    return replacement.replace(/\$(\$|&|`|'|<[^>]*>|\d{1,2})/g, (token, selector: string) => {
        switch (selector[0]) {
            case '$': return '$';
            case '&': return match;
            case '`': return subject.slice(0, offset);
            case "'": return subject.slice(offset + match.length);
            case '<': return groups ? (groups[selector.slice(1, -1)] ?? '') : token;
            default: {
                let index = parseInt(selector, 10);
                let trailing = '';
                // $12 with fewer than 12 groups falls back to group 1 followed by "2"
                if (index > captures.length && selector.length === 2) {
                    index = parseInt(selector[0], 10);
                    trailing = selector[1];
                }
                if (index < 1 || index > captures.length) return token;
                return (captures[index - 1] ?? '') + trailing;
            }
        }
    });
}

export default class RegexQuickActions extends Plugin {
    settings: RegexQuickActionsSettings;

    /** Last revertible run. Deliberately not persisted: it dies with the session. */
    private lastRun: LastRun | null = null;

    async onload() {
        await this.loadSettings();

        this.addSettingTab(new RegexQuickActionsSettingsTab(this.app, this));

        this.settings.rules.forEach(ruleName => {
            this.addRuleCommand(ruleName);
        });

        this.addCommand({
            id: 'revert-last-quick-action',
            name: t('REVERT_LAST'),
            callback: () => {
                void this.revertLastRun();
            }
        });

        this.settings.sequences.forEach(sequence => {
            this.addSequenceCommand(sequence.name);
        });

        this.registerEvent(
            this.app.workspace.on("file-menu", (menu: Menu, file: TAbstractFile) => {
                if (file instanceof TFile) {
                    this.addDefaultItem(menu, t('RUN_DEFAULT'), job => void this.applyJobToFile(file, job));
                    this.addRunSubmenu(menu, job => void this.applyJobToFile(file, job));
                } else if (file instanceof TFolder) {
                    this.addDefaultItem(menu, t('RUN_DEFAULT_ON_FOLDER'), job => this.runOnFolder(file, job));
                    this.addRunSubmenu(menu, job => this.runOnFolder(file, job));
                }
            })
        );

        this.registerEvent(
            this.app.workspace.on("files-menu", (menu: Menu, files: TAbstractFile[]) => {
                const markdownFiles = files.filter((f): f is TFile => f instanceof TFile);
                if (markdownFiles.length === 0) return;

                this.addDefaultItem(menu, t('RUN_DEFAULT'), job => void this.applyJobToFiles(markdownFiles, job));
                this.addRunSubmenu(menu, job => void this.applyJobToFiles(markdownFiles, job));
            })
        );

        this.registerEvent(
            this.app.workspace.on("editor-menu", (menu: Menu, editor: Editor) => {
                this.addDefaultItem(menu, t('RUN_DEFAULT'), job => void this.applyJob(job, editor));
                this.addRunSubmenu(menu, job => void this.applyJob(job, editor));
            })
        );
    }

    /** Adds the "run default" entry, when a default quick action is set. */
    private addDefaultItem(menu: Menu, title: string, run: (job: QuickJob) => void) {
        const job = this.settings.defaultRule ? this.resolveAction(this.settings.defaultRule) : null;
        if (!job) return;

        menu.addItem((item) => {
            item.setTitle(title).setIcon("play").onClick(() => run(job));
        });
    }

    /** Adds the submenu that lists every quick action and then every sequence. */
    private addRunSubmenu(menu: Menu, run: (job: QuickJob) => void) {
        if (this.settings.rules.length === 0 && this.settings.sequences.length === 0) return;

        menu.addItem((item) => {
            item.setTitle(t('RUN_QUICK_ACTION')).setIcon("list");
            const submenu = (item as MenuItem & { setSubmenu(): Menu }).setSubmenu();

            this.settings.rules.forEach(ruleName => {
                const job = this.resolveAction(ruleName);
                if (!job) return;
                submenu.addItem((subItem: MenuItem) => {
                    subItem.setTitle(ruleName).setIcon("play").onClick(() => run(job));
                });
            });

            this.settings.sequences.forEach(sequence => {
                const job = this.resolveSequence(sequence.name);
                if (!job) return;
                submenu.addItem((subItem: MenuItem) => {
                    subItem.setTitle(sequence.name).setIcon("list-ordered").onClick(() => run(job));
                });
            });
        });
    }

    /** Runs a job across a folder, behind the confirmation dialog when it is enabled. */
    private runOnFolder(folder: TFolder, job: QuickJob) {
        const run = async () => {
            await this.applyJobToFolder(folder, job);
        };
        if (this.settings.confirmFolderAction) {
            new ConfirmationModal(
                this.app,
                t('FOLDER_ACTION_CONFIRM_TITLE'),
                t('FOLDER_ACTION_CONFIRM_MSG'),
                t('YES'),
                run
            ).open();
        } else {
            void run();
        }
    }

    /** Turns a quick action name into the single-step job that runs it. */
    private resolveAction(name: string): QuickJob | null {
        const ruleText = this.settings.rulesets[name];
        return ruleText === undefined ? null : { name, steps: [ruleText] };
    }

    /**
     * Turns a sequence name into the job that runs its member actions in order. Members
     * that no longer exist are dropped rather than aborting the whole sequence.
     */
    private resolveSequence(name: string): QuickJob | null {
        const sequence = this.settings.sequences.find(item => item.name === name);
        if (!sequence) return null;

        const steps = sequence.steps
            .map(step => this.settings.rulesets[step])
            .filter((ruleText): ruleText is string => ruleText !== undefined);
        return { name, steps };
    }

    private getCommandId(name: string): string {
        return `apply-rule-${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
    }

    private getSequenceCommandId(name: string): string {
        return `run-sequence-${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
    }

    addRuleCommand(name: string) {
        this.addCommand({
            id: this.getCommandId(name),
            name: `${name}`,
            checkCallback: (checking: boolean) => {
                const activeMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (activeMarkdownView) {
                    if (!checking) {
                        const job = this.resolveAction(name);
                        if (job) void this.applyJob(job);
                        else new Notice(t('NOT_FOUND_ERR', name));
                    }
                    return true;
                }
                return false;
            }
        });
    }

    addSequenceCommand(name: string) {
        this.addCommand({
            id: this.getSequenceCommandId(name),
            name: `${name}`,
            checkCallback: (checking: boolean) => {
                const activeMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (activeMarkdownView) {
                    if (!checking) {
                        const job = this.resolveSequence(name);
                        if (job) void this.applyJob(job);
                        else new Notice(t('NOT_FOUND_ERR', name));
                    }
                    return true;
                }
                return false;
            }
        });
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<RegexQuickActionsSettings>);
        // Ensure rulesets map always exists (for older data.json without it)
        if (!this.settings.rulesets) {
            this.settings.rulesets = {};
        }
        if (!Array.isArray(this.settings.sequences)) {
            this.settings.sequences = [];
        }
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async createRuleset(name: string, content: string): Promise<boolean> {
        this.settings.rules.unshift(name);
        this.settings.rulesets[name] = content;
        await this.saveSettings();
        this.addRuleCommand(name);
        return true;
    }

    async updateRuleset(oldName: string, newName: string, content: string): Promise<void> {
        this.settings.rulesets[newName] = content;
        if (oldName !== newName) {
            delete this.settings.rulesets[oldName];
            (this.app as CommandApp).commands.removeCommand(`${this.manifest.id}:${this.getCommandId(oldName)}`);
            const index = this.settings.rules.indexOf(oldName);
            if (index !== -1) {
                this.settings.rules[index] = newName;
                if (this.settings.defaultRule === oldName) this.settings.defaultRule = newName;
                this.addRuleCommand(newName);
            }
            // Sequences refer to their members by name, so a rename has to follow through.
            this.settings.sequences.forEach(sequence => {
                sequence.steps = sequence.steps.map(step => step === oldName ? newName : step);
            });
        }
        await this.saveSettings();
    }

    /** True when a quick action or another sequence already uses this name. */
    isNameTaken(name: string, exceptSequence?: string): boolean {
        const lowered = name.toLowerCase();
        return this.settings.rules.some(rule => rule.toLowerCase() === lowered)
            || this.settings.sequences.some(sequence =>
                sequence.name.toLowerCase() === lowered && sequence.name !== exceptSequence);
    }

    async createSequence(name: string, steps: string[]): Promise<void> {
        this.settings.sequences.unshift({ name, steps });
        await this.saveSettings();
        this.addSequenceCommand(name);
    }

    async updateSequence(oldName: string, newName: string, steps: string[]): Promise<void> {
        const sequence = this.settings.sequences.find(item => item.name === oldName);
        if (!sequence) return;

        sequence.name = newName;
        sequence.steps = steps;
        if (oldName !== newName) {
            (this.app as CommandApp).commands.removeCommand(`${this.manifest.id}:${this.getSequenceCommandId(oldName)}`);
            this.addSequenceCommand(newName);
        }
        await this.saveSettings();
    }

    async deleteSequence(name: string): Promise<void> {
        this.settings.sequences = this.settings.sequences.filter(sequence => sequence.name !== name);
        (this.app as CommandApp).commands.removeCommand(`${this.manifest.id}:${this.getSequenceCommandId(name)}`);
        await this.saveSettings();
    }

    /** Finds an existing action by name, matching the way command ids collapse case. */
    private findRuleName(name: string): string | undefined {
        return this.settings.rules.find(rule => rule.toLowerCase() === name.toLowerCase());
    }

    /** First "Name (n)" that no quick action and no sequence is using. */
    private freeName(base: string): string {
        let suffix = 2;
        while (this.isNameTaken(`${base} (${suffix})`)) suffix++;
        return `${base} (${suffix})`;
    }

    /**
     * Merges an imported set into the current one without ever overwriting: an entry
     * whose name is taken is added under a free name, and an entry that is already
     * present verbatim is skipped. `defaultRule` is only adopted when this vault has none.
     */
    async importData(entries: RulesetEntry[], sequences: ActionSequence[], defaultRule: string | null): Promise<ImportResult> {
        const result: ImportResult = { added: 0, renamed: 0, skipped: 0 };
        // Each imported action's original name mapped to the name it ended up with, so
        // imported sequences still point at their own members after a rename.
        const resolved = new Map<string, string>();

        // Reversed because insertion puts each entry on top of the list; walking
        // backwards leaves the imported set in its original order.
        for (const entry of [...entries].reverse()) {
            const existingAction = this.findRuleName(entry.name);
            if (existingAction !== undefined && this.settings.rulesets[existingAction] === entry.content) {
                resolved.set(entry.name, existingAction);
                result.skipped++;
                continue;
            }

            let name = entry.name;
            if (this.isNameTaken(name)) {
                name = this.freeName(name);
                result.renamed++;
            } else {
                result.added++;
            }

            this.settings.rules.unshift(name);
            this.settings.rulesets[name] = entry.content;
            this.addRuleCommand(name);
            resolved.set(entry.name, name);
        }

        for (const sequence of [...sequences].reverse()) {
            // A step points at an action that came in with the file, or at one already
            // here under that name; anything else no longer exists and is dropped.
            const steps = sequence.steps
                .map(step => resolved.get(step) ?? this.findRuleName(step))
                .filter((step): step is string => step !== undefined);
            if (steps.length === 0) {
                result.skipped++;
                continue;
            }

            const existing = this.settings.sequences.find(item =>
                item.name.toLowerCase() === sequence.name.toLowerCase());
            if (existing && existing.steps.join('\n') === steps.join('\n')) {
                result.skipped++;
                continue;
            }

            let name = sequence.name;
            if (this.isNameTaken(name)) {
                name = this.freeName(name);
                result.renamed++;
            } else {
                result.added++;
            }

            this.settings.sequences.unshift({ name, steps });
            this.addSequenceCommand(name);
        }

        if (this.settings.defaultRule === null && defaultRule) {
            this.settings.defaultRule = this.findRuleName(defaultRule) ?? null;
        }

        await this.saveSettings();
        return result;
    }

    async deleteRuleset(name: string): Promise<void> {
        delete this.settings.rulesets[name];
        (this.app as CommandApp).commands.removeCommand(`${this.manifest.id}:${this.getCommandId(name)}`);
        this.settings.rules = this.settings.rules.filter(r => r !== name);
        if (this.settings.defaultRule === name) this.settings.defaultRule = null;
        // A deleted action cannot stay a step of any sequence.
        this.settings.sequences.forEach(sequence => {
            sequence.steps = sequence.steps.filter(step => step !== name);
        });
        await this.saveSettings();
    }

    async applyJobToFile(file: TFile, job: QuickJob) {
        const snapshots: FileSnapshot[] = [];
        const count = await this.modifyFile(file, job, snapshots);
        this.rememberRun(job.name, snapshots);
        new Notice(t('EXECUTED_MSG', job.name, count));
    }

    async applyJobToFiles(files: TFile[], job: QuickJob) {
        const snapshots: FileSnapshot[] = [];
        let totalCount = 0;
        // Awaited one file at a time, so no two files are ever rewritten at once.
        for (const file of files) {
            totalCount += await this.modifyFile(file, job, snapshots);
        }
        this.rememberRun(job.name, snapshots);
        new Notice(t('EXECUTED_MSG', job.name, totalCount));
    }

    async applyJobToFolder(folder: TFolder, job: QuickJob) {
        const files: TFile[] = [];
        Vault.recurseChildren(folder, (f) => {
            if (f instanceof TFile && f.extension === "md") files.push(f);
        });

        const snapshots: FileSnapshot[] = [];
        let totalCount = 0;
        for (const file of files) {
            totalCount += await this.modifyFile(file, job, snapshots);
        }
        this.rememberRun(job.name, snapshots);
        new Notice(t('EXECUTED_MSG', job.name, totalCount));
    }

    /**
     * Applies a job to one file and, when the content actually changed, appends a
     * snapshot of it to `snapshots`. Files the job leaves untouched are not written
     * back at all, so a folder-wide run does not bump the mtime of every note in it.
     */
    private async modifyFile(file: TFile, job: QuickJob, snapshots: FileSnapshot[]): Promise<number> {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);

        if (activeView && activeView.file?.path === file.path) {
            const editor = activeView.editor;
            const scroll = editor.getScrollInfo();
            const cursor = editor.getCursor();

            const before = editor.getValue();
            const result = this.processJob(before, job);
            if (before === result.content) return result.count;

            editor.setValue(result.content);
            editor.setCursor(cursor);
            editor.scrollTo(0, scroll.top);
            snapshots.push({ path: file.path, before, after: result.content });
            return result.count;
        } else {
            const before = await this.app.vault.read(file);
            const result = this.processJob(before, job);
            if (before === result.content) return result.count;

            await this.app.vault.modify(file, result.content);
            snapshots.push({ path: file.path, before, after: result.content });
            return result.count;
        }
    }

    /**
     * Runs every step of a job over the text, each one on the output of the one before.
     * This is deliberately synchronous: a step cannot begin before its predecessor has
     * returned, so the steps of a sequence can never interleave or race each other, and
     * the file is read once up front and written once at the end.
     */
    private processJob(subject: string, job: QuickJob): { content: string, count: number } {
        let content = subject;
        let count = 0;
        for (const ruleText of job.steps) {
            const result = this.processRegex(content, ruleText, job.name);
            content = result.content;
            count += result.count;
        }
        return { content, count };
    }

    /**
     * Stores a run so the revert command can undo it, replacing whatever was stored
     * before — reverting is a single step back, not a history stack.
     */
    private rememberRun(rulesetName: string, snapshots: FileSnapshot[]) {
        if (snapshots.length === 0) {
            this.lastRun = null;
            return;
        }

        const size = snapshots.reduce((total, s) => total + s.before.length + s.after.length, 0);
        if (size > MAX_REVERT_CHARS) {
            this.lastRun = null;
            new Notice(t('REVERT_TOO_LARGE'));
            return;
        }

        this.lastRun = { rulesetName, snapshots };
    }

    /** Restores every file of the last run that still holds exactly what the run left. */
    async revertLastRun() {
        const lastRun = this.lastRun;
        if (!lastRun) {
            new Notice(t('NOTHING_TO_REVERT'));
            return;
        }
        this.lastRun = null;

        let reverted = 0;
        let skipped = 0;
        for (const snapshot of lastRun.snapshots) {
            if (await this.restoreFile(snapshot)) reverted++;
            else skipped++;
        }

        if (skipped > 0) new Notice(t('REVERTED_PARTIAL_MSG', lastRun.rulesetName, reverted, skipped));
        else new Notice(t('REVERTED_MSG', lastRun.rulesetName, reverted));
    }

    /**
     * Puts one file back to its pre-run content. Returns false — leaving the file alone —
     * when it is gone or no longer matches the snapshot, so edits made after the run
     * are never overwritten.
     */
    private async restoreFile(snapshot: FileSnapshot): Promise<boolean> {
        const file = this.app.vault.getFileByPath(snapshot.path);
        if (!file) return false;

        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (activeView && activeView.file?.path === file.path) {
            const editor = activeView.editor;
            if (editor.getValue() !== snapshot.after) return false;

            const scroll = editor.getScrollInfo();
            const cursor = editor.getCursor();
            editor.setValue(snapshot.before);
            editor.setCursor(cursor);
            editor.scrollTo(0, scroll.top);
            return true;
        }

        const current = await this.app.vault.read(file);
        if (current !== snapshot.after) return false;
        await this.app.vault.modify(file, snapshot.before);
        return true;
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
                output = output.replace(matchRule, (...args) => {
                    const match = args[0];
                    const result = mode === 'x' ? '' : expandReplacement(replacement, args);
                    if (result !== match) count++;
                    return result;
                });
            } catch (e) {
                console.error(`Regex Quick Actions: Invalid Regex in ${rulesetName}`, e);
            }
        }
        return { content: output, count };
    }

    async applyJob(job: QuickJob, editor?: Editor) {
        if (!editor) {
            const activeMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (!activeMarkdownView) return;
            editor = activeMarkdownView.editor;
        }

        // Selection scoping is opt-in: with the setting off, or with nothing selected,
        // the action keeps applying to the whole note.
        const useSelection = this.settings.applyToSelection && editor.somethingSelected();
        const subject = useSelection ? editor.getSelection() : editor.getValue();

        const path = this.app.workspace.getActiveViewOfType(MarkdownView)?.file?.path;
        const before = useSelection ? editor.getValue() : subject;

        const pos = editor.getScrollInfo();
        const result = this.processJob(subject, job);
        if (useSelection) {
            const from = editor.getCursor('from');
            editor.replaceSelection(result.content);
            // replaceSelection collapses the selection to the end of the inserted text;
            // re-select it so further actions can be chained on the same fragment.
            editor.setSelection(from, editor.getCursor());
        } else {
            editor.setValue(result.content);
        }
        editor.scrollTo(0, pos.top);

        const after = editor.getValue();
        this.rememberRun(job.name, path && after !== before ? [{ path, before, after }] : []);
        new Notice(t('EXECUTED_MSG', job.name, result.count));
    }
}
