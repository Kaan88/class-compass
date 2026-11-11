/**
 * The keys of every area dictionary (S19a, D-179), as a type only: `MessageKey` includes them, but no
 * area's strings are bundled until a screen imports the area file itself. Add one line per area.
 */
export type AreaMessageKey =
  | keyof typeof import('./staff.ts').en
  | keyof typeof import('./aiConnections.ts').en
  | keyof typeof import('./aiConnect.ts').en
  | keyof typeof import('./assistantChat.ts').en
  | keyof typeof import('./classroomCards.ts').en
  | keyof typeof import('./classroomDock.ts').en;
