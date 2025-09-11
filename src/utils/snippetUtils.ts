import type { Snippet } from '@/types/storage';

/**
 * Resolves snippets in a given text, handling recursion and cycle detection.
 * @param text The text to resolve snippets in.
 * @param allSnippets A list of all available snippets.
 * @param visited A set to track visited snippets for cycle detection.
 * @returns The text with all snippets resolved.
 * @throws An error if a snippet is not found or a cycle is detected.
 */
export function resolveSnippets(
  text: string,
  allSnippets: Snippet[],
  visited: Set<string> = new Set()
): string {
  const snippetRegex = /@([a-zA-Z0-9_]+)/g;

  return text.replace(snippetRegex, (_match: string, snippetName: string) => {
    if (visited.has(snippetName)) {
      throw new Error(`Snippet cycle detected: @${snippetName} is referenced within its own expansion.`);
    }

    const snippet = allSnippets.find((s) => s.name === snippetName);
    if (!snippet) {
      throw new Error(`Snippet '@${snippetName}' not found.`);
    }

    // Add the current snippet to the visited set for this resolution path
    const newVisited = new Set(visited);
    newVisited.add(snippetName);

    // Recursively resolve snippets in the content of the found snippet
    return resolveSnippets(snippet.content, allSnippets, newVisited);
  });
}
