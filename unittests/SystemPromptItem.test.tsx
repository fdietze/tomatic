/// <reference types="vitest/globals" />
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import SystemPromptItem from '../src/components/SystemPromptItem';
import { SystemPrompt } from '../src/types/storage';

const mockOnUpdate = vi.fn();
const mockOnRemove = vi.fn();
const mockOnCancel = vi.fn();

const mockPrompt: SystemPrompt = {
    name: 'test_prompt',
    prompt: 'This is a test prompt.',
};

const mockAllPrompts: SystemPrompt[] = [
    mockPrompt,
    { name: 'another_prompt', prompt: 'Another one.' },
];

const renderComponent = (props: Partial<React.ComponentProps<typeof SystemPromptItem>> = {}) => {
    const defaultProps = {
        prompt: mockPrompt,
        isInitiallyEditing: false,
        allPrompts: mockAllPrompts,
        onUpdate: mockOnUpdate,
        onRemove: mockOnRemove,
        onCancel: mockOnCancel,
    };
    return render(<SystemPromptItem {...defaultProps} {...props} />);
};

describe('SystemPromptItem', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // --- View Mode Tests ---
    describe('View Mode', () => {
        it('renders the prompt name and text', () => {
            renderComponent();
            expect(screen.getByText('test_prompt')).toBeInTheDocument();
            expect(screen.getByText('This is a test prompt.')).toBeInTheDocument();
        });

        it('has Edit and Delete buttons', () => {
            renderComponent();
            expect(screen.getByTestId('system-prompt-edit-button')).toBeInTheDocument();
            expect(screen.getByTestId('system-prompt-delete-button')).toBeInTheDocument();
        });

        it('calls onRemove when Delete button is clicked', () => {
            renderComponent();
            fireEvent.click(screen.getByTestId('system-prompt-delete-button'));
            expect(mockOnRemove).toHaveBeenCalledTimes(1);
        });

        it('switches to edit mode when Edit button is clicked', () => {
            renderComponent();
            fireEvent.click(screen.getByTestId('system-prompt-edit-button'));
            expect(screen.getByTestId('system-prompt-name-input')).toBeInTheDocument();
            expect(screen.getByTestId('system-prompt-save-button')).toBeInTheDocument();
        });
    });

    // --- Edit Mode Tests ---
    describe('Edit Mode', () => {
        it('renders in edit mode when isInitiallyEditing is true', () => {
            renderComponent({ isInitiallyEditing: true });
            expect(screen.getByTestId('system-prompt-name-input')).toBeInTheDocument();
            expect(screen.getByTestId('system-prompt-prompt-input')).toBeInTheDocument();
        });

        it('updates input fields on change', () => {
            renderComponent({ isInitiallyEditing: true });
            const nameInput = screen.getByTestId('system-prompt-name-input') as HTMLInputElement;
            const promptInput = screen.getByTestId('system-prompt-prompt-input') as HTMLTextAreaElement;

            fireEvent.change(nameInput, { target: { value: 'new_name' } });
            fireEvent.change(promptInput, { target: { value: 'new prompt text' } });

            expect(nameInput.value).toBe('new_name');
            expect(promptInput.value).toBe('new prompt text');
        });

        it('calls onUpdate with new data when Save is clicked', () => {
            renderComponent({ isInitiallyEditing: true });
            fireEvent.change(screen.getByTestId('system-prompt-name-input'), { target: { value: 'updated_prompt' } });
            fireEvent.change(screen.getByTestId('system-prompt-prompt-input'), { target: { value: 'Updated prompt text.' } });
            fireEvent.click(screen.getByTestId('system-prompt-save-button'));

            expect(mockOnUpdate).toHaveBeenCalledWith({
                name: 'updated_prompt',
                prompt: 'Updated prompt text.',
            });
            // It should switch back to view mode
            expect(screen.queryByTestId('system-prompt-name-input')).not.toBeInTheDocument();
        });

        it('calls onCancel when Cancel is clicked if isInitiallyEditing is true', () => {
            renderComponent({ isInitiallyEditing: true });
            fireEvent.click(screen.getByTestId('system-prompt-cancel-button'));
            expect(mockOnCancel).toHaveBeenCalledTimes(1);
        });

        it('reverts changes and exits edit mode when Cancel is clicked if not initially editing', () => {
            renderComponent();
            fireEvent.click(screen.getByTestId('system-prompt-edit-button')); // Enter edit mode

            // Make changes
            fireEvent.change(screen.getByTestId('system-prompt-name-input'), { target: { value: 'wont_be_saved' } });

            fireEvent.click(screen.getByTestId('system-prompt-cancel-button'));

            // Back in view mode with original data
            expect(screen.queryByTestId('system-prompt-name-input')).not.toBeInTheDocument();
            expect(screen.getByText('test_prompt')).toBeInTheDocument();
        });
    });

    // --- Validation Tests ---
    describe('Edit Mode Validation', () => {
        beforeEach(() => {
            renderComponent({ isInitiallyEditing: true });
        });

        it('shows an error if name is empty', () => {
            const nameInput = screen.getByTestId('system-prompt-name-input');
            fireEvent.change(nameInput, { target: { value: ' ' } });
            expect(screen.getByTestId('error-message')).toHaveTextContent('Name cannot be empty.');
            expect(screen.getByTestId('system-prompt-save-button')).toBeDisabled();
        });

        it('shows an error if name is a duplicate', () => {
            const nameInput = screen.getByTestId('system-prompt-name-input');
            fireEvent.change(nameInput, { target: { value: 'another_prompt' } });
            expect(screen.getByTestId('error-message')).toHaveTextContent('A prompt with this name already exists.');
            expect(screen.getByTestId('system-prompt-save-button')).toBeDisabled();
        });

        it('shows an error if name contains invalid characters', () => {
            const nameInput = screen.getByTestId('system-prompt-name-input');
            fireEvent.change(nameInput, { target: { value: 'invalid name!' } });
            expect(screen.getByTestId('error-message')).toHaveTextContent('Name can only contain alphanumeric characters and underscores.');
            expect(screen.getByTestId('system-prompt-save-button')).toBeDisabled();
        });

        it('does not save if there is a validation error', () => {
            const nameInput = screen.getByTestId('system-prompt-name-input');
            fireEvent.change(nameInput, { target: { value: '' } }); // Invalid name
            fireEvent.click(screen.getByTestId('system-prompt-save-button'));
            expect(mockOnUpdate).not.toHaveBeenCalled();
        });

        it('clears error when a valid name is entered', () => {
            const nameInput = screen.getByTestId('system-prompt-name-input');
            fireEvent.change(nameInput, { target: { value: ' ' } });
            expect(screen.getByTestId('error-message')).toBeInTheDocument();

            fireEvent.change(nameInput, { target: { value: 'a_valid_name' } });
            expect(screen.queryByTestId('error-message')).not.toBeInTheDocument();
            expect(screen.getByTestId('system-prompt-save-button')).not.toBeDisabled();
        });
    });
});
