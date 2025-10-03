import { describe, it, expect } from 'vitest';
import { resolveSnippetsWithTemplates, validateSnippetDependencies, findNonExistentSnippets, getReferencedSnippetNames, buildReverseDependencyGraph, findTransitiveDependents, getSnippetDisplayOrder, getTopologicalSortForExecution, groupSnippetsIntoWaves } from '@/utils/snippetUtils';
import type { Snippet } from '@/types/storage';

const createSnippet = (overrides: Partial<Snippet> & { name: string }): Snippet => ({
  id: `test-id-${overrides.name}`,
  content: '',
  isGenerated: false,
  prompt: '',
  createdAt_ms: 0,
  updatedAt_ms: 0,
  generationError: null,
  isDirty: false,
  ...overrides,
});


describe('resolveSnippetsWithTemplates', () => {
  it('should resolve a simple template expression', async () => {
    const text = 'Result: ${1 + 1}';
    const allSnippets: Snippet[] = [];
    const expected = 'Result: 2';
    await expect(resolveSnippetsWithTemplates(text, allSnippets)).resolves.toBe(expected);
  });

  it('should handle async operations in templates', async () => {
    const text = 'Data: ${await fetchData()}';
    const allSnippets: Snippet[] = [];
    // Mock a global async function for the test
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).fetchData = async () => 'async data';
    const expected = 'Data: async data';
    await expect(resolveSnippetsWithTemplates(text, allSnippets)).resolves.toBe(expected);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (global as any).fetchData;
  });

  it('should resolve snippets as variables in the template', async () => {
    const text = 'Message: ${greet}';
    const allSnippets: Snippet[] = [createSnippet({ name: 'greet', content: 'Hello, World!' })];
    const expected = 'Message: Hello, World!';
    await expect(resolveSnippetsWithTemplates(text, allSnippets)).resolves.toBe(expected);
  });

  it('should handle backward compatibility with @-syntax', async () => {
    const text = 'Message: @greet';
    const allSnippets: Snippet[] = [createSnippet({ name: 'greet', content: 'Hello, World!' })];
    const expected = 'Message: Hello, World!';
    await expect(resolveSnippetsWithTemplates(text, allSnippets)).resolves.toBe(expected);
  });

  it('should recursively resolve templates', async () => {
    const text = 'Final: @a';
    const allSnippets: Snippet[] = [
      createSnippet({ name: 'a', content: 'Nested ${b}' }),
      createSnippet({ name: 'b', content: 'Success' }),
    ];
    const expected = 'Final: Nested Success';
    await expect(resolveSnippetsWithTemplates(text, allSnippets)).resolves.toBe(expected);
  });

  it('should throw a "not found" error for an undefined variable that is not a snippet', async () => {
    const text = 'Result: ${undefinedVariable}';
    const allSnippets: Snippet[] = [];
    await expect(resolveSnippetsWithTemplates(text, allSnippets)).rejects.toThrow("Snippet '@undefinedVariable' not found.");
  });

  it('should throw a cycle detection error for direct cycles', async () => {
    const text = '@a';
    const allSnippets: Snippet[] = [
      createSnippet({ name: 'a', content: 'Cycle @a' }),
    ];
    await expect(resolveSnippetsWithTemplates(text, allSnippets)).rejects.toThrow('Snippet cycle detected: @a -> @a');
  });

  it('should throw a cycle detection error for indirect cycles', async () => {
    const text = '@a';
    const allSnippets: Snippet[] = [
      createSnippet({ name: 'a', content: 'Cycle @b' }),
      createSnippet({ name: 'b', content: 'Back to @a' }),
    ];
    await expect(resolveSnippetsWithTemplates(text, allSnippets)).rejects.toThrow('Snippet cycle detected: @a -> @b -> @a');
  });

  it('should handle a mix of @ and ${} syntax', async () => {
    const text = 'Mix: @a and ${b}';
    const allSnippets: Snippet[] = [
      createSnippet({ name: 'a', content: 'A' }),
      createSnippet({ name: 'b', content: 'B' }),
    ];
    const expected = 'Mix: A and B';
    await expect(resolveSnippetsWithTemplates(text, allSnippets)).resolves.toBe(expected);
  });

  it('should resolve a single, non-nested snippet', async () => {
    const text = 'This contains @a.';
    const allSnippets: Snippet[] = [createSnippet({ name: 'a', content: 'a snippet' })];
    const expected = 'This contains a snippet.';
    await expect(resolveSnippetsWithTemplates(text, allSnippets)).resolves.toBe(expected);
  });

  it('should recursively resolve a snippet that contains another snippet', async () => {
    const text = 'Resolve @a.';
    const allSnippets: Snippet[] = [
      createSnippet({ name: 'a', content: 'nested @b' }),
      createSnippet({ name: 'b', content: 'snippet' }),
    ];
    const expected = 'Resolve nested snippet.';
    await expect(resolveSnippetsWithTemplates(text, allSnippets)).resolves.toBe(expected);
  });

  it('should resolve multiple references to the same and different snippets', async () => {
    const text = 'One @a, two @a, and one @b.';
    const allSnippets: Snippet[] = [
      createSnippet({ name: 'a', content: 'A' }),
      createSnippet({ name: 'b', content: 'B' }),
    ];
    const expected = 'One A, two A, and one B.';
    await expect(resolveSnippetsWithTemplates(text, allSnippets)).resolves.toBe(expected);
  });

  it('should handle input text with no snippets, returning the original text', async () => {
    const text = 'This text has no snippets.';
    const allSnippets: Snippet[] = [];
    await expect(resolveSnippetsWithTemplates(text, allSnippets)).resolves.toBe(text);
  });

  it('should handle an empty string as input', async () => {
    const text = '';
    const allSnippets: Snippet[] = [];
    await expect(resolveSnippetsWithTemplates(text, allSnippets)).resolves.toBe('');
  });
});

