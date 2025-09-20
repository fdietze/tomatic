/// <reference types="vitest/globals" />
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import Combobox, { ComboboxItem } from '../src/components/Combobox';

const mockItems: ComboboxItem[] = [
  { id: 'item1', display_text: 'First Item' },
  { id: 'item2', display_text: 'Second Item' },
  { id: 'item3', display_text: 'Third Item (different)' },
];

describe('Combobox', () => {
  test('renders with initial selected item', () => {
    render(<Combobox items={mockItems} selectedId="item1" onSelect={() => {}} />);
    const input = screen.getByTestId('model-combobox-input') as HTMLInputElement;
    expect(input.value).toBe('First Item');
  });

  test('opens suggestions on focus', () => {
    render(<Combobox items={mockItems} selectedId="item1" onSelect={() => {}} />);
    const input = screen.getByTestId('model-combobox-input');
    
    // Suggestions should not be visible initially
    expect(screen.queryByText('First Item')).not.toBeInTheDocument();

    fireEvent.focus(input);
    // On focus, the input is cleared, and all items should become visible.
    expect(screen.getByText('First Item')).toBeInTheDocument();
    expect(screen.getByText('Second Item')).toBeInTheDocument();
  });

  test('filters items based on search query', () => {
    render(<Combobox items={mockItems} selectedId="" onSelect={() => {}} />);
    const input = screen.getByTestId('model-combobox-input');
    fireEvent.change(input, { target: { value: 'Second' } });
    expect(screen.getByText('Second Item')).toBeInTheDocument();
    expect(screen.queryByText('First Item')).not.toBeInTheDocument();
  });

  test('shows "no results found" when no items match', () => {
    render(<Combobox items={mockItems} selectedId="" onSelect={() => {}} />);
    const input = screen.getByTestId('model-combobox-input');
    fireEvent.change(input, { target: { value: 'nonexistent' } });
    expect(screen.getByText('No results found')).toBeInTheDocument();
  });

  test('selects an item on click', () => {
    const handleSelect = vi.fn();
    render(<Combobox items={mockItems} selectedId="" onSelect={handleSelect} />);
    const input = screen.getByTestId('model-combobox-input');
    fireEvent.focus(input);
    const itemToSelect = screen.getByText('Second Item');
    fireEvent.click(itemToSelect);
    expect(handleSelect).toHaveBeenCalledWith('item2');
  });

  test('hides suggestions after selecting an item', () => {
    render(<Combobox items={mockItems} selectedId="" onSelect={() => {}} />);
    const input = screen.getByTestId('model-combobox-input');
    fireEvent.focus(input);
    const itemToSelect = screen.getByText('Second Item');
    fireEvent.click(itemToSelect);
    expect(screen.queryByText('First Item')).not.toBeInTheDocument();
  });

  test('navigates suggestions with arrow keys and selects with Enter', () => {
    const handleSelect = vi.fn();
    render(<Combobox items={mockItems} selectedId="" onSelect={handleSelect} />);
    const input = screen.getByTestId('model-combobox-input');
    fireEvent.focus(input);

    // Navigate down to the second item
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // highlighted: item1
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // highlighted: item2

    // Select the highlighted item
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(handleSelect).toHaveBeenCalledWith('item2');
  });

  test('selects the only filtered item with Enter', () => {
    const handleSelect = vi.fn();
    render(<Combobox items={mockItems} selectedId="" onSelect={handleSelect} />);
    const input = screen.getByTestId('model-combobox-input');
    fireEvent.change(input, { target: { value: 'different' } });

    // Press Enter to select the only visible item
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(handleSelect).toHaveBeenCalledWith('item3');
  });

  test('selects exact match with Enter key', () => {
    const handleSelect = vi.fn();
    render(<Combobox items={mockItems} selectedId="" onSelect={handleSelect} />);
    const input = screen.getByTestId('model-combobox-input');
    // With the fix, suggestions are shown immediately if items are present
    fireEvent.focus(input);
    
    fireEvent.change(input, { target: { value: 'item2' } });
    // Suggestions are now visible and filtered
    expect(screen.getByText('Second Item')).toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(handleSelect).toHaveBeenCalledWith('item2');
  });

  test('closes suggestions on Escape key and restores value', async () => {
    render(<Combobox items={mockItems} selectedId="item1" onSelect={() => {}} />);
    const input = screen.getByTestId('model-combobox-input') as HTMLInputElement;

    // Open and type
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'some query' } });
    
    // Escape
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByText('First Item')).not.toBeInTheDocument();
    expect(input.value).toBe('First Item'); // Value restored
  });

  test('reloads items when reload button is clicked', () => {
    const handleReload = vi.fn();
    render(<Combobox items={mockItems} selectedId="" onSelect={() => {}} onReload={handleReload} />);
    const reloadButton = screen.getByTestId('reload-models-button');
    fireEvent.click(reloadButton);
    expect(handleReload).toHaveBeenCalledTimes(1);
  });

  test('is disabled when disabled prop is true', () => {
    render(<Combobox items={mockItems} selectedId="item1" onSelect={() => {}} disabled />);
    const input = screen.getByTestId('model-combobox-input') as HTMLInputElement;
    expect(input).toBeDisabled();
  });

  test('shows loading state', () => {
    render(<Combobox items={mockItems} selectedId="item1" onSelect={() => {}} loading />);
    const input = screen.getByTestId('model-combobox-input') as HTMLInputElement;
    expect(input).toBeDisabled();
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  test('shows error message', () => {
    render(<Combobox items={mockItems} selectedId="item1" onSelect={() => {}} errorMessage="Network error" />);
    expect(screen.getByText('Network error')).toBeInTheDocument();
  });

  test('clears input on focus to start a new search', () => {
    render(<Combobox items={mockItems} selectedId="item1" onSelect={() => {}} />);
    const input = screen.getByTestId('model-combobox-input') as HTMLInputElement;
    expect(input.value).toBe('First Item');
    fireEvent.focus(input);
    expect(input.value).toBe('');
  });

  test('restores original value on click outside if nothing is selected', () => {
    render(<Combobox items={mockItems} selectedId="item1" onSelect={() => {}} />);
    const input = screen.getByTestId('model-combobox-input') as HTMLInputElement;
    
    // Type something
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'some other query' } });
    expect(input.value).toBe('some other query');

    // Click away
    render(<div data-testid="outside-element"></div>, { container: document.body });

    fireEvent.mouseDown(screen.getByTestId('outside-element')); // Simulate click outside
    expect(input.value).toBe('First Item');
    expect(screen.queryByText('First Item')).not.toBeInTheDocument(); // Suggestions closed
  });

  test('updates suggestions when items prop changes asynchronously', () => {
    const { rerender } = render(<Combobox items={[]} selectedId="" onSelect={() => {}} loading />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expect(screen.queryByText('First Item')).not.toBeInTheDocument();

    rerender(<Combobox items={mockItems} selectedId="" onSelect={() => {}} loading={false} />);

    // To see the suggestions, the user must interact with the combobox first
    const input = screen.getByTestId('model-combobox-input');
    fireEvent.focus(input);

    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    expect(screen.getByText('First Item')).toBeInTheDocument();
    expect(screen.getByText('Second Item')).toBeInTheDocument();
  });
});
