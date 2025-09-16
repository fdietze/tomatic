import React from 'react';

export function useTextAreaEnterHandler(
  isMobile: boolean,
  onSubmit: () => void
): (event: React.KeyboardEvent<HTMLTextAreaElement>) => void {
  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Enter') {
      return;
    }

    if (isMobile || event.shiftKey) {
      return;
    }

    event.preventDefault();
    onSubmit();
  };

  return handleKeyDown;
}
