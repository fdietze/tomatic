import React from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import CopyButton from './CopyButton';

interface MarkdownProps {
  markdownText: string;
}

const Markdown: React.FC<MarkdownProps> = ({ markdownText }) => {
  return (
    <ReactMarkdown
      rehypePlugins={[rehypeRaw]}
      remarkPlugins={[remarkGfm]}
      components={{
        pre: ({ node, ...props }) => {
          const codeElement = node?.children[0];
          let codeText = '';
          if (
            codeElement &&
            'tagName' in codeElement &&
            codeElement.tagName === 'code' &&
            'children' in codeElement &&
            codeElement.children[0] &&
            'value' in codeElement.children[0]
          ) {
            codeText = codeElement.children[0].value as string;
          }
          return (
            <pre {...props}>
              <CopyButton textToCopy={codeText} />
              {props.children}
            </pre>
          );
        },
      }}
    >
      {markdownText}
    </ReactMarkdown>
  );
};

export default Markdown;
