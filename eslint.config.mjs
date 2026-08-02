import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["main.js", "node_modules/**", "dist/**"]),

  // Official Obsidian plugin guidelines ruleset. The `WithLocalesEn` variant adds
  // the sentence-case check for `locales/en.ts`, where the UI text lives.
  obsidianmd.configs.recommendedWithLocalesEn,

  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["error", { args: "none" }],

      // The plugin's own name keeps its capitals. Passing `brands` replaces the
      // rule's default list, so "Obsidian" has to be named here to stay capitalised.
      "obsidianmd/ui/sentence-case": [
        "warn",
        { brands: ["Regex Quick Actions", "Obsidian"] },
      ],
      "obsidianmd/ui/sentence-case-locale-module": [
        "warn",
        { brands: ["Regex Quick Actions", "Obsidian"] },
      ],
    },
  },

  // Build tooling runs in Node, outside the plugin sandbox.
  {
    files: ["*.mjs", "*.js"],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      "obsidianmd/no-nodejs-modules": "off",
    },
  },
]);
