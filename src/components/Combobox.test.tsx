import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';

import Combobox, { type ComboboxItem } from './Combobox';
import settingsReducer, { setModelName, type SettingsState } from '@/store/features/settings/settingsSlice';

// Mock data for the tests
const mockItems: ComboboxItem[] = [
  { id: 'item-1', display_text: 'First Item' },
  { id: 'item-2', display_text: 'Second Item' },
  { id: 'item-3', display_text: 'Third Item' },
  { id: 'item-4', display_text: 'Unique Item' },
];

const mockItemsWithHtml: ComboboxItem[] = [
    { id: 'html-1', display_text: 'HTML Item', display_html: '<span>HTML Item</span>' },
]

// Default props for the Combobox
const defaultProps = {
  items: mockItems,
  selectedId: 'item-1',
  onSelect: vi.fn(),
  placeholder: 'Select an item...',
  disabled: false,
  loading: false,
  errorMessage: null,
  label: 'Test Combobox',
};

// Helper to render the component
const renderCombobox = (props = {}) => {
  const combinedProps = { ...defaultProps, ...props };
  return render(<Combobox {...combinedProps} />);
};

describe('Combobox Component', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // --- Rendering and Display Tests ---
    describe('Rendering and Display', () => {
        it('should render correctly with initial props', () => {
            // Purpose: Verifies that the component renders the label, input with the selected item's text, and is not initially showing suggestions.
            renderCombobox();
            expect(screen.getByLabelText('Test Combobox')).toBeInTheDocument();
            expect(screen.getByPlaceholderText('Select an item...')).toHaveValue('First Item');
            expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
        });

        it('should display a loading indicator when loading', () => {
            // Purpose: Checks that the loading state is correctly displayed and the input is disabled.
            renderCombobox({ loading: true });
            expect(screen.getByText('Loading...')).toBeInTheDocument();
            expect(screen.getByLabelText('Test Combobox')).toBeDisabled();
        });

        it('should display an error message when an error is present', () => {
            // Purpose: Ensures error messages are shown to the user when passed via props.
            const errorMessage = { type: 'UNKNOWN_ERROR' as const, message: 'Something went wrong' };
            renderCombobox({ errorMessage });
            expect(screen.getByText('Unknown Error: Something went wrong')).toBeInTheDocument();
        });

        it('should show "No results found" when filtering yields no items', async () => {
            // Purpose: Verifies the feedback for an unsuccessful search.
            const user = userEvent.setup();
            renderCombobox();
            const input = screen.getByLabelText('Test Combobox');
            await user.click(input);
            await user.type(input, 'nonexistent');
            expect(screen.getByText('No results found')).toBeInTheDocument();
        });

        it('should correctly render HTML in suggestion items', async () => {
            // Purpose: Checks that items with `display_html` are rendered as HTML, not plain text.
            const user = userEvent.setup();
            renderCombobox({ items: mockItemsWithHtml, selectedId: 'html-1' });
            const input = screen.getByLabelText('Test Combobox');
            await user.click(input);
            const item = screen.getByTestId('model-combobox-item-html-1');
            expect(item.querySelector('span')).toHaveTextContent('HTML Item');
        });
    });

    // --- User Interaction Tests ---
    describe('User Interaction', () => {
        it('should show suggestions on input focus and hide on click outside', async () => {
            // Purpose: Tests the core visibility logic of the suggestions list.
            const user = userEvent.setup();
            renderCombobox();

            const input = screen.getByLabelText('Test Combobox');
            await user.click(input);
            expect(screen.getByRole('listbox')).toBeInTheDocument();

            // Click outside the component to close it
            fireEvent.mouseDown(document.body);
            expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
        });

        it('should filter items based on user input', async () => {
            // Purpose: Verifies that the suggestion list is dynamically filtered as the user types.
            const user = userEvent.setup();
            renderCombobox();
            const input = screen.getByLabelText('Test Combobox');

            await user.click(input);
            expect(screen.getAllByRole('option')).toHaveLength(mockItems.length);

            await user.type(input, 'Unique');
            const options = screen.getAllByRole('option');
            expect(options).toHaveLength(1);
            expect(options[0]).toHaveTextContent('Unique Item');
        });

        it('should call onSelect when an item is clicked', async () => {
            // Purpose: Ensures the primary selection mechanism (clicking) works as expected.
            const user = userEvent.setup();
            renderCombobox();
            const input = screen.getByLabelText('Test Combobox');
            await user.click(input);

            const secondItem = screen.getByText('Second Item');
            await user.click(secondItem);

            expect(defaultProps.onSelect).toHaveBeenCalledWith('item-2');
            expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
        });

        it('should navigate suggestions with arrow keys and select with Enter', async () => {
            // Purpose: Tests keyboard accessibility for navigating and selecting items.
            const user = userEvent.setup();
            renderCombobox();
            const input = screen.getByLabelText('Test Combobox');

            await user.click(input);

            // Navigate down
            await user.keyboard('{ArrowDown}'); // highlighted: item-1 (index 0)
            await user.keyboard('{ArrowDown}'); // highlighted: item-2 (index 1)

            let highlightedItem = screen.getByRole('option', { selected: true });
            expect(highlightedItem).toHaveTextContent('Second Item');

            // Navigate up
            await user.keyboard('{ArrowUp}'); // highlighted: item-1 (index 0)
            highlightedItem = screen.getByRole('option', { selected: true });
            expect(highlightedItem).toHaveTextContent('First Item');

            // Select with Enter
            await user.keyboard('{Enter}');
            expect(defaultProps.onSelect).toHaveBeenCalledWith('item-1');
            expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
        });

        it('should wrap keyboard navigation', async () => {
            // Purpose: Ensures keyboard navigation loops from the last item to the first and vice versa.
            const user = userEvent.setup();
            renderCombobox();
            const input = screen.getByLabelText('Test Combobox');

            await user.click(input);

            // Go to the last item
            await user.keyboard('{ArrowUp}');
            let highlightedItem = screen.getByRole('option', { selected: true });
            expect(highlightedItem).toHaveTextContent('Unique Item');

            // Wrap to the first item
            await user.keyboard('{ArrowDown}');
            highlightedItem = screen.getByRole('option', { selected: true });
            expect(highlightedItem).toHaveTextContent('First Item');
        });

        it('should hide suggestions on Escape key press', async () => {
            // Purpose: Verifies the "cancel" behavior using the Escape key.
            const user = userEvent.setup();
            renderCombobox();
            const input = screen.getByLabelText('Test Combobox');
            await user.click(input);
            expect(screen.getByRole('listbox')).toBeInTheDocument();

            await user.keyboard('{Escape}');
            expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
        });
    });

    // --- Store Interaction Test ---
    describe('Redux Store Interaction', () => {
        it('should dispatch setModelName action when used as a model selector', async () => {
            // Purpose: This integration test ensures the component correctly dispatches actions to the Redux store when a selection is made.

            // 1. Setup mock store
            const mockStore = configureStore({
                reducer: {
                    settings: settingsReducer
                },
                preloadedState: {
                    settings: {
                        modelName: 'item-1',
                        apiKey: '',
                        autoScrollEnabled: true,
                        selectedPromptName: null,
                        initialChatPrompt: null,
                        loading: 'idle',
                        saving: 'idle',
                    } satisfies SettingsState
                }
            });
            const dispatchSpy = vi.spyOn(mockStore, 'dispatch');
            const user = userEvent.setup();

            // 2. Render with Provider
            render(
                <Provider store={mockStore}>
                    <Combobox
                        items={mockItems}
                        selectedId="item-1"
                        onSelect={(id) => mockStore.dispatch(setModelName(id))}
                        label="Model Selector"
                    />
                </Provider>
            );

            // 3. Action
            const input = screen.getByLabelText('Model Selector');
            await user.click(input);
            await user.click(screen.getByText('Third Item'));

            // 4. Assertion
            expect(dispatchSpy).toHaveBeenCalledTimes(1);
            expect(dispatchSpy).toHaveBeenCalledWith(setModelName('item-3'));
        });
    });
});
