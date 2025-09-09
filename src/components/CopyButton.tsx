import React, { useState, useRef, useEffect } from 'react';
import { Copy, Check, X } from 'lucide-react';

const FEEDBACK_DURATION_MS = 1500;

interface CopyButtonProps {
  textToCopy: string;
}

type CopyState = 'idle' | 'copied' | 'error';

const CopyButton: React.FC<CopyButtonProps> = ({ textToCopy }) => {
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const timeoutRef = useRef<number | null>(null);

  const resetState = () => {
    setCopyState('idle');
  };

  const handleCopy = async () => {
    if (!textToCopy) return;

    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
    }

    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopyState('copied');
    } catch (err) {
      console.error('[CopyButton] Error copying to clipboard:', err);
      setCopyState('error');
    } finally {
      timeoutRef.current = window.setTimeout(resetState, FEEDBACK_DURATION_MS);
    }
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const icons: Record<CopyState, React.ReactElement> = {
    idle: <Copy className="w-4 h-4" />,
    copied: <Check className="w-4 h-4" />,
    error: <X className="w-4 h-4" />,
  };

  const buttonTitle: Record<CopyState, string> = {
    idle: 'Copy to clipboard',
    copied: 'Copied!',
    error: 'Failed to copy',
  };

  return (
    <button
      className="copy-button"
      data-size="compact"
      onClick={handleCopy}
      title={buttonTitle[copyState]}
    >
      {icons[copyState]}
    </button>
  );
};

export default CopyButton;
