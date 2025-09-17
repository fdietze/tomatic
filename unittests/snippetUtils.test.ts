import { describe, it, expect } from 'vitest';
import { resolveSnippets, validateSnippetDependencies, findNonExistentSnippets, getReferencedSnippetNames, buildReverseDependencyGraph, findTransitiveDependents, topologicalSort } from '../src/utils/snippetUtils';
import type { Snippet } from '../src/types/storage';

const createSnippet = (overrides: Partial<Snippet> & { name: string }): Snippet => ({
  content: '',
  isGenerated: false,
  prompt: '',
  createdAt_ms: 0,
  updatedAt_ms: 0,
  generationError: null,
  isDirty: false,
  ...overrides,
});

describe('resolveSnippets', () => {
  it('should resolve a single, non-nested snippet', () => {
    const text = 'This contains @a.';
    const allSnippets: Snippet[] = [createSnippet({ name: 'a', content: 'a snippet' })];
    const expected = 'This contains a snippet.';
    expect(resolveSnippets(text, allSnippets)).toBe(expected);
  });

  it('should recursively resolve a snippet that contains another snippet', () => {
    const text = 'Resolve @a.';
    const allSnippets: Snippet[] = [
      createSnippet({ name: 'a', content: 'nested @b' }),
      createSnippet({ name: 'b', content: 'snippet' }),
    ];
    const expected = 'Resolve nested snippet.';
    expect(resolveSnippets(text, allSnippets)).toBe(expected);
  });

  it('should resolve multiple references to the same and different snippets', () => {
    const text = 'One @a, two @a, and one @b.';
    const allSnippets: Snippet[] = [
      createSnippet({ name: 'a', content: 'A' }),
      createSnippet({ name: 'b', content: 'B' }),
    ];
    const expected = 'One A, two A, and one B.';
    expect(resolveSnippets(text, allSnippets)).toBe(expected);
  });

  it('should throw an error if a referenced snippet does not exist', () => {
    const text = 'This @nonexistent snippet will fail.';
    const allSnippets: Snippet[] = [];
    expect(() => resolveSnippets(text, allSnippets)).toThrow("Snippet '@nonexistent' not found.");
  });

  it('should throw an error for a direct cycle', () => {
    const text = '@a';
    const allSnippets: Snippet[] = [createSnippet({ name: 'a', content: 'cycle @a' })];
    expect(() => resolveSnippets(text, allSnippets)).toThrow('Snippet cycle detected: @a -> @a');
  });

  it('should throw an error for an indirect cycle', () => {
    const text = '@a';
    const allSnippets: Snippet[] = [
      createSnippet({ name: 'a', content: 'goes to @b' }),
      createSnippet({ name: 'b', content: 'back to @a' }),
    ];
    expect(() => resolveSnippets(text, allSnippets)).toThrow('Snippet cycle detected: @a -> @b -> @a');
  });

  it('should handle input text with no snippets, returning the original text', () => {
    const text = 'This text has no snippets.';
    const allSnippets: Snippet[] = [];
    expect(resolveSnippets(text, allSnippets)).toBe(text);
  });

  it('should handle an empty string as input', () => {
    const text = '';
    const allSnippets: Snippet[] = [];
    expect(resolveSnippets(text, allSnippets)).toBe('');
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
  it('should return an empty array when all referenced snippets exist', () => {
    const text = 'This references @a and @b.';
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
  it('should extract the correct snippet name from a reference', () => {
    const text = 'This is a @test snippet.';
    const expected = new Set(['test']);
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

describe('topologicalSort', () => {
  it('should return a topologically sorted list for an acyclic graph', () => {
    const allSnippets: Snippet[] = [
      createSnippet({ name: 'a', content: '@b' }),
      createSnippet({ name: 'b' }),
    ];
    const { sorted, cyclic } = topologicalSort(allSnippets);
    const sortedNames = sorted.map(s => s.name);
    expect(sortedNames).toEqual(['b', 'a']);
    expect(cyclic).toEqual([]);
  });

  it('should identify snippets involved in a cycle', () => {
    const allSnippets: Snippet[] = [
      createSnippet({ name: 'a', content: '@b' }),
      createSnippet({ name: 'b', content: '@a' }),
    ];
    const { sorted, cyclic } = topologicalSort(allSnippets);
    expect(sorted).toEqual([]);
    expect(new Set(cyclic)).toEqual(new Set(['a', 'b']));
  });

  it('should handle disconnected components in the graph', () => {
    const allSnippets: Snippet[] = [
      createSnippet({ name: 'a', content: '@b' }),
      createSnippet({ name: 'b' }),
      createSnippet({ name: 'c' }),
    ];
    const { sorted, cyclic } = topologicalSort(allSnippets);
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
    const { sorted, cyclic } = topologicalSort(allSnippets);
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
    const { sorted, cyclic } = topologicalSort(allSnippets);
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

  it('should correctly handle a graph with a cycle, returning only the non-cyclic parts sorted', () => {
    const allSnippets: Snippet[] = [
        createSnippet({ name: 'a', content: '@b' }), // part of cycle
        createSnippet({ name: 'b', content: '@a' }), // part of cycle
        createSnippet({ name: 'c', content: '@d' }), // acyclic part
        createSnippet({ name: 'd' }),   // acyclic part
    ];
    const { sorted, cyclic } = topologicalSort(allSnippets);
    const sortedNames = sorted.map(s => s.name);
    
    expect(sortedNames).toEqual(['d', 'c']);
    expect(new Set(cyclic)).toEqual(new Set(['a', 'b']));
  });

  it('should identify a snippet that directly references itself as cyclic', () => {
    const allSnippets: Snippet[] = [
        createSnippet({ name: 'a', content: 'self @a' }),
        createSnippet({ name: 'b', content: 'normal' }),
    ];
    const { sorted, cyclic } = topologicalSort(allSnippets);
    const sortedNames = sorted.map(s => s.name);

    expect(sortedNames).toEqual(['b']);
    expect(cyclic).toEqual(['a']);
  });
});
