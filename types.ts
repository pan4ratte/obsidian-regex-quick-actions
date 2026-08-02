import { App } from 'obsidian';

/**
 * Interface to access internal Obsidian command registry
 */
export interface CommandApp extends App {
    commands: {
        removeCommand(id: string): void;
    };
}

/** A named chain of quick actions, run one after another in the stored order. */
export interface ActionSequence {
    name: string;
    steps: string[];
}

/**
 * A resolved unit of work: the rule texts to apply, in order, under one display name.
 * A quick action resolves to a single step, a sequence to one step per member action.
 */
export interface QuickJob {
    name: string;
    steps: string[];
}

/** A single quick action as it travels through an export file. */
export interface RulesetEntry {
    name: string;
    content: string;
}

/** What an import did to the existing action set, for reporting back to the user. */
export interface ImportResult {
    added: number;
    renamed: number;
    skipped: number;
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

/**
 * Upper bound on the length of a stored rule. The parser is polynomial on text that
 * repeats the rule delimiters, so an imported action could otherwise hang the app;
 * a real rule is a few hundred characters.
 */
export const MAX_RULE_CHARS = 10_000;

export interface RegexQuickActionsSettings {
    rules: string[];
    rulesets: Record<string, string>;
    sequences: ActionSequence[];
    defaultRule: string | null;
    confirmFolderAction: boolean;
    applyToSelection: boolean;
}

export const DEFAULT_SETTINGS: RegexQuickActionsSettings = {
    rules: [],
    rulesets: {},
    sequences: [],
    defaultRule: null,
    confirmFolderAction: true,
    applyToSelection: false
};
