// Markdown imports are plain strings; see rollup.config.js.
declare module '*.md' {
    const content: string;
    export default content;
}
