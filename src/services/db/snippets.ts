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
    console.debug(`[DB|saveSnippet] Attempting to save snippet: @${snippetToSave.name}, content: "${snippetToSave.content}"`);
    const tx = db.transaction(SNIPPETS_STORE_NAME, 'readwrite');
    await tx.store.put(snippetToSave);
    await tx.done;
    console.debug(`[DB|saveSnippet] Successfully saved snippet: @${snippetToSave.name}`);
  } catch(e) {
    console.error('[DB|saveSnippet] Failed to save snippet:', e);
    throw new Error('Failed to save snippet.');
  }
}

export async function loadAllSnippets(): Promise<Snippet[]> {
  const db = await dbPromise;
  try {
    const snippets = await db.getAll(SNIPPETS_STORE_NAME);
    console.debug('[DB|loadAllSnippets] Loaded snippets from DB:', JSON.stringify(snippets.map(s => ({ name: s.name, content: s.content }))));
    // Validate each snippet
    const validation = z.array(snippetSchema).safeParse(snippets);
    if (validation.success) {
      return validation.data;
    } else {
      return [];
    }
  } catch {
    throw new Error('Failed to load snippets.');
  }
}

export async function deleteSnippet(name: string): Promise<void> {
  const db = await dbPromise;
  try {
    const tx = db.transaction(SNIPPETS_STORE_NAME, 'readwrite');
    await tx.store.delete(name);
    await tx.done;
  } catch(e) {
    console.error('[DB|deleteSnippet] Failed to delete snippet:', e);
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