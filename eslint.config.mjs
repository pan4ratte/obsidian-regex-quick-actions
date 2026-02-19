import eslint from "@eslint/js";
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
    ],
  },
  
  // 2. Base ESLint & TS Recommended configs
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  
  // 3. Obsidian specific configuration
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      obsidianmd: obsidianmd,
    },
    // Manually apply the obsidian rules here to avoid array-nesting issues
    rules: {
      ...obsidianmd.configs.recommended.rules, 
      "obsidianmd/ui/sentence-case": "warn",
    },
  }
);