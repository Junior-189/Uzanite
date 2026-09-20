import { v7 as uuidv7 } from 'uuid';

// Time-ordered UUIDv7 for index locality (Phase M0 decision).
export function newId(): string {
  return uuidv7();
}
