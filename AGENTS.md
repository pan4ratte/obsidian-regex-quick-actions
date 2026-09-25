# AGENTS.md

Guidance for AI coding agents working in this repository. Human contributors should read [CONTRIBUTING.md](CONTRIBUTING.md).

## Project

Regex Quick Actions is an Obsidian community plugin (id `regex-quick-actions`). Users save regex find/replace rules as named "quick actions", chain them into "action sequences", and run them from the command palette, hotkeys, and the file, folder, and editor context menus. The plugin runs on desktop and mobile (`isDesktopOnly: false`) and needs Obsidian 1.13.0 or later.

## Commands

```sh
npm install       # install dependencies
npm run dev       # rollup watch build → main.js
npm run build     # type check (tsc --noEmit) + production bundle
npm run lint      # eslint (TypeScript) + stylelint (styles.css)
npm run fix       # eslint --fix + stylelint --fix
```

Both linters run the rule sets of Obsidian's community plugin review. ESLint uses `eslint-plugin-obsidianmd` (see `eslint.config.mjs`). Stylelint uses `stylelint-config-obsidianmd`, checked against Electron 39 (see `stylelint.config.mjs`). A warning here is one the review would report, so fix it rather than disabling the rule. `lint:css` runs with `--ignore-disables`, so `stylelint-disable` comments have no effect.

There is no automated test suite. After every source change, run `npm run build` and `npm run lint` yourself, without being asked, and make sure both pass with no new warnings. Obsidian loads the bundled `main.js`, not the TypeScript, so an unbuilt fix looks like one that didn't work. The changelogs are bundled too. Test behaviour by hand in an Obsidian vault (see [Manual testing](#manual-testing)).

Never rewrite `package-lock.json` with Windows npm (`npm install <pkg>`, `npm update`, `npm audit fix`). Windows resolves optional platform packages differently, so the result breaks `npm ci` on Linux: the release workflow fails, and the plugin review site reports hundreds of false `no-unsafe-*` warnings. Regenerate the lockfile in WSL/Linux, and check it with `rm -rf node_modules && npm ci`.

## Layout

| File | Contents |
| --- | --- |
| `main.ts` | Plugin class: command registration, context menus, rule parsing, the run pipeline (`applyJob*`, `modifyFile`, `processJob`, `applyRules`), and revert. |
| `settings.ts` | Settings tab (declarative 1.13 settings API plus the custom action/sequence manager), `ConfirmationModal`, `QuickFindReplaceModal`, `SequenceModal`, and import/export. |
| `types.ts` | Shared interfaces, `DEFAULT_SETTINGS`, and the safety limits `MAX_RULE_CHARS` and `MAX_REVERT_CHARS`. |
| `changelog.ts` | The in-app changelog window (`ChangelogModal`) and the "what's new" notice at the top of the settings. |
| `CHANGELOG.md`, `CHANGELOG_RU.md` | The changelogs. Both are imported as text (`markdown.d.ts`, the `markdownText` plugin in `rollup.config.js`), bundled into `main.js`, and shown inside the plugin. |
| `i18n.ts` | The `t(key, ...args)` translation helper. |
| `locales/en.ts`, `locales/ru.ts` | All UI strings. |
| `styles.css` | Plugin styles. |
| `manifest.json`, `versions.json` | Obsidian plugin metadata. |
| `.github/workflows/main.yml` | Build, attest, and release workflow. |

