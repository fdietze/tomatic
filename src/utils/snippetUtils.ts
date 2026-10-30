import type { Snippet } from '@/types/storage';

/**
 * req:no-template-evaluation: `@name` is the only reference syntax. Everything else,
 * including `$`, `${...}` and backticks, is plain text (users paste arbitrary text).
 */
const SNIPPET_REFERENCE_PATTERN = /@([a-zA-Z0-9_]+)/g;

/**
 * req:snippet-id-vs-name, req:snippet-error-propagation, req:cycle-detection, req:no-template-evaluation
 * Replaces every `@name` reference in `text` with the snippet's content.
 *
 * Standard snippet content is resolved recursively; generated snippet content is
 * model output and inserted literally. Only snippets reachable from `text` are
 * touched, so a broken snippet elsewhere cannot break this text.
 *
 * @throws An error if a referenced snippet does not exist or a reference cycle is found.
 */
export function resolveSnippetReferences(text: string, allSnippets: Snippet[]): string {
  const snippetsByName = new Map(allSnippets.map((s) => [s.name, s]));

  const resolve = (currentText: string, path: string[]): string =>
    substituteSnippetReferences(currentText, (name) => {
      if (path.includes(name)) {
        const cyclePath = [...path, name].map((n) => `@${n}`).join(' -> ');
        throw new Error(`Snippet cycle detected: ${cyclePath}`);
      }
      const snippet = snippetsByName.get(name);
      if (!snippet) {
        throw new Error(`Snippet '@${name}' not found.`);
      }
      return snippet.isGenerated ? snippet.content : resolve(snippet.content, [...path, name]);
    });

  return resolve(text, []);
}

/**
 * req:no-template-evaluation
 * Replaces each `@name` in `text` with `lookup(name)`. Pure string substitution:
 * a replacer function is used so `$&`, `$1` etc. in the inserted content stay literal.
 */
export function substituteSnippetReferences(text: string, lookup: (name: string) => string): string {
  return text.replace(SNIPPET_REFERENCE_PATTERN, (_match, name: string) => lookup(name));
}

/**
 * Finds all snippet references (e.g., "@name") in a given text.
 * @param text The text to search.
 * @returns An array of snippet names, without the "@" prefix.
 */
export function findSnippetReferences(text: string): string[] {
  return Array.from(getReferencedSnippetNames(text));
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
  const referencedNames = getReferencedSnippetNames(text);
  if (referencedNames.size === 0) {
    return;
  }

  for (const snippetName of referencedNames) {
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
  const referencedNames = getReferencedSnippetNames(text);
  const existingNames = new Set(allSnippets.map(s => s.name));
  return [...referencedNames].filter(name => !existingNames.has(name));
}


/**
 * Extracts the names of snippets referenced in a given text.
 * @param text The text to scan.
 * @returns A Set of snippet names found in the text.
 */
export function getReferencedSnippetNames(text: string): Set<string> {
  const names = new Set<string>();
  for (const [, name] of text.matchAll(SNIPPET_REFERENCE_PATTERN)) {
    if (name) names.add(name);
  }
  return names;
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
  snippetNames.forEach(name => graph.set(name, []));

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
export function getTopologicalSortForExecution(allSnippets: Snippet[]): { sorted: Snippet[], cyclic: string[] } {
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

/**
 * Performs a topological sort on a list of snippets for display purposes.
 * It always returns all snippets. Acyclic snippets are topologically sorted.
 * Cyclic snippets are appended at the end in a stable order.
 * @param allSnippets The list of all snippets to sort.
 * @returns An object containing the sorted snippets and the names of snippets found in cycles.
 */
export function getSnippetDisplayOrder(allSnippets: Snippet[]): { sorted: Snippet[], cyclic: string[] } {
  const { sorted: acyclicSorted, cyclic } = getTopologicalSortForExecution(allSnippets);
  
  if (cyclic.length === 0) {
    return { sorted: acyclicSorted, cyclic: [] };
  }

  const acyclicNames = new Set(acyclicSorted.map(s => s.name));
  const cyclicSnippets: Snippet[] = [];

  for (const snippet of allSnippets) {
    if (!acyclicNames.has(snippet.name)) {
      cyclicSnippets.push(snippet);
    }
  }

  // Sort cyclic snippets alphabetically for a stable order
  cyclicSnippets.sort((a, b) => a.name.localeCompare(b.name));

  return { sorted: [...acyclicSorted, ...cyclicSnippets], cyclic };
}

/**
 * Groups snippets into "waves" based on their dependency levels.
 * Each wave contains snippets that can be processed in parallel.
 * A wave can only start after all previous waves have completed.
 *
 * This uses a level-by-level topological sort approach (Kahn's algorithm with levels).
 *
 * @param snippets The list of snippets to organize into waves
 * @returns An array of waves, where each wave is an array of snippets that can run in parallel
 */
export function groupSnippetsIntoWaves(
  snippets: Snippet[]
): Snippet[][] {
  if (snippets.length === 0) {
    return [];
  }

  const inDegree = new Map<string, number>();
  const graph = new Map<string, string[]>(); // Adjacency list: dependency -> dependents
  const snippetMap = new Map(snippets.map(s => [s.name, s]));

  // Initialize in-degree and graph
  for (const snippet of snippets) {
    inDegree.set(snippet.name, 0);
    graph.set(snippet.name, []);
  }

  // Build the graph and calculate in-degrees
  for (const snippet of snippets) {
    const textToScan = snippet.isGenerated ? snippet.prompt || '' : snippet.content;
    const dependencies = getReferencedSnippetNames(textToScan);
    
    for (const depName of dependencies) {
      if (snippetMap.has(depName)) {
        // snippet depends on depName, so increment snippet's in-degree
        inDegree.set(snippet.name, (inDegree.get(snippet.name) || 0) + 1);
        // Add snippet as a dependent of depName
        const dependents = graph.get(depName) || [];
        dependents.push(snippet.name);
        graph.set(depName, dependents);
      }
    }
  }

  const waves: Snippet[][] = [];
  const processed = new Set<string>();

  // Process snippets level by level
  while (processed.size < snippets.length) {
    const currentWave: Snippet[] = [];
    
    // Find all snippets with in-degree 0 that haven't been processed
    for (const [name, degree] of inDegree.entries()) {
      if (degree === 0 && !processed.has(name)) {
        const snippet = snippetMap.get(name);
        if (snippet) {
          currentWave.push(snippet);
        }
      }
    }

    // If no snippets can be processed, we have a cycle
    if (currentWave.length === 0) {
      // Remaining snippets are cyclic, we should not process them
      break;
    }

    waves.push(currentWave);

    // Mark current wave as processed and update in-degrees
    for (const snippet of currentWave) {
      processed.add(snippet.name);
      
      // Reduce in-degree for all dependents
      const dependents = graph.get(snippet.name) || [];
      for (const dependentName of dependents) {
        const currentDegree = inDegree.get(dependentName) || 0;
        inDegree.set(dependentName, currentDegree - 1);
      }
    }
  }

  return waves;
}


