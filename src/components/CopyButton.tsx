import React, { useState, useRef, useEffect } from 'react';

const COPY_LABEL = 'copy';
const COPIED_LABEL = 'copied';
const ERROR_LABEL = 'failed';
const FEEDBACK_DURATION_MS = 1500;

interface CopyButtonProps {
  textToCopy: string;
}

const CopyButton: React.FC<CopyButtonProps> = ({ textToCopy }) => {
  const [buttonText, setButtonText] = useState(COPY_LABEL);
  const timeoutRef = useRef<number | null>(null);

  const resetText = (): void => {
    setButtonText(COPY_LABEL);
  };

  const handleCopy = async (): Promise<void> => {
    if (!textToCopy) return;

    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
    }

    try {
      await navigator.clipboard.writeText(textToCopy);
      setButtonText(COPIED_LABEL);
    } catch (err) {
      console.error('[CopyButton] Error copying to clipboard:', err);
      setButtonText(ERROR_LABEL);
    } finally {
      timeoutRef.current = window.setTimeout(resetText, FEEDBACK_DURATION_MS);
    }
  };

  useEffect(() => {
    return (): void => {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);


  return (
    <button className="copy-button" data-size="compact" onClick={() => { void handleCopy(); }}>
      {buttonText}
    </button>
  );
};

export default CopyButton;
