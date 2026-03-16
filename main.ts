import { Editor, MarkdownView, Menu, Notice, Plugin, TAbstractFile, TFile, TFolder } from 'obsidian';
import { t } from './i18n';
import { CommandApp, DEFAULT_SETTINGS, RegexQuickActionsSettings } from './types';
import { ConfirmationModal, RegexQuickActionsSettingsTab } from './settings';

export default class RegexQuickActions extends Plugin {
    settings: RegexQuickActionsSettings;

    async onload() {
        await this.loadSettings();

        this.addSettingTab(new RegexQuickActionsSettingsTab(this.app, this));

        this.settings.rules.forEach(ruleName => {
            this.addRuleCommand(ruleName);
        });

        this.registerEvent(
            this.app.workspace.on("file-menu", (menu: Menu, file: TAbstractFile) => {
                if (file instanceof TFile && this.settings.defaultRule) {
                    menu.addItem((item) => {
                        item
                            .setTitle(t('RUN_DEFAULT'))
                            .setIcon("play")
                            .onClick(async () => {
                                await this.applyRulesetToFile(file, this.settings.defaultRule!);
                            });
                    });
                }

                if (file instanceof TFolder && this.settings.defaultRule) {
                    menu.addItem((item) => {
                        item
                            .setTitle(t('RUN_DEFAULT_ON_FOLDER'))
                            .setIcon("play")
                            .onClick(() => {
                                const run = async () => {
                                    await this.applyRulesetToFolder(file, this.settings.defaultRule!);
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
                                    run();
                                }
                            });
                    });
                }
            })
        );

        this.registerEvent(
            this.app.workspace.on("editor-menu", (menu: Menu, editor: Editor) => {
                if (this.settings.defaultRule) {
                    menu.addItem((item) => {
                        item
                            .setTitle(t('RUN_DEFAULT'))
                            .setIcon("play")
                            .onClick(async () => {
                                await this.applyRuleset(this.settings.defaultRule!, editor);
                            });
                    });
                }
            })
        );
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
                        this.applyRuleset(name);
                    }
                    return true;
                }
                return false;
            }
        });
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
        // Ensure rulesets map always exists (for older data.json without it)
        if (!this.settings.rulesets) {
            this.settings.rulesets = {};
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
        }
        await this.saveSettings();
    }

    async deleteRuleset(name: string): Promise<void> {
        delete this.settings.rulesets[name];
        (this.app as CommandApp).commands.removeCommand(`${this.manifest.id}:${this.getCommandId(name)}`);
        this.settings.rules = this.settings.rules.filter(r => r !== name);
        if (this.settings.defaultRule === name) this.settings.defaultRule = null;
        await this.saveSettings();
    }

    async applyRulesetToFile(file: TFile, rulesetName: string) {
        const ruleText = this.settings.rulesets[rulesetName];
        if (ruleText === undefined) return;

        const count = await this.modifyFile(file, ruleText, rulesetName);
        new Notice(t('EXECUTED_MSG', rulesetName, count));
    }

    async applyRulesetToFolder(folder: TFolder, rulesetName: string) {
        const ruleText = this.settings.rulesets[rulesetName];
        if (ruleText === undefined) return;

        const files = this.app.vault.getMarkdownFiles().filter(f => f.path.startsWith(folder.path + "/"));

        let totalCount = 0;
        for (const file of files) {
            totalCount += await this.modifyFile(file, ruleText, rulesetName);
        }
        new Notice(t('EXECUTED_MSG', rulesetName, totalCount));
    }

    private async modifyFile(file: TFile, ruleText: string, rulesetName: string): Promise<number> {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);

        if (activeView && activeView.file?.path === file.path) {
            const editor = activeView.editor;
            const scroll = editor.getScrollInfo();
            const cursor = editor.getCursor();

            const result = this.processRegex(editor.getValue(), ruleText, rulesetName);
            editor.setValue(result.content);

            editor.setCursor(cursor);
            editor.scrollTo(0, scroll.top);
            return result.count;
        } else {
            const fileContent = await this.app.vault.read(file);
            const result = this.processRegex(fileContent, ruleText, rulesetName);
            await this.app.vault.modify(file, result.content);
            return result.count;
        }
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
                count += output.match(matchRule)?.length ?? 0;
                output = mode === 'x' ? output.replace(matchRule, '') : output.replace(matchRule, replacement);
            } catch (e) {
                console.error(`Regex Quick Actions: Invalid Regex in ${rulesetName}`, e);
            }
        }
        return { content: output, count };
    }

    async applyRuleset(rulesetName: string, editor?: Editor) {
        const ruleText = this.settings.rulesets[rulesetName];
        if (ruleText === undefined) {
            new Notice(rulesetName + t('NOT_FOUND_ERR'));
            return;
        }
        if (!editor) {
            const activeMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (!activeMarkdownView) return;
            editor = activeMarkdownView.editor;
        }

        const subject = editor.somethingSelected() ? editor.getSelection() : editor.getValue();

        const pos = editor.getScrollInfo();
        const result = this.processRegex(subject, ruleText, rulesetName);
        if (editor.somethingSelected()) editor.replaceSelection(result.content);
        else editor.setValue(result.content);
        editor.scrollTo(0, pos.top);
        new Notice(t('EXECUTED_MSG', rulesetName, result.count));
    }
}