describe('validateSnippetDependencies', () => {
  it('should execute without error for valid, non-cyclic dependencies', () => {
    const text = '@a';
    const allSnippets: Snippet[] = [
      createSnippet({ name: 'a', content: 'References @b' }),
      createSnippet({ name: 'b', content: 'No further references' }),
    ];
    expect(() => validateSnippetDependencies(text, allSnippets)).not.toThrow();
  });

  it('should detect cycles using ${name} syntax', () => {
    const text = '@a';
    const allSnippets: Snippet[] = [
      createSnippet({ name: 'a', content: 'goes to ${b}' }),
      createSnippet({ name: 'b', content: 'goes back to @a' }),
    ];
    expect(() => validateSnippetDependencies(text, allSnippets)).toThrow('Snippet cycle detected: @a -> @b -> @a');
  });

  it('should correctly trace dependencies from the content of standard snippets', () => {
    const text = '@a';
    const allSnippets: Snippet[] = [
      createSnippet({ name: 'a', content: 'Standard snippet with @b' }),
      createSnippet({ name: 'b', content: 'leads to @c' }),
      createSnippet({ name: 'c', content: 'causes cycle @a' }),
    ];
    expect(() => validateSnippetDependencies(text, allSnippets)).toThrow('Snippet cycle detected: @a -> @b -> @c -> @a');
  });

  it('should correctly trace dependencies from the prompt of generated snippets', () => {
    const text = '@a'; // Start validation from a snippet
    const allSnippets: Snippet[] = [
      createSnippet({ name: 'a', isGenerated: true, prompt: 'Generated snippet with @b' }),
      createSnippet({ name: 'b', isGenerated: true, prompt: 'leads to @c' }),
      createSnippet({ name: 'c', isGenerated: true, prompt: 'causes cycle @a' }),
    ];
    expect(() => validateSnippetDependencies(text, allSnippets)).toThrow('Snippet cycle detected: @a -> @b -> @c -> @a');
  });

  it('should throw an error for a direct cycle', () => {
    const text = '@a';
    const allSnippets: Snippet[] = [createSnippet({ name: 'a', content: 'contains @a' })];
    expect(() => validateSnippetDependencies(text, allSnippets)).toThrow('Snippet cycle detected: @a -> @a');
  });

  it('should throw an error for an indirect cycle', () => {
    const text = '@a';
    const allSnippets: Snippet[] = [
      createSnippet({ name: 'a', content: 'goes to @b' }),
      createSnippet({ name: 'b', content: 'goes back to @a' }),
    ];
    expect(() => validateSnippetDependencies(text, allSnippets)).toThrow('Snippet cycle detected: @a -> @b -> @a');
  });

  it('should not throw an error for non-existent snippets', () => {
    const text = '@a and @nonexistent';
    const allSnippets: Snippet[] = [
      createSnippet({ name: 'a', content: 'Valid snippet' }),
    ];
    expect(() => validateSnippetDependencies(text, allSnippets)).not.toThrow();
  });
});

