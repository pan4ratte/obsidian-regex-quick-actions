import { App } from 'obsidian';

/**
 * Interface to access internal Obsidian command registry
 */
export interface CommandApp extends App {
    commands: {
        removeCommand(id: string): void;
    };
}

export interface RegexQuickActionsSettings {
    rules: string[];
    rulesets: Record<string, string>;
    defaultRule: string | null;
    confirmFolderAction: boolean;
}

export const DEFAULT_SETTINGS: RegexQuickActionsSettings = {
    rules: [],
    rulesets: {},
    defaultRule: null,
    confirmFolderAction: true
};
