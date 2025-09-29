import React from 'react';
import Markdown from './Markdown';
import '@/styles/components/FullScreenMarkdownViewer.css';

interface FullScreenMarkdownViewerProps {
  markdownText: string;
  onClose: () => void;
}

const FullScreenMarkdownViewer: React.FC<FullScreenMarkdownViewerProps> = ({ markdownText, onClose }) => {
  return (
    <div className="fullscreen-markdown-viewer" data-testid="fullscreen-markdown-viewer">
      <div className="fullscreen-markdown-viewer-content">
        <Markdown markdownText={markdownText} />
      </div>
      <button
        className="fullscreen-markdown-viewer-close"
        onClick={onClose}
        data-testid="fullscreen-markdown-viewer-close-button"
      >
        Close
      </button>
    </div>
  );
};

export default FullScreenMarkdownViewer;