describe('findNonExistentSnippets', () => {
  it('should find non-existent snippets using ${name} syntax', () => {
    const text = 'This references @a and ${nonexistent}.';
    const allSnippets: Snippet[] = [
      createSnippet({ name: 'a' }),
    ];
    expect(findNonExistentSnippets(text, allSnippets)).toEqual(expect.arrayContaining(['nonexistent']));
  });

  it('should return an empty array when all referenced snippets exist', () => {
    const text = 'This references @a and ${b}.';
    const allSnippets: Snippet[] = [
      createSnippet({ name: 'a' }),
      createSnippet({ name: 'b' }),
    ];
    expect(findNonExistentSnippets(text, allSnippets)).toEqual([]);
  });

  it('should return an array with names of non-existent snippets', () => {
    const text = 'This references @a and @nonexistent.';
    const allSnippets: Snippet[] = [
      createSnippet({ name: 'a' }),
    ];
    expect(findNonExistentSnippets(text, allSnippets)).toEqual(['nonexistent']);
  });

  it('should return each unique non-existent snippet name only once', () => {
    const text = 'References @a, @nonexistent, and @nonexistent again.';
    const allSnippets: Snippet[] = [
      createSnippet({ name: 'a' }),
    ];
    expect(findNonExistentSnippets(text, allSnippets)).toEqual(['nonexistent']);
  });

  it('should return an empty array if the input text contains no snippet references', () => {
    const text = 'No snippets here.';
    const allSnippets: Snippet[] = [];
    expect(findNonExistentSnippets(text, allSnippets)).toEqual([]);
  });
});

describe('getReferencedSnippetNames', () => {
  it('should extract the correct snippet name from a @-reference', () => {
    const text = 'This is a @test snippet.';
    const expected = new Set(['test']);
    expect(getReferencedSnippetNames(text)).toEqual(expected);
  });

  it('should extract snippet names from ${name} syntax', () => {
    const text = 'This is a ${test} snippet.';
    const expected = new Set(['test']);
    expect(getReferencedSnippetNames(text)).toEqual(expected);
  });

  it('should extract unique names from a mix of @ and ${} syntax', () => {
    const text = 'References @a, ${b}, and @a again, plus ${b}.';
    const expected = new Set(['a', 'b']);
    expect(getReferencedSnippetNames(text)).toEqual(expected);
  });

  it('should ignore complex expressions inside ${}', () => {
    const text = 'This should be ignored: ${1 + 1} and ${await fn()}';
    const expected = new Set();
    expect(getReferencedSnippetNames(text)).toEqual(expected);
  });

  it('should correctly handle a mix of valid references and complex expressions', () => {
    const text = 'Valid: @a and ${b}. Invalid: ${a + b}.';
    const expected = new Set(['a', 'b']);
    expect(getReferencedSnippetNames(text)).toEqual(expected);
  });

  it('should extract all unique snippet names from a text with multiple references', () => {
    const text = 'References @a, @b, and @a again.';
    const expected = new Set(['a', 'b']);
    expect(getReferencedSnippetNames(text)).toEqual(expected);
  });

  it('should return an empty Set if the text contains no snippet references', () => {
    const text = 'No snippets here.';
    const expected = new Set();
    expect(getReferencedSnippetNames(text)).toEqual(expected);
  });
});

