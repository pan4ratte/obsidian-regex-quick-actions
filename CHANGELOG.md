# Changelog

## 2.0.0

### New features

* **Action sequences.** Named chains of quick actions that run one after another. Build one with the "New action sequence" button in the settings, where the steps could be reordered. Every sequence becomes its own command palette entry and appears in the same context menus as quick actions.
* **Quick actions on selected text.** Enable new "Apply quick actions to selected text" setting to apply actions only to the current selection, and the rewritten fragment stays selected so several actions can be chained on it.
* **Backup and restore.** Quick actions and action sequences can now be exported and imported. Export available on desktop only, as the mobile app cannot save files this way.
* **Revert the last quick action.** Use the new "Revert last quick action" palette command to undoe the most recent run, including runs over several files or over a whole folder.

### UI/UX enhancements and bug fixes

* Quick actions and action sequences are now kept in two tabs of the settings, each with its own item count and its own button for creating an entry.
* Several mobile optimizations.
* Files that a quick action leaves unchanged are no longer written back to disk, so a folder-wide run no longer updates the modification time of every note in it.
* Fixed a bug where the replacement notification counted every match, including matches replaced with identical text, and so reported more replacements than were actually made.

### Other

* Declarative settings. The plugin settings were migrated to the declarative Obsidian 1.13.0 API — they are now discoverable through the settings search.
* New minimum Obsidian version. The minimum Obsidian version was raised to 1.13.0. Users on older versions still get plugin version 1.4.2.


## 1.4.2

### UI/UX enhancements and bug fixes

* Stability and security updates, no new features were added.


## 1.4.1

### UI/UX enhancements and bug fixes

* Minor fixes and updates of documentation, descriptions and locales for the Obsidian plugin review process.


## 1.4.0

### New features

* **Quick actions on several files.** A quick action can now be run on any number of selected files.
* **Quick actions in the context menus.** Any quick action, not only the default one, can now be run from the context menus.
* **Obsidian Bases.** Bases are now supported.

### UI/UX enhancements and bug fixes

* Fixed a bug where not all replacements were counted correctly.
* Fixed a bug where the replacement notification was not always displayed.
* Refactored the internal plugin structure.


## 1.3.0

### Major update: user data storage

* **Rulesets moved to `data.json`.** Previously rulesets were stored in the `/regex-rulesets` folder inside your vault. Now all user data is stored in `data.json`, which ensures a less intrusive plugin attitude. On update the migration is automatic: the plugin will transfer your user data to `data.json` and delete the `/regex-rulesets` folder. If deletion did not happen, you can do that manually.


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
