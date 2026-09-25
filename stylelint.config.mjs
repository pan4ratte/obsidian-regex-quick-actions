// The official Obsidian CSS ruleset that the community plugin review runs over styles.css.
/** @type {import("stylelint").Config} */
export default {
  extends: ["stylelint-config-obsidianmd"],
  rules: {
    // The review scanner checks against Electron 39 (Obsidian 1.11.4), older than the
    // preset's target. Options restate the preset's, as they replace rather than merge.
    "plugin/no-unsupported-browser-features": [
      true,
      {
        severity: "warning",
        browsers: ["electron >= 39"],
        ignore: ["css-nesting", "css-cascade-layers"],
      },
    ],
  },
};
