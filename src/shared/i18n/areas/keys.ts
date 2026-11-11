/**
 * The keys of every area dictionary (S19a, D-179), as a type only: `MessageKey` includes them, but no
 * area's strings are bundled until a screen imports the area file itself. Add one line per area.
 */
export type AreaMessageKey = keyof typeof import('./aiConnections.ts').en;
