/// <reference types="vitest/globals" />
import { render, screen, fireEvent, act } from '@testing-library/react';
import { vi } from 'vitest';
import SnippetItem from '../src/components/SnippetItem';
import { Snippet } from '../src/types/storage';
import { GlobalStateContext } from '../src/context/GlobalStateContext';
import { createActor } from 'xstate';

// Mock child components
vi.mock('../src/components/Markdown', () => ({
    default: ({ markdownText }: { markdownText: string }) => <div data-testid="markdown-mock">{markdownText}</div>
}));
vi.mock('../src/components/Combobox', () => ({
    default: (props: any) => <div data-testid="combobox-mock" onClick={() => props.onSelect('mock-model-id')} />
}));


const mockOnUpdate = vi.fn().mockResolvedValue(undefined);
const mockOnRemove = vi.fn().mockResolvedValue(undefined);
const mockOnCancel = vi.fn();

const mockSnippets: Snippet[] = [
    { name: 'snippet1', content: 'content1', isGenerated: false, createdAt_ms: 0, updatedAt_ms: 0, generationError: null, isDirty: false },
    { name: 'snippet2', content: 'content2 references @snippet1', isGenerated: false, createdAt_ms: 0, updatedAt_ms: 0, generationError: null, isDirty: false },
];

const mockGlobalState = {
    modelsActor: createActor(vi.fn() as any, { snapshot: { context: { cachedModels: [] } } as any }),
    snippetsActor: createActor(vi.fn() as any, { snapshot: { context: { regeneratingSnippetNames: [] } } as any }),
    settingsActor: createActor(vi.fn() as any, { snapshot: { context: { modelName: 'default-model' } } as any }),
    promptsActor: createActor(vi.fn() as any, { snapshot: { context: {} } } as any),
    sessionActor: createActor(vi.fn() as any, { snapshot: { context: {} } } as any),
};

type SnippetItemTestProps = Partial<React.ComponentProps<typeof SnippetItem>>;

const renderComponent = (
    props: SnippetItemTestProps = {},
    globalState = mockGlobalState
) => {
    const snippet = props.snippet ?? mockSnippets[0];
    if (!snippet) {
        throw new Error("Test setup error: No snippet provided and mockSnippets is empty.");
    }

    const defaultProps: Omit<React.ComponentProps<typeof SnippetItem>, 'snippet'> = {
        isInitiallyEditing: false,
        allSnippets: mockSnippets,
        onUpdate: mockOnUpdate,
        onRemove: mockOnRemove,
        onCancel: mockOnCancel,
    };
    
    const finalProps = { ...defaultProps, ...props, snippet };

    return render(
        <GlobalStateContext.Provider value={globalState}>
            <SnippetItem {...finalProps} />
        </GlobalStateContext.Provider>
    );
};

