import React, { useEffect, useRef } from 'react';
import { createRoot, Root } from 'react-dom/client';
import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';
import CopyButton from './CopyButton';
import '../styles/highlight.css';

interface MarkdownProps {
  markdownText: string;
}

// Initialize markdown-it with highlight.js
const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  highlight: (str, lang) => {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(str, {
          language: lang,
          ignoreIllegals: true,
        }).value;
      } catch (__) {
        // ignore
      }
    }
    return ''; // use external default escaping
  },
});

const Markdown: React.FC<MarkdownProps> = ({ markdownText }) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const roots = useRef<Root[]>([]);

  const renderedHtml = md.render(markdownText.trim());

  useEffect(() => {
    roots.current.forEach(root => root.unmount());
    roots.current = [];

    if (contentRef.current) {
      const codeBlocks = contentRef.current.querySelectorAll('pre');

      codeBlocks.forEach(codeBlock => {
        const codeElement = codeBlock.querySelector('code');
        const codeText = codeElement ? codeElement.innerText : '';

        const buttonContainer = document.createElement('div');
        buttonContainer.style.position = 'absolute';
        buttonContainer.style.top = '8px';
        buttonContainer.style.right = '8px';

        codeBlock.style.position = 'relative';
        codeBlock.appendChild(buttonContainer);

        const root = createRoot(buttonContainer);
        root.render(<CopyButton textToCopy={codeText} />);
        roots.current.push(root);
      });
    }

    return () => {
      roots.current.forEach(root => root.unmount());
    };
  }, [renderedHtml]);

  return (
    <div
      ref={contentRef}
      dangerouslySetInnerHTML={{ __html: renderedHtml }}
    />
  );
};

export default Markdown;