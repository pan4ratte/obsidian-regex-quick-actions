import tsparser from "@typescript-eslint/parser";
import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // 1. Global Ignores first
  {
    ignores: [
      "main.js",
      "node_modules/",
      ".obsidian/",
      "dist/",
      "rollup.config.js",
      "eslint.config.mjs",
      "package.json",
    ],
  },

  // 2. Obsidian recommended (includes eslint + typescript-eslint + obsidianmd rules)
  ...obsidianmd.configs.recommended,

  // 3. TypeScript parser with project settings for type-aware rules, plus local overrides
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "obsidianmd/ui/sentence-case": "warn",
    },
  }
);