describe('buildReverseDependencyGraph', () => {
  it('should identify dependencies from ${name} syntax in prompts', () => {
    const allSnippets: Snippet[] = [
      createSnippet({ name: 'a', isGenerated: true, prompt: '${b}' }),
      createSnippet({ name: 'b' }),
    ];
    const graph = buildReverseDependencyGraph(allSnippets);
    expect(graph.get('b')).toEqual(['a']);
  });

  it('should create a map where each key is a snippet name', () => {
    const allSnippets: Snippet[] = [
      createSnippet({ name: 'a', content: '@b' }),
      createSnippet({ name: 'b' }),
    ];
    const graph = buildReverseDependencyGraph(allSnippets);
    expect(graph.has('a')).toBe(true);
    expect(graph.has('b')).toBe(true);
  });

  it('should map snippets to arrays of their dependents', () => {
    const allSnippets: Snippet[] = [
      createSnippet({ name: 'a', content: '@b and @c' }),
      createSnippet({ name: 'b' }),
      createSnippet({ name: 'c' }),
      createSnippet({ name: 'd', content: '@c' }),
    ];
    const graph = buildReverseDependencyGraph(allSnippets);
    expect(graph.get('b')).toEqual(['a']);
    expect(graph.get('c')).toEqual(['a', 'd']);
  });

  it('should result in an empty array for snippets that are not depended on', () => {
    const allSnippets: Snippet[] = [
      createSnippet({ name: 'a', content: '@b' }),
      createSnippet({ name: 'b' }),
    ];
    const graph = buildReverseDependencyGraph(allSnippets);
    expect(graph.get('a')).toEqual([]);
  });

  it('should correctly identify dependencies from prompts of generated snippets', () => {
    const allSnippets: Snippet[] = [
      createSnippet({ name: 'a', isGenerated: true, prompt: '@b' }),
      createSnippet({ name: 'b' }),
    ];
    const graph = buildReverseDependencyGraph(allSnippets);
    expect(graph.get('b')).toEqual(['a']);
  });
});

describe('findTransitiveDependents', () => {
  it('should find all snippets that directly depend on a given snippet', () => {
    const reverseGraph = new Map<string, string[]>([
      ['b', ['a']],
      ['c', ['a']],
    ]);
    const dependents = findTransitiveDependents('b', reverseGraph);
    expect(dependents).toEqual(new Set(['a']));
  });

  it('should find all snippets that depend on a given snippet, directly or indirectly', () => {
    const reverseGraph = new Map<string, string[]>([
      ['c', ['b']],
      ['b', ['a']],
    ]);
    const dependents = findTransitiveDependents('c', reverseGraph);
    expect(dependents).toEqual(new Set(['b', 'a']));
  });

  it('should return an empty Set for a snippet that has no dependents', () => {
    const reverseGraph = new Map<string, string[]>([
      ['a', []],
    ]);
    const dependents = findTransitiveDependents('a', reverseGraph);
    expect(dependents).toEqual(new Set());
  });
});

