import { App } from 'obsidian';

/**
 * Interface to access internal Obsidian command registry
 */
export interface CommandApp extends App {
    commands: {
        removeCommand(id: string): void;
    };
}

/**
 * Content of a single file captured around a quick action run. `after` is kept so a
 * revert can tell whether the file still holds what the action left behind.
 */
export interface FileSnapshot {
    path: string;
    before: string;
    after: string;
}

/** The most recent quick action run, held in memory only, so it can be reverted. */
export interface LastRun {
    rulesetName: string;
    snapshots: FileSnapshot[];
}

/**
 * Upper bound on the characters a revertible run may hold. Folder-wide runs can touch
 * thousands of notes; past this the run is dropped rather than pinned in memory.
 */
export const MAX_REVERT_CHARS = 10_000_000;

export interface RegexQuickActionsSettings {
    rules: string[];
    rulesets: Record<string, string>;
    defaultRule: string | null;
    confirmFolderAction: boolean;
    applyToSelection: boolean;
}

export const DEFAULT_SETTINGS: RegexQuickActionsSettings = {
    rules: [],
    rulesets: {},
    defaultRule: null,
    confirmFolderAction: true,
    applyToSelection: false
};
