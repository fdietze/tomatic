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
  console.log(`[resolveSnippets] text: "${text}", path: [${path.join(' -> ')}], available snippets:`, allSnippets.map(s => s.name));
  const snippetRegex = /@([a-zA-Z0-9_]+)/g;

  return text.replace(snippetRegex, (_match: string, snippetName: string) => {
    console.log(`[resolveSnippets] Found reference to @${snippetName}`);
    if (path.includes(snippetName)) {
      const cyclePath = [...path, snippetName].map((name) => `@${name}`).join(' -> ');
      console.error(`[resolveSnippets] Cycle detected: ${cyclePath}`);
      throw new Error(`Snippet cycle detected: ${cyclePath}`);
    }

    const snippet = allSnippets.find((s) => s.name === snippetName);
    if (!snippet) {
      console.error(`[resolveSnippets] Snippet not found: @${snippetName}`);
      throw new Error(`Snippet '@${snippetName}' not found.`);
    }
    console.log(`[resolveSnippets] Found snippet @${snippetName} with content: "${snippet.content}"`);

    // Add the current snippet to the visited set for this resolution path
    const newPath = [...path, snippetName];

    // Recursively resolve snippets in the content of the found snippet
    const resolvedContent = resolveSnippets(snippet.content, allSnippets, newPath);
    console.log(`[resolveSnippets] Resolved content for @${snippetName} is: "${resolvedContent}"`);
    return resolvedContent;
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
  console.log(`[validateSnippetDependencies] text: "${text}", path: [${path.join(' -> ')}], available snippets:`, allSnippets.map(s => s.name));
  const snippetRegex = /@([a-zA-Z0-9_]+)/g;

  // Use matchAll to avoid issues with regex state
  const matches = [...text.matchAll(snippetRegex)];
  if (matches.length === 0) {
    console.log(`[validateSnippetDependencies] No snippet references found in "${text}".`);
    return;
  }

  for (const match of matches) {
    const snippetName = match[1]; // Group 1 is the name
    console.log(`[validateSnippetDependencies] Found reference to @${snippetName}`);

    if (path.includes(snippetName)) {
      const cyclePath = [...path, snippetName].map((name) => `@${name}`).join(' -> ');
      console.error(`[validateSnippetDependencies] Cycle detected: ${cyclePath}`);
      throw new Error(`Snippet cycle detected: ${cyclePath}`);
    }

    const snippet = allSnippets.find((s) => s.name === snippetName);
    if (!snippet) {
      console.log(`[validateSnippetDependencies] Snippet @${snippetName} not found, skipping validation for this branch.`);
      continue; // Non-existent snippets are handled as warnings in the UI, not cycle errors.
    }
    console.log(`[validateSnippetDependencies] Found snippet @${snippetName}. isGenerated: ${String(snippet.isGenerated)}. Snippet object:`, JSON.parse(JSON.stringify(snippet)));

    const newPath = [...path, snippetName];
    // Recurse into the prompt for generated snippets, or the content for standard ones.
    const nextTextToValidate = snippet.isGenerated ? snippet.prompt : snippet.content;
    console.log(`[validateSnippetDependencies] Next text to validate for @${snippetName}: "${nextTextToValidate ?? ''}"`);

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
  console.log(`[findNonExistentSnippets] text: "${text}", available snippets:`, allSnippets.map(s => s.name));
  const snippetRegex = /@([a-zA-Z0-9_]+)/g;
  const matches = text.match(snippetRegex);
  if (!matches) {
    console.log('[findNonExistentSnippets] No matches found.');
    return [];
  }
  const referencedNames = matches.map(match => match.substring(1));
  const existingNames = new Set(allSnippets.map(s => s.name));
  
  // Use a Set to get unique non-existent names
  const nonExistent = new Set<string>();
  for (const name of referencedNames) {
    if (!existingNames.has(name)) {
      nonExistent.add(name);
    }
  }

  const result = [...nonExistent];
  console.log(`[findNonExistentSnippets] Non-existent snippets found:`, result);
  return result;
}


/**
 * Extracts the names of snippets referenced in a given text.
 * @param text The text to scan.
 * @returns A Set of snippet names found in the text.
 */
export function getReferencedSnippetNames(text: string): Set<string> {
  console.log(`[getReferencedSnippetNames] text: "${text}"`);
  if (!text) return new Set();
  const snippetRegex = /@([a-zA-Z0-9_]+)/g;
  const matches = text.match(snippetRegex);
  if (!matches) {
    console.log('[getReferencedSnippetNames] No matches found.');
    return new Set();
  }
  const result = new Set(matches.map(match => match.substring(1)));
  console.log(`[getReferencedSnippetNames] Found names:`, result);
  return result;
}

/**
 * Builds a reverse dependency graph from a list of snippets.
 * The graph maps each snippet name to a list of snippets that depend on it.
 * @param allSnippets A list of all available snippets.
 * @returns A map representing the reverse dependency graph.
 */
export function buildReverseDependencyGraph(allSnippets: Snippet[]): Map<string, string[]> {
  console.log(`[buildReverseDependencyGraph] Building graph for snippets:`, allSnippets.map(s => s.name));
  const graph = new Map<string, string[]>();
  const snippetNames = new Set(allSnippets.map(s => s.name));

  // Initialize the graph with all snippet names
  snippetNames.forEach(name => graph.set(name, []));

  for (const snippet of allSnippets) {
    const textToScan = snippet.isGenerated ? snippet.prompt || '' : snippet.content;
    const dependencies = getReferencedSnippetNames(textToScan);
    console.log(`[buildReverseDependencyGraph] Snippet @${snippet.name} has dependencies:`, dependencies);
    for (const depName of dependencies) {
      if (graph.has(depName)) {
        graph.get(depName)?.push(snippet.name);
      }
    }
  }
  console.log(`[buildReverseDependencyGraph] Final graph:`, graph);
  return graph;
}

/**
 * Finds all direct and transitive dependents of a given snippet.
 * @param name The name of the snippet to start the search from.
 * @param reverseGraph A reverse dependency graph.
 * @returns A Set of names of all dependent snippets.
 */
export function findTransitiveDependents(name: string, reverseGraph: Map<string, string[]>): Set<string> {
  console.log(`[findTransitiveDependents] Finding dependents for @${name}`);
  const dependents = new Set<string>();
  const queue: string[] = [name];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const currentName = queue.shift();
    if (!currentName || visited.has(currentName)) continue;
    visited.add(currentName);
    console.log(`[findTransitiveDependents] Visiting @${currentName}`);

    const directDependents = reverseGraph.get(currentName) || [];
    for (const dependentName of directDependents) {
      if (!dependents.has(dependentName)) {
        dependents.add(dependentName);
        queue.push(dependentName);
      }
    }
  }
  console.log(`[findTransitiveDependents] Found dependents for @${name}:`, dependents);
  return dependents;
}

/**
 * Performs a topological sort on a list of snippets based on their dependencies.
 * If a cycle is detected, it returns the sorted list of non-cyclic snippets and the names of snippets involved in cycles.
 * @param allSnippets The list of all snippets to sort.
 * @returns An object containing the sorted snippets and any snippets found in cycles.
 */
export function topologicalSort(allSnippets: Snippet[]): { sorted: Snippet[], cyclic: string[] } {
  console.log('[topologicalSort] ===== START Topological Sort =====');
  console.log('[topologicalSort] Input snippets:', allSnippets.map(s => ({name: s.name, prompt: s.prompt, content: s.content, isGenerated: s.isGenerated})));
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
  console.log('[topologicalSort] In-degree map:', inDegree);
    
  // Kahn's algorithm
  const queue: string[] = [];
  for (const [name, degree] of inDegree.entries()) {
    if (degree === 0) {
      queue.push(name);
    }
  }
  console.log('[topologicalSort] Initial queue (in-degree 0):', queue);

  const sorted: Snippet[] = [];
  const reverseGraph = buildReverseDependencyGraph(allSnippets); // dependency -> dependents
  console.log('[topologicalSort] Reverse dependency graph:', reverseGraph);

  while (queue.length > 0) {
    const name = queue.shift();
    console.log(`[topologicalSort] Dequeueing: @${name ?? ''}`);
    if (!name) continue;
    
    const snippet = snippetMap.get(name);
    if (snippet) {
      sorted.push(snippet);
    }

    const dependents = reverseGraph.get(name) || [];
    console.log(`[topologicalSort] Dependents of @${name}:`, dependents);
    for (const dependentName of dependents) {
      const currentDegree = (inDegree.get(dependentName) || 0) - 1;
      console.log(`[topologicalSort] Decrementing in-degree of @${dependentName} to ${String(currentDegree)}`);
      inDegree.set(dependentName, currentDegree);
      if (currentDegree === 0) {
        console.log(`[topologicalSort] Enqueueing @${dependentName}`);
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

  if (cyclic.length > 0) {
    console.warn(`[topologicalSort] Cycles detected involving: ${cyclic.join(', ')}`);
  }
  console.log('[topologicalSort] Final sorted list:', sorted.map(s => s.name));
  console.log('[topologicalSort] Final cyclic list:', cyclic);
  console.log('[topologicalSort] ===== END Topological Sort =====');
  return { sorted, cyclic };
}