describe('getSnippetDisplayOrder', () => {
  it('should return a topologically sorted list for an acyclic graph', () => {
    const allSnippets: Snippet[] = [
      createSnippet({ name: 'a', content: '@b' }),
      createSnippet({ name: 'b' }),
    ];
    const { sorted, cyclic } = getSnippetDisplayOrder(allSnippets);
    const sortedNames = sorted.map(s => s.name);
    expect(sortedNames).toEqual(['b', 'a']);
    expect(cyclic).toEqual([]);
  });

  it('should return all snippets even when a cycle is present, with cyclic snippets at the end', () => {
    const allSnippets: Snippet[] = [
      createSnippet({ name: 'a', content: '@b' }),
      createSnippet({ name: 'b', content: '@a' }),
    ];
    const { sorted, cyclic } = getSnippetDisplayOrder(allSnippets);
    // All snippets are returned, sorted alphabetically
    expect(sorted.map(s => s.name)).toEqual(['a', 'b']);
    expect(new Set(cyclic)).toEqual(new Set(['a', 'b']));
  });

  it('should handle disconnected components in the graph', () => {
    const allSnippets: Snippet[] = [
      createSnippet({ name: 'a', content: '@b' }),
      createSnippet({ name: 'b' }),
      createSnippet({ name: 'c' }),
    ];
    const { sorted, cyclic } = getSnippetDisplayOrder(allSnippets);
    const sortedNames = sorted.map(s => s.name);
    // The exact order of 'b' and 'c' can vary, so we check for presence and length
    expect(sortedNames).toContain('b');
    expect(sortedNames).toContain('c');
    expect(sortedNames.indexOf('b')).toBeLessThan(sortedNames.indexOf('a'));
    expect(sorted.length).toBe(3);
    expect(cyclic).toEqual([]);
  });

  it('should return empty arrays for an empty list of snippets', () => {
    const allSnippets: Snippet[] = [];
    const { sorted, cyclic } = getSnippetDisplayOrder(allSnippets);
    expect(sorted).toEqual([]);
    expect(cyclic).toEqual([]);
  });

  it('should correctly sort a more complex Directed Acyclic Graph', () => {
    const allSnippets: Snippet[] = [
      createSnippet({ name: 'a', content: '@b @c' }),
      createSnippet({ name: 'b', content: '@d' }),
      createSnippet({ name: 'c', content: '@d @e' }),
      createSnippet({ name: 'd' }),
      createSnippet({ name: 'e' }),
    ];
    const { sorted, cyclic } = getSnippetDisplayOrder(allSnippets);
    const sortedNames = sorted.map(s => s.name);

    // Valid topological orders must have d and e before b and c, and b and c before a.
    // The relative order of d and e doesn't matter.
    // The relative order of b and c doesn't matter.
    expect(cyclic).toEqual([]);
    expect(sortedNames.length).toBe(5);
    expect(sortedNames.indexOf('d')).toBeLessThan(sortedNames.indexOf('b'));
    expect(sortedNames.indexOf('d')).toBeLessThan(sortedNames.indexOf('c'));
    expect(sortedNames.indexOf('e')).toBeLessThan(sortedNames.indexOf('c'));
    expect(sortedNames.indexOf('b')).toBeLessThan(sortedNames.indexOf('a'));
    expect(sortedNames.indexOf('c')).toBeLessThan(sortedNames.indexOf('a'));
  });

  it('should return all snippets, with acyclic parts sorted and cyclic parts appended', () => {
    const allSnippets: Snippet[] = [
      createSnippet({ name: 'c', content: '@d' }), // acyclic part
      createSnippet({ name: 'a', content: '@b' }), // part of cycle
      createSnippet({ name: 'd' }),   // acyclic part
      createSnippet({ name: 'b', content: '@a' }), // part of cycle
    ];
    const { sorted, cyclic } = getSnippetDisplayOrder(allSnippets);
    const sortedNames = sorted.map(s => s.name);

    expect(sortedNames).toEqual(['d', 'c', 'a', 'b']);
    expect(new Set(cyclic)).toEqual(new Set(['a', 'b']));
  });

  it('should identify a snippet that directly references itself as cyclic and append it', () => {
    const allSnippets: Snippet[] = [
      createSnippet({ name: 'a', content: 'self @a' }),
      createSnippet({ name: 'b', content: 'normal' }),
    ];
    const { sorted, cyclic } = getSnippetDisplayOrder(allSnippets);
    const sortedNames = sorted.map(s => s.name);

    expect(sortedNames).toEqual(['b', 'a']);
    expect(cyclic).toEqual(['a']);
  });
});

