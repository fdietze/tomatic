import React, { useState, useMemo, useRef, useId } from 'react';
import { useOnClickOutside } from 'usehooks-ts';
import type { DisplayModelInfo } from '@/types/storage';
import CopyButton from './CopyButton';

export interface ComboboxItem {
  id: string;
  display_text: string;
  display_html?: string;
  model_info?: DisplayModelInfo;
}

interface ComboboxProps {
  items: ComboboxItem[];
  selectedId: string;
  onSelect: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
  onReload?: () => void;
  errorMessage?: string | null;
  label?: string;
}

const Combobox: React.FC<ComboboxProps> = ({
  items,
  selectedId,
  onSelect,
  placeholder = '',
  disabled = false,
  loading = false,
  onReload,
  errorMessage = null,
  label,
}) => {
  const [inputValue, setInputValue] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);
  const [isPristine, setIsPristine] = useState(true);
  const id = useId();

  const comboboxWrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsListRef = useRef<HTMLUListElement>(null);

  const selectedItem = useMemo(() => items.find(item => item.id === selectedId), [items, selectedId]);

  useOnClickOutside(comboboxWrapperRef as React.RefObject<HTMLElement>, () => {
    // Only act if the suggestions are currently shown
    if (showSuggestions) {
      setShowSuggestions(false);
      setHighlightedIndex(null);
      // On click outside, revert to pristine state, showing the selected item
      setInputValue('');
      setIsPristine(true);
    }
  });

  const filteredItems = useMemo(() => {
    const query = inputValue.toLowerCase().trim();
    if (isPristine || !query) return items;
    const searchTerms = query.split(/\s+/);
    return items.filter((item) => {
      const itemText = `${item.id} ${item.display_text}`.toLowerCase();
      return searchTerms.every((term) => itemText.includes(term));
    });
  }, [inputValue, items, isPristine]);

  const handleSelectItem = (item: ComboboxItem): void => {
    onSelect(item.id);
    setShowSuggestions(false);
    setHighlightedIndex(null);
    setInputValue('');
    setIsPristine(true);
  };
  
  const scrollHighlightedItemIntoView = (): void => {
    const listEl = suggestionsListRef.current;
    const highlightedEl = listEl?.querySelector<HTMLLIElement>('.combobox-item-highlighted');

    if (listEl && highlightedEl) {
        const listRect = listEl.getBoundingClientRect();
        const itemRect = highlightedEl.getBoundingClientRect();

        if (itemRect.bottom > listRect.bottom) {
            listEl.scrollTop += itemRect.bottom - listRect.bottom;
        } else if (itemRect.top < listRect.top) {
            listEl.scrollTop -= listRect.top - itemRect.top;
        }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (!showSuggestions && !['Enter', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
        return;
    }

    const numItems = filteredItems.length;
    if (numItems === 0 && !['Enter', 'Escape'].includes(e.key)) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex((prev) => (prev === null ? 0 : (prev + 1) % numItems));
        scrollHighlightedItemIntoView();
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex((prev) => (prev === null ? numItems - 1 : (prev + numItems - 1) % numItems));
        scrollHighlightedItemIntoView();
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightedIndex !== null && filteredItems[highlightedIndex]) {
          handleSelectItem(filteredItems[highlightedIndex]);
        } else if (filteredItems.length === 1 && filteredItems[0]) {
            handleSelectItem(filteredItems[0]);
        } else {
            const exactMatch = items.find(item => item.id === inputValue);
            if (exactMatch) {
                handleSelectItem(exactMatch);
            } else {
                // If no match and user presses enter, cancel the search and restore
                setShowSuggestions(false);
                setHighlightedIndex(null);
                setInputValue('');
                setIsPristine(true);
            }
        }
        break;
      case 'Escape':
        setShowSuggestions(false);
        setHighlightedIndex(null);
        setInputValue('');
        setIsPristine(true);
        break;
      case 'Tab':
        setShowSuggestions(false);
        setHighlightedIndex(null);
        setInputValue('');
        setIsPristine(true);
        break;
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const newValue = e.target.value;
    setInputValue(newValue);
    setShowSuggestions(true);
    setHighlightedIndex(null);
    setIsPristine(false);
  };

  const handleFocus = (): void => {
    setShowSuggestions(true);
    // Clear the input to allow the user to easily type a new search
    setInputValue('');
    setIsPristine(false);
  };

  const displayValue = isPristine ? (selectedItem?.display_text || selectedId) : inputValue;

  return (
    <div className="combobox-wrapper" ref={comboboxWrapperRef}>
      {label && <label htmlFor={id} className="combobox-label">{label}</label>}
      <div className="combobox-input-wrapper">
        <input
          id={id}
          data-testid="model-combobox-input"
          ref={inputRef}
          type="text"
          value={displayValue}
          onChange={handleInput}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled || loading}
          className={`combobox-input ${disabled ? 'combobox-input-disabled' : ''} ${loading ? 'combobox-input-loading' : ''}`}
          aria-autocomplete="list"
          aria-expanded={showSuggestions}
        />
         {onReload && (
            <button onClick={onReload} className={`combobox-reload ${loading ? 'reloading' : ''}`} disabled={loading} data-testid="reload-models-button">
                <i className="codicon codicon-refresh"></i>
            </button>
        )}
      </div>
      
      {loading && <div className="combobox-loading-indicator">Loading...</div>}
      
      {!loading && errorMessage && <div className="combobox-error-message">{errorMessage}</div>}

      {!loading && !errorMessage && showSuggestions && items.length > 0 && (
        <div className="combobox-suggestions-container">
          {filteredItems.length > 0 ? (
            <ul className="combobox-suggestions" ref={suggestionsListRef} role="listbox">
              {filteredItems.map((item, index) => (
                <li
                  key={item.id}
                  data-testid={`model-combobox-item-${item.id}`}
                  className={`combobox-item ${index === highlightedIndex ? 'combobox-item-highlighted' : ''}`}
                  onClick={() => { handleSelectItem(item); }}
                  onMouseEnter={() => { setHighlightedIndex(index); }}
                  role="option"
                  aria-selected={index === highlightedIndex}
                >
                  {item.display_html ? (
                    <div dangerouslySetInnerHTML={{ __html: item.display_html }} />
                  ) : (
                    item.display_text
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <div className="combobox-no-results">No results found</div>
          )}
        </div>
      )}
    </div>
  );
};

export default Combobox;
