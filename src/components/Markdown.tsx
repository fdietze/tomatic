import React, { useEffect, useRef } from 'react';
import { createRoot, Root } from 'react-dom/client';
import MarkdownIt from 'markdown-it';
import CopyButton from './CopyButton';

interface MarkdownProps {
  markdownText: string;
}

// Initialize markdown-it
const md = new MarkdownIt({
  html: true, // Enable HTML tags in source
  linkify: true, // Autoconvert URL-like text to links
  typographer: true, // Enable some language-neutral replacement + quotes beautification
});

const Markdown: React.FC<MarkdownProps> = ({ markdownText }) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const roots = useRef<Root[]>([]);

  // Render markdown to HTML
  const renderedHtml = md.render(markdownText.trim());

  // This useEffect hook is used to inject the CopyButton React component into the
  // HTML rendered by markdown-it. This approach is a trade-off. While it involves
  // direct DOM manipulation and manual management of React roots (which can be
  // considered an anti-pattern), it is the most practical solution here.
  // The alternatives were:
  // 1. A custom token renderer: too complex and brittle to implement correctly.
  // 2. A vanilla JS onclick handler: a regression in a React codebase.
  // This approach ensures that we can use the true CopyButton React component
  // with all its features and styling, inside the markdown-it rendered output.
  useEffect(() => {
    // Clean up previously created React roots to prevent memory leaks
    roots.current.forEach((root: Root) => { root.unmount(); });
    roots.current = [];

    if (contentRef.current) {
      // Find all code blocks rendered by markdown-it
      const codeBlocks: NodeListOf<HTMLElement> = contentRef.current.querySelectorAll('pre');

      codeBlocks.forEach(codeBlock => {
        const codeElement = codeBlock.querySelector('code');
        const codeText = codeElement ? codeElement.innerText : '';

        // Create a container for the copy button to be injected into
        const buttonContainer = document.createElement('div');
        buttonContainer.style.position = 'absolute';
        buttonContainer.style.top = '8px';
        buttonContainer.style.right = '8px';

        // The parent <pre> tag needs to be positioned relatively for the
        // absolute positioning of the button container to work.
        codeBlock.style.position = 'relative';
        codeBlock.appendChild(buttonContainer);

        // Create a new React root in the container and render the CopyButton
        const root = createRoot(buttonContainer as HTMLElement);
        root.render(<CopyButton textToCopy={codeText} />);

        // Keep track of the created roots so they can be unmounted on cleanup
        roots.current.push(root);
      });
    }

    // Cleanup function to unmount all created roots when the component
    // unmounts or when the markdown content changes.
    return (): void => {
      roots.current.forEach((root: Root) => { root.unmount(); });
    };
  }, [renderedHtml]); // Rerun effect if markdown content changes

  return (
    <div
      ref={contentRef}
      dangerouslySetInnerHTML={{ __html: renderedHtml }}
    />
  );
};

export default Markdown;
