# Changelog

## 2.1.0

### New features

* Quick actions can now be applied to selected text only. The new "Apply quick actions to selected text" setting is off by default; with it on, actions run from the command palette, a hotkey or the note context menu affect only the current selection, and the rewritten fragment stays selected so several actions can be chained on it.
* The new "Revert last quick action" palette command undoes the most recent run, including runs over several files or over a whole folder. Files edited after the run are skipped instead of being overwritten. The undo data lives in memory only and is lost on restart, and only the latest run can be reverted.

### UI/UX enhancements and bug fixes

* Files that a quick action leaves unchanged are no longer written back to disk, so a folder-wide run no longer updates the modification time of every note in it.


## 2.0.0

### Major update: Obsidian 1.13 settings

* The plugin settings were migrated to the declarative Obsidian 1.13.0 API — they are now discoverable through the settings search.
* The minimum Obsidian version was raised to 1.13.0. Users on older versions still get plugin version 1.4.2.

### UI/UX enhancements and bug fixes

* Fixed a bug where the replacement notification counted every match, including matches replaced with identical text, and so reported more replacements than were actually made.


## 1.4.2

### UI/UX enhancements and bug fixes

* Stability and security updates, no new features were added.


## 1.4.1

### UI/UX enhancements and bug fixes

* Minor fixes and updates of documentation, descriptions and locales for the Obsidian plugin review process.


## 1.4.0

### New features

* Quick actions can now be run on any number of selected files.
* Any quick action can now be run from the context menus.
* Obsidian Bases are now supported.

### UI/UX enhancements and bug fixes

* Fixed a bug where not all replacements were counted correctly.
* Fixed a bug where the replacement notification was not always displayed.
* Refactored the internal plugin structure.


## 1.3.0

### Major update: user data storage

* User data storage method update: previously rulesets were stored in the `/regex-rulesets` folder inside your vault. Now all user data is stored in `data.json`, which ensures a less intrusive plugin attitude. On update the migration is automatic: the plugin will transfer your user data to `data.json` and delete the `/regex-rulesets` folder. If deletion did not happen, you can do that manually.


## 1.2.0

### UI/UX enhancements and bug fixes

* Added Russian translation.
* README is now also available in Russian.
* Code optimizations for the Obsidian community plugins review process.
* Some UI text corrections and minor UI enhancements.


## 1.0.1

### UI/UX enhancements and bug fixes

* Several UI/UX enhancements and UI text corrections.


## 1.0.0

### Initial release

* Initial release. Check the README for the full list of features.