describe('groupSnippetsIntoWaves', () => {
  it('should group snippets with diamond dependency correctly', () => {
    // Purpose: Verify that for A -> B/C -> D, we get waves [[A], [B, C], [D]]
    const snippetA = createSnippet({ name: 'A', content: 'A content' });
    const snippetB = createSnippet({ name: 'B', content: '@A' });
    const snippetC = createSnippet({ name: 'C', content: '@A' });
    const snippetD = createSnippet({ name: 'D', content: '@B and @C' });

    const waves = groupSnippetsIntoWaves([snippetA, snippetB, snippetC, snippetD]);

    expect(waves).toHaveLength(3);
    expect(waves[0]?.map(s => s.name)).toEqual(['A']);
    expect(new Set(waves[1]?.map(s => s.name))).toEqual(new Set(['B', 'C']));
    expect(waves[2]?.map(s => s.name)).toEqual(['D']);
  });

  it('should handle linear chain dependencies', () => {
    // Purpose: Verify that A -> B -> C results in waves [[A], [B], [C]]
    const snippetA = createSnippet({ name: 'A', content: 'A content' });
    const snippetB = createSnippet({ name: 'B', content: '@A' });
    const snippetC = createSnippet({ name: 'C', content: '@B' });

    const waves = groupSnippetsIntoWaves([snippetA, snippetB, snippetC]);

    expect(waves).toHaveLength(3);
    expect(waves[0]?.map(s => s.name)).toEqual(['A']);
    expect(waves[1]?.map(s => s.name)).toEqual(['B']);
    expect(waves[2]?.map(s => s.name)).toEqual(['C']);
  });

  it('should put all independent snippets in the same wave', () => {
    // Purpose: Verify that snippets with no dependencies can all run in parallel
    const snippetA = createSnippet({ name: 'A', content: 'A content' });
    const snippetB = createSnippet({ name: 'B', content: 'B content' });
    const snippetC = createSnippet({ name: 'C', content: 'C content' });

    const waves = groupSnippetsIntoWaves([snippetA, snippetB, snippetC]);

    expect(waves).toHaveLength(1);
    expect(new Set(waves[0]?.map(s => s.name))).toEqual(new Set(['A', 'B', 'C']));
  });

  it('should handle complex graph with multiple roots and branches', () => {
    // Purpose: Test a more complex dependency structure
    // Graph: A -> C, B -> C, C -> D, C -> E
    const snippetA = createSnippet({ name: 'A', content: 'A content' });
    const snippetB = createSnippet({ name: 'B', content: 'B content' });
    const snippetC = createSnippet({ name: 'C', content: '@A and @B' });
    const snippetD = createSnippet({ name: 'D', content: '@C' });
    const snippetE = createSnippet({ name: 'E', content: '@C' });

    const waves = groupSnippetsIntoWaves([snippetA, snippetB, snippetC, snippetD, snippetE]);

    expect(waves).toHaveLength(3);
    expect(new Set(waves[0]?.map(s => s.name))).toEqual(new Set(['A', 'B']));
    expect(waves[1]?.map(s => s.name)).toEqual(['C']);
    expect(new Set(waves[2]?.map(s => s.name))).toEqual(new Set(['D', 'E']));
  });

  it('should return empty array for empty input', () => {
    // Purpose: Edge case validation for empty input
    const waves = groupSnippetsIntoWaves([]);
    expect(waves).toEqual([]);
  });

  it('should handle cyclic dependencies by excluding them', () => {
    // Purpose: Verify that cyclic snippets are not included in waves
    const snippetA = createSnippet({ name: 'A', content: '@B' });
    const snippetB = createSnippet({ name: 'B', content: '@A' });
    const snippetC = createSnippet({ name: 'C', content: 'C content' });

    const waves = groupSnippetsIntoWaves([snippetA, snippetB, snippetC]);

    // Only C should be processed, A and B form a cycle
    expect(waves).toHaveLength(1);
    expect(waves[0]?.map(s => s.name)).toEqual(['C']);
  });

  it('should use prompt for generated snippets dependencies', () => {
    // Purpose: Verify that generated snippets use their prompt for dependency detection
    const snippetA = createSnippet({ name: 'A', content: 'A content' });
    const snippetB = createSnippet({ name: 'B', isGenerated: true, prompt: '@A', content: 'old B' });

    const waves = groupSnippetsIntoWaves([snippetA, snippetB]);

    expect(waves).toHaveLength(2);
    expect(waves[0]?.map(s => s.name)).toEqual(['A']);
    expect(waves[1]?.map(s => s.name)).toEqual(['B']);
  });

  it('should handle mixed ${} and @ syntax', () => {
    // Purpose: Verify both reference syntaxes work correctly
    const snippetA = createSnippet({ name: 'A', content: 'A content' });
    const snippetB = createSnippet({ name: 'B', content: '${A}' });
    const snippetC = createSnippet({ name: 'C', content: '@A' });

    const waves = groupSnippetsIntoWaves([snippetA, snippetB, snippetC]);

    expect(waves).toHaveLength(2);
    expect(waves[0]?.map(s => s.name)).toEqual(['A']);
    expect(new Set(waves[1]?.map(s => s.name))).toEqual(new Set(['B', 'C']));
  });
});

