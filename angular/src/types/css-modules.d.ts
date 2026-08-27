/**
 * Ambient declaration for side-effect CSS imports inside TypeScript
 * components. Used by lazy-loaded surfaces that pull in a third-party
 * stylesheet next to a dynamic JS import. The Angular CLI esbuild
 * pipeline turns the import into a runtime `<link>` injection on
 * first use.
 */
declare module '*.css';
