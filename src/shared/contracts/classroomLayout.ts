/**
 * Classroom board layout endpoints (S14b, D-148). The classroom display reads the teacher's layout for
 * a class+subject while locked (classroom access, ETag); saving and resetting are teacher-area
 * actions, so they need the PIN (423 while the classroom lock is engaged, PIN-1).
 */
import { z } from 'zod';
import { ClassroomLayout } from '../classroomLayout.ts';
import { endpoint } from './define.ts';
import { Id } from './school.ts';

/** 'class' = this class+subject only, 'all' = every class+subject of the teacher. */
export const LayoutScope = z.enum(['class', 'all']);
export type LayoutScope = z.infer<typeof LayoutScope>;

export const ClassroomLayoutResponse = z.object({
  /** The teacher's stored layout that applies here, or null (the default board). Always valid. */
  layout: ClassroomLayout.nullable(),
  /** Where it comes from: this class, all classes, or nothing stored (the default). */
  source: z.enum(['class', 'all', 'default']),
});
export type ClassroomLayoutResponse = z.infer<typeof ClassroomLayoutResponse>;

export const classroomLayout = endpoint({
  method: 'GET',
  path: '/api/classroom/layout',
  access: 'classroom',
  input: z.object({ contextId: Id }),
  output: ClassroomLayoutResponse,
});

export const saveClassroomLayout = endpoint({
  method: 'PUT',
  path: '/api/teacher/classroom-layout',
  access: 'teacher',
  /** `layout` is checked with `layoutIssues` (400 VALIDATION, reason INVALID_LAYOUT). */
  input: z.object({ contextId: Id, applyTo: LayoutScope, layout: ClassroomLayout }),
  output: ClassroomLayoutResponse,
});

export const resetClassroomLayout = endpoint({
  method: 'DELETE',
  path: '/api/teacher/classroom-layout',
  access: 'teacher',
  /** 'class': forget this class's layout (the "all classes" one, or the default, applies again); 'all': forget every layout of the teacher. */
  input: z.object({ contextId: Id, applyTo: LayoutScope }),
  output: ClassroomLayoutResponse,
});