describe('getTopologicalSortForExecution', () => {
  it('should return a topologically sorted list for an acyclic graph', () => {
    const allSnippets: Snippet[] = [
      createSnippet({ name: 'a', content: '@b' }),
      createSnippet({ name: 'b' }),
    ];
    const { sorted, cyclic } = getTopologicalSortForExecution(allSnippets);
    const sortedNames = sorted.map(s => s.name);
    expect(sortedNames).toEqual(['b', 'a']);
    expect(cyclic).toEqual([]);
  });

  it('should identify snippets involved in a cycle and not include them in the sorted list', () => {
    const allSnippets: Snippet[] = [
      createSnippet({ name: 'a', content: '@b' }),
      createSnippet({ name: 'b', content: '@a' }),
    ];
    const { sorted, cyclic } = getTopologicalSortForExecution(allSnippets);
    expect(sorted).toEqual([]);
    expect(new Set(cyclic)).toEqual(new Set(['a', 'b']));
  });

  it('should handle disconnected components in the graph', () => {
    const allSnippets: Snippet[] = [
      createSnippet({ name: 'a', content: '@b' }),
      createSnippet({ name: 'b' }),
      createSnippet({ name: 'c' }),
    ];
    const { sorted, cyclic } = getTopologicalSortForExecution(allSnippets);
    const sortedNames = sorted.map(s => s.name);
    // The exact order of 'b' and 'c' can vary, so we check for presence and length
    expect(sortedNames).toContain('b');
    expect(sortedNames).toContain('c');
    expect(sortedNames.indexOf('b')).toBeLessThan(sortedNames.indexOf('a'));
    expect(sorted.length).toBe(3);
    expect(cyclic).toEqual([]);
  });

  it('should return empty arrays for an empty list of snippets', () => {
    const allSnippets: Snippet[] = [];
    const { sorted, cyclic } = getTopologicalSortForExecution(allSnippets);
    expect(sorted).toEqual([]);
    expect(cyclic).toEqual([]);
  });

  it('should correctly sort a more complex Directed Acyclic Graph', () => {
    const allSnippets: Snippet[] = [
      createSnippet({ name: 'a', content: '@b @c' }),
      createSnippet({ name: 'b', content: '@d' }),
      createSnippet({ name: 'c', content: '@d @e' }),
      createSnippet({ name: 'd' }),
      createSnippet({ name: 'e' }),
    ];
    const { sorted, cyclic } = getTopologicalSortForExecution(allSnippets);
    const sortedNames = sorted.map(s => s.name);

    expect(cyclic).toEqual([]);
    expect(sortedNames.length).toBe(5);
    expect(sortedNames.indexOf('d')).toBeLessThan(sortedNames.indexOf('b'));
    expect(sortedNames.indexOf('d')).toBeLessThan(sortedNames.indexOf('c'));
    expect(sortedNames.indexOf('e')).toBeLessThan(sortedNames.indexOf('c'));
    expect(sortedNames.indexOf('b')).toBeLessThan(sortedNames.indexOf('a'));
    expect(sortedNames.indexOf('c')).toBeLessThan(sortedNames.indexOf('a'));
  });

  it('should return only the non-cyclic parts sorted', () => {
    const allSnippets: Snippet[] = [
      createSnippet({ name: 'a', content: '@b' }), // part of cycle
      createSnippet({ name: 'b', content: '@a' }), // part of cycle
      createSnippet({ name: 'c', content: '@d' }), // acyclic part
      createSnippet({ name: 'd' }),   // acyclic part
    ];
    const { sorted, cyclic } = getTopologicalSortForExecution(allSnippets);
    const sortedNames = sorted.map(s => s.name);

    expect(sortedNames).toEqual(['d', 'c']);
    expect(new Set(cyclic)).toEqual(new Set(['a', 'b']));
  });

  it('should identify a snippet that directly references itself as cyclic and exclude it from sorted', () => {
    const allSnippets: Snippet[] = [
      createSnippet({ name: 'a', content: 'self @a' }),
      createSnippet({ name: 'b', content: 'normal' }),
    ];
    const { sorted, cyclic } = getTopologicalSortForExecution(allSnippets);
    const sortedNames = sorted.map(s => s.name);

    expect(sortedNames).toEqual(['b']);
    expect(cyclic).toEqual(['a']);
  });
});
