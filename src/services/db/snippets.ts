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
  } catch {
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
      console.log('[DB|loadAllSnippets] Zod validation failed for snippets:', JSON.stringify(validation.error, null, 2));
      return [];
    }
  } catch {
    throw new Error('Failed to load snippets.');
  }
}

export async function deleteSnippet(name: string): Promise<void> {
  const db = await dbPromise;
  try {
    await db.delete(SNIPPETS_STORE_NAME, name);
  } catch {
    throw new Error('Failed to delete snippet.');
  }
}

export async function saveSnippets(snippets: Snippet[]): Promise<void> {
  const db = await dbPromise;
  const tx = db.transaction(SNIPPETS_STORE_NAME, 'readwrite');
  try {
    const putPromises = snippets.map(s => {
      return tx.store.put(s);
    });
    await Promise.all(putPromises);
    await tx.done;
  } catch {
    throw new Error('Failed to save snippets.');
  }
}