describe('SnippetItem', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // --- View Mode ---
    describe('View Mode', () => {
        it('renders snippet name and content', () => {
            renderComponent();
            expect(screen.getByText('snippet1')).toBeInTheDocument();
            expect(screen.getByText('content1')).toBeInTheDocument();
        });

        it('switches to edit mode on "Edit" click', () => {
            renderComponent();
            fireEvent.click(screen.getByTestId('snippet-edit-button'));
            expect(screen.getByTestId('snippet-name-input')).toBeInTheDocument();
        });

        it('calls onRemove on "Delete" click', async () => {
            renderComponent();
            fireEvent.click(screen.getByTestId('snippet-delete-button'));
            await act(async () => {
                expect(mockOnRemove).toHaveBeenCalledTimes(1);
            });
        });

        it('shows spinner when regenerating', () => {
            const regeneratingState = {
                ...mockGlobalState,
                snippetsActor: createActor(vi.fn() as any, { snapshot: { context: { regeneratingSnippetNames: ['snippet1'] } } as any }),
            };
            renderComponent({}, regeneratingState);
            expect(screen.getByTestId('regenerating-spinner')).toBeInTheDocument();
            expect(screen.getByTestId('snippet-edit-button')).toBeDisabled();
        });
    });

    // --- Edit Mode ---
    describe('Edit Mode', () => {
        it('renders in edit mode when isInitiallyEditing is true', () => {
            renderComponent({ isInitiallyEditing: true });
            expect(screen.getByTestId('snippet-name-input')).toBeInTheDocument();
            expect(screen.getByTestId('snippet-content-input')).toBeInTheDocument();
        });

        it('toggles generated snippet fields', () => {
            renderComponent({ isInitiallyEditing: true });
            const checkbox = screen.getByTestId('snippet-generated-checkbox');

            // Initially not generated
            expect(screen.queryByTestId('snippet-prompt-input')).not.toBeInTheDocument();
            expect(screen.queryByTestId('combobox-mock')).not.toBeInTheDocument();

            // Check to make it generated
            fireEvent.click(checkbox);
            expect(screen.getByTestId('snippet-prompt-input')).toBeInTheDocument();
            expect(screen.getByTestId('combobox-mock')).toBeInTheDocument();
            expect(screen.getByTestId('snippet-content-display')).toBeInTheDocument(); // Content is now read-only

            // Uncheck to make it not generated
            fireEvent.click(checkbox);
            expect(screen.queryByTestId('snippet-prompt-input')).not.toBeInTheDocument();
            expect(screen.getByTestId('snippet-content-input')).toBeInTheDocument(); // Content is now editable
        });

        it('calls onUpdate with new data on "Save" click', async () => {
            renderComponent({ isInitiallyEditing: true });
            fireEvent.change(screen.getByTestId('snippet-name-input'), { target: { value: 'newName' } });
            fireEvent.change(screen.getByTestId('snippet-content-input'), { target: { value: 'newContent' } });
            
            await act(async () => {
                fireEvent.click(screen.getByTestId('snippet-save-button'));
            });

            expect(mockOnUpdate).toHaveBeenCalledWith(expect.objectContaining({
                name: 'newName',
                content: 'newContent',
                isGenerated: false,
            }));
        });

        it('calls onCancel for new snippets', () => {
            renderComponent({ isInitiallyEditing: true });
            fireEvent.click(screen.getByTestId('snippet-cancel-button'));
            expect(mockOnCancel).toHaveBeenCalledTimes(1);
        });

        it('reverts changes on "Cancel" for existing snippets', () => {
            renderComponent();
            fireEvent.click(screen.getByTestId('snippet-edit-button')); // enter edit mode
            fireEvent.change(screen.getByTestId('snippet-name-input'), { target: { value: 'tempName' } });
            fireEvent.click(screen.getByTestId('snippet-cancel-button'));

            expect(screen.queryByTestId('snippet-name-input')).not.toBeInTheDocument();
            expect(screen.getByText('snippet1')).toBeInTheDocument();
        });
    });

    // --- Validation ---
    describe('Validation', () => {
        it('shows error for duplicate snippet name', () => {
            renderComponent({ isInitiallyEditing: true });
            fireEvent.change(screen.getByTestId('snippet-name-input'), { target: { value: 'snippet2' } });
            expect(screen.getByTestId('error-message')).toHaveTextContent('A snippet with this name already exists.');
            expect(screen.getByTestId('snippet-save-button')).toBeDisabled();
        });

        it('shows error for circular dependency', () => {
            const circularSnippets: Snippet[] = [
                { name: 'snippetA', content: 'calls @snippetB', isGenerated: false, createdAt_ms: 0, updatedAt_ms: 0, generationError: null, isDirty: false },
                { name: 'snippetB', content: 'calls @snippetA', isGenerated: false, createdAt_ms: 0, updatedAt_ms: 0, generationError: null, isDirty: false },
            ];
            renderComponent({
                snippet: circularSnippets[0],
                allSnippets: circularSnippets,
                isInitiallyEditing: true
            });

            fireEvent.change(screen.getByTestId('snippet-content-input'), { target: { value: 'calls @snippetB' } });
            expect(screen.getByTestId('prompt-error-message')).toHaveTextContent(/Snippet cycle detected/);
        });

        it('shows warning for non-existent snippet', () => {
            renderComponent({ isInitiallyEditing: true });
            fireEvent.change(screen.getByTestId('snippet-content-input'), { target: { value: 'calls @nonExistent' } });
            expect(screen.getByTestId('prompt-error-message')).toHaveTextContent("Warning: Snippet '@nonExistent' not found.");
        });
    });
});