Generated or local files you must not edit or commit: `main.js` (rollup output), `data.json` (the user's saved settings), and `node_modules/`. All three are in `.gitignore`.

## Core concepts

- **Rule text.** Each quick action is stored as rule text in `settings.rulesets[name]`, in this format:
  ```
  "pattern"flags
  ->
  "replacement"
  ```
  One action can hold several rules. They run in order, and each rule works on the output of the one before. If no flags are given, `gm` is used. A trailing `x` mode deletes every match. The format has no way to escape a quote, which is why the quick find/replace modal passes ready-made `RegexRule`s through `QuickJob.rules` and does not serialise them to rule text. `main.ts` (`parseRules`) and `settings.ts` (`parseRuleContent`) each parse this format, so update both if you change it.
- **Jobs.** Quick actions and sequences both resolve to a `QuickJob` (`resolveAction` / `resolveSequence`). Every entry point runs through the same pipeline, so put new behaviour in that shared path rather than in a single entry point.
- **Command IDs.** IDs are derived from names: `apply-rule-<slug>` and `run-sequence-<slug>`. The fixed commands are `quick-find-replace`, `revert-last-quick-action`, and `show-changelog`. Users bind hotkeys to these IDs, so do not change how they are derived.
- **Revert.** `lastRun` holds before/after snapshots in memory only and is never persisted. Any new code path that writes files must record snapshots the same way `modifyFile` does. It must also skip writing files whose content did not change.
- **Settings compatibility.** `loadSettings` merges stored data over `DEFAULT_SETTINGS` and repairs missing fields. Every new setting needs a default in `types.ts`, and a `data.json` written by an older version must still load.

## Conventions

- **Strings.** Never hard-code user-facing text. Add a key to `locales/en.ts` and the same key to `locales/ru.ts`, then call `t('KEY')`. Placeholders are positional `{}`. A key missing from `ru.ts` fails the type check. English strings use sentence case, and lint enforces it (only the brand names "Regex Quick Actions" and "Obsidian" stay capitalised).
- **Mobile.** Do not use Node or Electron modules (lint enforces this). Features that cannot work on mobile, such as export, are disabled there with an explanation. They must not break on mobile.
- **Obsidian API.** Use the public API wherever possible. Internal APIs are typed narrowly (see `CommandApp` in `types.ts`). Register event handlers with `this.registerEvent` so they are cleaned up on unload.
- **Safety.** Rule text can come from imported files. Keep the `MAX_RULE_CHARS` guard before parsing. Wrap `new RegExp` in try/catch, and report failures through a `Notice` or `console.error` prefixed with `Regex Quick Actions:`. Do not throw.
- **CSS.** Many rules in `styles.css` exist to out-rank a specific Obsidian selector, and several depend on file order. Read the comment above a rule before changing or moving it. Use Obsidian CSS variables, not named colors. Stylelint's `no-descending-specificity` is satisfied by keeping base rules above state rules (`:hover`, `:focus-visible`).
- **Style.** Use 4-space indentation in TypeScript and tabs in `manifest.json` and `versions.json`. Keep comments to one or two lines stating the non-obvious fact (a specificity conflict, an ordering constraint, why a value is pinned). Leave out narrative and history, and don't comment where the code already says it. Promise-returning calls from sync callbacks use `void`.

## Changelog, docs, and releases

- Russian is the source language for user-facing docs. `CHANGELOG_RU.md` leads `CHANGELOG.md`, and `README_RU.md` leads `README.md`. Write new text in Russian first, then translate it. When the two disagree, change the English to match.
- Record user-facing changes in both changelogs, under the top version heading. Use the existing sections: `### Новые функции` / `### New features`, `### Улучшения и исправления багов` / `### UI/UX enhancements and bug fixes`, and `### Прочее` / `### Other`. If the top heading matches the version in `manifest.json`, that version is already released, so start a new heading above it.
- Keep entries short, because both changelogs are shown to users inside the plugin. A feature gets a bold `**Lead-in.**` and one sentence, plus at most one more on how it works. A fix or improvement gets one line stating the user-visible effect. Leave out root causes, how a bug was fixed, edge cases, and `Note:` blocks. Released sections stay as they shipped.
- Russian text should read as natural Russian, not a word-for-word translation:
  - don't repeat a word root within one sentence
  - take Obsidian's Russian UI terms from the app itself («Палитра команд», «контекстное меню», «хранилище», «Поиск настроек»)
  - quote command and setting names exactly as they appear in `locales/ru.ts`, in «ёлочки»
  - use ё and the em dash (—)
  - a bug is «баг», never «ошибка»
- When you add or change a user-facing feature, update both `README_RU.md` and `README.md`.
- Do not commit, push, or trigger a release unless asked. Leave changes in the working tree. Do not add AI attribution (`Co-Authored-By`, "Generated with …") to commits, pull requests, or files.
- Do not bump versions or edit `manifest.json`, `package.json`, or `versions.json` unless asked to. Pushing a changed `manifest.json` version to `master` triggers an automatic GitHub release. That release fails if `manifest.json` and `package.json` disagree. Release notes are taken from the matching `## x.y.z` section of `CHANGELOG.md`.
- Commit subjects follow the existing history, for example `New feature: …`, `Fixed a bug when …`, `Linter fixes`, `Docs update`, `Release x.y.z`.

## Manual testing

The repository lives inside a vault's `.obsidian/plugins/` folder, so `npm run dev` rebuilds straight into a working plugin. Reload the plugin in Obsidian to pick up changes (turn it off and on in Community plugins, or use the "Reload app without saving" command). For run-path changes, check:

- a single note, a multi-file selection, and a folder, with the folder confirmation dialog both on and off
- whole-note runs and the "apply to selected text" setting
- a sequence that includes a deleted action
- "Revert last quick action" after each of the above
- invalid regex and very long rule text, which must fail without crashing
- the mobile layout, if you touched UI (use a narrow window or the mobile emulator: `app.emulateMobile(true)` in the dev console)
