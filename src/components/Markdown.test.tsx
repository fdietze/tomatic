import React from 'react';
import { render } from '@testing-library/react';
import Markdown from './Markdown';

// Mock react-dom/client to prevent the CopyButton injection from crashing the test
vi.mock('react-dom/client', () => ({
  createRoot: vi.fn(() => ({
    render: vi.fn(),
    unmount: vi.fn(),
  })),
}));

// Mock highlight.js because it doesn't work well in the JSDOM environment
vi.mock('highlight.js/lib/core', () => ({
  default: {
    registerLanguage: vi.fn(),
    getLanguage: vi.fn().mockReturnValue(true),
    highlight: vi.fn((str, options) => ({
      value: `<span class="hljs-keyword">${str}</span>`,
      language: options.language,
    })),
  },
}));

describe('Markdown component', () => {
  it('should apply syntax highlighting to code blocks', () => {
    const markdownText = "```javascript\nconst hello = 'world';\n```";
    const { container } = render(<Markdown markdownText={markdownText} />);

    const codeElement = container.querySelector('code');
    expect(codeElement).not.toBeNull();

    // Check that markdown-it has added the language class
    const hasLangClass = codeElement?.classList.contains('language-javascript');
    expect(hasLangClass).toBe(true);

    // Check that our mocked highlight.js output is rendered
    const spanElement = codeElement?.querySelector('span');
    expect(spanElement).not.toBeNull();
    expect(spanElement?.classList.contains('hljs-keyword')).toBe(true);
  });
});