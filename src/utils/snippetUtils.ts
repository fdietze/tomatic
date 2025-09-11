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
  path: string[] = []
): string {
  const snippetRegex = /@([a-zA-Z0-9_]+)/g;

  return text.replace(snippetRegex, (_match: string, snippetName: string) => {
    if (path.includes(snippetName)) {
      const cyclePath = [...path, snippetName].map((name) => `@${name}`).join(' -> ');
      throw new Error(`Snippet cycle detected: ${cyclePath}`);
    }

    const snippet = allSnippets.find((s) => s.name === snippetName);
    if (!snippet) {
      throw new Error(`Snippet '@${snippetName}' not found.`);
    }

    // Add the current snippet to the visited set for this resolution path
    const newPath = [...path, snippetName];

    // Recursively resolve snippets in the content of the found snippet
    return resolveSnippets(snippet.content, allSnippets, newPath);
  });
}


/**
 * Validates snippet dependencies for cycles, throwing an error if one is found.
 * It traces through the `prompt` of generated snippets and the `content` of standard snippets.
 * @param text The text (prompt or content) to start validation from.
 * @param allSnippets A list of all available snippets.
 * @param path The current resolution path for cycle detection.
 */
export function validateSnippetDependencies(
  text: string,
  allSnippets: Snippet[],
  path: string[] = []
): void {
  const snippetRegex = /@([a-zA-Z0-9_]+)/g;

  const matches = text.match(snippetRegex);
  if (!matches) return;

  for (const match of matches) {
    const snippetName = match.substring(1); // Remove '@'

    if (path.includes(snippetName)) {
      const cyclePath = [...path, snippetName].map((name) => `@${name}`).join(' -> ');
      throw new Error(`Snippet cycle detected: ${cyclePath}`);
    }

    const snippet = allSnippets.find((s) => s.name === snippetName);
    if (!snippet) {
      continue; // Non-existent snippets are handled as warnings in the UI, not cycle errors.
    }

    const newPath = [...path, snippetName];
    // Recurse into the prompt for generated snippets, or the content for standard ones.
    const nextTextToValidate = snippet.isGenerated ? snippet.prompt : snippet.content;

    if (nextTextToValidate) {
      validateSnippetDependencies(nextTextToValidate, allSnippets, newPath);
    }
  }
}

/**
 * Finds all referenced snippets in a text that do not exist in the provided list.
 * @param text The text to scan for snippet references.
 * @param allSnippets A list of all available snippets.
 * @returns An array of the names of non-existent snippets.
 */
export function findNonExistentSnippets(text: string, allSnippets: Snippet[]): string[] {
  const snippetRegex = /@([a-zA-Z0-9_]+)/g;
  const matches = text.match(snippetRegex);
  if (!matches) return [];

  const referencedNames = matches.map(match => match.substring(1));
  const existingNames = new Set(allSnippets.map(s => s.name));
  
  // Use a Set to get unique non-existent names
  const nonExistent = new Set<string>();
  for (const name of referencedNames) {
    if (!existingNames.has(name)) {
      nonExistent.add(name);
    }
  }

  return [...nonExistent];
}
