import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useOnClickOutside } from 'usehooks-ts';
import type { DisplayModelInfo } from '@/types/storage';

export interface ComboboxItem {
  id: string;
  display_text: string;
  display_html?: string;
  // We can add the full model info if needed for richer filtering
  model_info: DisplayModelInfo;
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
  const [searchQuery, setSearchQuery] = useState(selectedId);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);

  const comboboxWrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsListRef = useRef<HTMLUListElement>(null);

  // Effect to update internal search_query when external selected_id changes
  useEffect(() => {
    setSearchQuery(selectedId);
  }, [selectedId]);

  // Close suggestions when clicking outside
  useOnClickOutside(comboboxWrapperRef as React.RefObject<HTMLElement>, () => {
    setShowSuggestions(false);
    setHighlightedIndex(null);
  });

  const filteredItems = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    const searchTerms = query.split(/\s+/);
    return items.filter((item) => {
      const itemText = `${item.id} ${item.display_text}`.toLowerCase();
      return searchTerms.every((term) => itemText.includes(term));
    });
  }, [searchQuery, items]);

  const handleSelectItem = (item: ComboboxItem) => {
    onSelect(item.id);
    setSearchQuery(item.id);
    setShowSuggestions(false);
    setHighlightedIndex(null);
    inputRef.current?.focus();
  };
  
  const scrollHighlightedItemIntoView = () => {
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


  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
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
        } else if (filteredItems.length === 1) {
            handleSelectItem(filteredItems[0]);
        } else {
            // If the query exactly matches an item, select it
            const exactMatch = items.find(item => item.id === searchQuery);
            if (exactMatch) {
                handleSelectItem(exactMatch);
            }
        }
        break;
      case 'Escape':
        setShowSuggestions(false);
        setHighlightedIndex(null);
        break;
      case 'Tab':
        setShowSuggestions(false);
        setHighlightedIndex(null);
        break;
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setSearchQuery(newValue);
    setShowSuggestions(true);
    setHighlightedIndex(null);
  };

  const handleFocus = () => {
    setShowSuggestions(true);
  };

  return (
    <div className="combobox-wrapper" ref={comboboxWrapperRef}>
      {label && <label className="combobox-label">{label}</label>}
      <div className="combobox-input-wrapper">
        <input
          data-testid="model-combobox-input"
          ref={inputRef}
          type="text"
          value={searchQuery}
          onChange={handleInput}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled || loading}
          className={`combobox-input ${disabled ? 'combobox-input-disabled' : ''} ${loading ? 'combobox-input-loading' : ''}`}
          aria-autocomplete="list"
          aria-expanded={showSuggestions}
        />
      </div>
      
      {loading && <div className="combobox-loading-indicator">Loading...</div>}
      
      {!loading && errorMessage && <div className="combobox-error-message">{errorMessage}</div>}

      {!loading && !errorMessage && showSuggestions && (
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
          {onReload && (
             <div className="combobox-footer">
                <button className="combobox-reload-button" onClick={onReload} disabled={loading} title="Reload model list">
                    {/* SVG for reload icon */}
                    Reload
                </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Combobox;
