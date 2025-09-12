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


/**
 * Extracts the names of snippets referenced in a given text.
 * @param text The text to scan.
 * @returns A Set of snippet names found in the text.
 */
export function getReferencedSnippetNames(text: string): Set<string> {
  const snippetRegex = /@([a-zA-Z0-9_]+)/g;
  const matches = text.match(snippetRegex);
  if (!matches) return new Set();
  return new Set(matches.map(match => match.substring(1)));
}

/**
 * Builds a reverse dependency graph from a list of snippets.
 * The graph maps each snippet name to a list of snippets that depend on it.
 * @param allSnippets A list of all available snippets.
 * @returns A map representing the reverse dependency graph.
 */
export function buildReverseDependencyGraph(allSnippets: Snippet[]): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  const snippetNames = new Set(allSnippets.map(s => s.name));

  // Initialize the graph with all snippet names
  for (const name of snippetNames) {
    graph.set(name, []);
  }

  for (const snippet of allSnippets) {
    const textToScan = snippet.isGenerated ? snippet.prompt || '' : snippet.content;
    const dependencies = getReferencedSnippetNames(textToScan);
    for (const depName of dependencies) {
      if (graph.has(depName)) {
        graph.get(depName)?.push(snippet.name);
      }
    }
  }
  return graph;
}

/**
 * Finds all direct and transitive dependents of a given snippet.
 * @param name The name of the snippet to start the search from.
 * @param reverseGraph A reverse dependency graph.
 * @returns A Set of names of all dependent snippets.
 */
export function findTransitiveDependents(name: string, reverseGraph: Map<string, string[]>): Set<string> {
  const dependents = new Set<string>();
  const queue: string[] = [name];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const currentName = queue.shift();
    if (!currentName || visited.has(currentName)) continue;
    visited.add(currentName);

    const directDependents = reverseGraph.get(currentName) || [];
    for (const dependentName of directDependents) {
      if (!dependents.has(dependentName)) {
        dependents.add(dependentName);
        queue.push(dependentName);
      }
    }
  }
  return dependents;
}

/**
 * Performs a topological sort on a list of snippets based on their dependencies.
 * If a cycle is detected, it returns the sorted list of non-cyclic snippets and the names of snippets involved in cycles.
 * @param allSnippets The list of all snippets to sort.
 * @returns An object containing the sorted snippets and any snippets found in cycles.
 */
export function topologicalSort(allSnippets: Snippet[]): { sorted: Snippet[], cyclic: string[] } {
  const inDegree = new Map<string, number>();
  const graph = new Map<string, string[]>(); // Adjacency list: dependency -> dependent
  const snippetMap = new Map(allSnippets.map(s => [s.name, s]));

  for (const snippet of allSnippets) {
    inDegree.set(snippet.name, 0);
    graph.set(snippet.name, []);
  }

  for (const snippet of allSnippets) {
    const textToScan = snippet.isGenerated ? snippet.prompt || '' : snippet.content;
    const dependencies = getReferencedSnippetNames(textToScan);
    graph.set(snippet.name, Array.from(dependencies));
    for (const depName of dependencies) {
      if (snippetMap.has(depName)) {
        inDegree.set(snippet.name, (inDegree.get(snippet.name) || 0) + 1);
      }
    }
  }
    
  // Kahn's algorithm
  const queue: string[] = [];
  for (const [name, degree] of inDegree.entries()) {
    if (degree === 0) {
      queue.push(name);
    }
  }

  const sorted: Snippet[] = [];
  const reverseGraph = buildReverseDependencyGraph(allSnippets); // dependency -> dependents

  while (queue.length > 0) {
    const name = queue.shift();
    if (!name) continue;
    
    const snippet = snippetMap.get(name);
    if (snippet) {
      sorted.push(snippet);
    }

    const dependents = reverseGraph.get(name) || [];
    for (const dependentName of dependents) {
      const currentDegree = (inDegree.get(dependentName) || 0) - 1;
      inDegree.set(dependentName, currentDegree);
      if (currentDegree === 0) {
        queue.push(dependentName);
      }
    }
  }

  const cyclic: string[] = [];
  if (sorted.length !== allSnippets.length) {
    for (const [name, degree] of inDegree.entries()) {
      if (degree > 0) {
        cyclic.push(name);
      }
    }
  }

  return { sorted, cyclic };
}
