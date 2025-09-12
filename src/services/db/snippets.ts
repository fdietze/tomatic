import { z } from 'zod';
import type { Snippet } from '@/types/storage';
import { dbPromise, SNIPPETS_STORE_NAME } from '../persistence';
import { snippetSchema } from './schemas';
export async function saveSnippet(snippet: Snippet): Promise<void> {
  const db = await dbPromise;
  const now = Date.now();
  const snippetToSave: Snippet = {
    ...snippet,
    createdAt_ms: snippet.createdAt_ms || now,
    updatedAt_ms: now,
  };
  try {
    await db.put(SNIPPETS_STORE_NAME, snippetToSave);
  } catch (error) {
    console.error('[DB] Save: Failed to save snippet:', error);
    throw new Error('Failed to save snippet.');
  }
}

export async function loadAllSnippets(): Promise<Snippet[]> {
  const db = await dbPromise;
  try {
    const snippets = await db.getAll(SNIPPETS_STORE_NAME);
    // Validate each snippet
    const validation = z.array(snippetSchema).safeParse(snippets);
    if (validation.success) {
      return validation.data;
    } else {
      console.error('[DB] Load: Zod validation failed for snippets:', validation.error);
      return [];
    }
  } catch (error) {
    console.error('[DB] Load: Failed to load snippets:', error);
    throw new Error('Failed to load snippets.');
  }
}

export async function deleteSnippet(name: string): Promise<void> {
  const db = await dbPromise;
  try {
    await db.delete(SNIPPETS_STORE_NAME, name);
  } catch (error) {
    console.error(`[DB] Delete: Failed to delete snippet '${name}':`, error);
    throw new Error('Failed to delete snippet.');
  }
}

export async function saveSnippets(snippets: Snippet[]): Promise<void> {
  const db = await dbPromise;
  const tx = db.transaction(SNIPPETS_STORE_NAME, 'readwrite');
  try {
    await Promise.all(snippets.map(s => tx.store.put(s)));
    await tx.done;
  } catch (error) {
    console.error('[DB] Save: Failed to save multiple snippets:', error);
    throw new Error('Failed to save snippets.');
  }
}