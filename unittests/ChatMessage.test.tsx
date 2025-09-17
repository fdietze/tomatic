/// <reference types="vitest/globals" />
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import ChatMessage from '../src/components/ChatMessage';
import { Message } from '../src/types/chat';

// Mock child components
vi.mock('../src/components/Markdown', () => ({
    default: ({ markdownText }: { markdownText: string }) => <div data-testid="markdown-mock">{markdownText}</div>
}));

const mockOnRegenerate = vi.fn();
const mockOnEditAndResubmit = vi.fn();

const baseMessage: Omit<Message, 'role' | 'content'> = {
    id: '123',
    cost: null,
};

const userMessage: Message = {
    ...baseMessage,
    role: 'user',
    content: 'Hello, world!',
};

const assistantMessage: Message = {
    ...baseMessage,
    id: '456',
    role: 'assistant',
    content: 'Hello, I am an assistant.',
    model_name: 'test-model',
};

const systemMessage: Message = {
    ...baseMessage,
    id: '789',
    role: 'system',
    content: 'System prompt content.',
    prompt_name: 'test-prompt',
};

const renderComponent = (props: Partial<React.ComponentProps<typeof ChatMessage>> = {}) => {
    const defaultProps = {
        message: userMessage,
        messageIndex: 0,
        onRegenerate: mockOnRegenerate,
        onEditAndResubmit: mockOnEditAndResubmit,
        isMobile: false,
    };
    return render(<ChatMessage {...defaultProps} {...props} />);
};

describe('ChatMessage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // --- Rendering Tests ---

    test('renders user message correctly', () => {
        renderComponent({ message: userMessage });
        expect(screen.getByTestId('chat-message-0')).toHaveAttribute('data-role', 'user');
        expect(screen.getByText('user')).toBeInTheDocument();
        expect(screen.getByTestId('markdown-mock')).toHaveTextContent('Hello, world!');
        expect(screen.getByTestId('edit-button')).toBeInTheDocument();
    });

    test('renders assistant message correctly', () => {
        renderComponent({ message: assistantMessage });
        expect(screen.getByTestId('chat-message-0')).toHaveAttribute('data-role', 'assistant');
        expect(screen.getByText('assistant (test-model)')).toBeInTheDocument();
        expect(screen.getByTestId('markdown-mock')).toHaveTextContent('Hello, I am an assistant.');
        expect(screen.getByTestId('regenerate-button')).toBeInTheDocument();
    });

    test('renders system message correctly and is collapsed by default', () => {
        renderComponent({ message: systemMessage });
        expect(screen.getByTestId('chat-message-0')).toHaveAttribute('data-role', 'system');
        expect(screen.getByText('▶ system @test-prompt')).toBeInTheDocument();
        expect(screen.getByTestId('chat-message-0')).toHaveClass('collapsed');
    });

    test('renders cost information when available', () => {
        const messageWithCost: Message = {
            ...assistantMessage,
            cost: { prompt: 0.001, completion: 0.002, prompt_tokens: 10, completion_tokens: 20 },
        };
        renderComponent({ message: messageWithCost });
        expect(screen.getByText(/prompt:/)).toBeInTheDocument();
        expect(screen.getByText(/completion:/)).toBeInTheDocument();
        expect(screen.getByText(/total:/)).toBeInTheDocument();
        expect(screen.getByText(/(10 tokens)/)).toBeInTheDocument();
        expect(screen.getByText(/(20 tokens)/)).toBeInTheDocument();
        expect(screen.getByText(/(30 tokens)/)).toBeInTheDocument();
    });

    // --- Interaction Tests ---

    test('toggles collapsed state for system messages on click', () => {
        renderComponent({ message: systemMessage });
        const messageDiv = screen.getByTestId('chat-message-0');
        const headerDiv = screen.getByText('▶ system @test-prompt').parentElement!;

        expect(messageDiv).toHaveClass('collapsed');

        fireEvent.click(headerDiv);
        expect(messageDiv).not.toHaveClass('collapsed');
        expect(screen.getByText('▼ system @test-prompt')).toBeInTheDocument();

        fireEvent.click(headerDiv);
        expect(messageDiv).toHaveClass('collapsed');
        expect(screen.getByText('▶ system @test-prompt')).toBeInTheDocument();
    });

    test('calls onRegenerate when regenerate button is clicked', () => {
        renderComponent({ message: assistantMessage, messageIndex: 5 });
        fireEvent.click(screen.getByTestId('regenerate-button'));
        expect(mockOnRegenerate).toHaveBeenCalledWith(5);
    });

    describe('Editing User Message', () => {
        beforeEach(() => {
            renderComponent({ message: userMessage, messageIndex: 3 });
        });

        test('enters editing mode when edit button is clicked', () => {
            fireEvent.click(screen.getByTestId('edit-button'));
            expect(screen.getByTestId('edit-textarea')).toBeInTheDocument();
            expect(screen.getByTestId('resubmit-button')).toBeInTheDocument();
            expect(screen.getByTestId('discard-edit-button')).toBeInTheDocument();
            expect(screen.queryByTestId('markdown-mock')).not.toBeInTheDocument();
        });

        test('textarea value changes on input', () => {
            fireEvent.click(screen.getByTestId('edit-button'));
            const textarea = screen.getByTestId('edit-textarea') as HTMLTextAreaElement;
            fireEvent.input(textarea, { target: { value: 'new content' } });
            expect(textarea.value).toBe('new content');
        });

        test('calls onEditAndResubmit with new content on re-submit', () => {
            fireEvent.click(screen.getByTestId('edit-button'));
            fireEvent.input(screen.getByTestId('edit-textarea'), { target: { value: 'updated message' } });
            fireEvent.click(screen.getByTestId('resubmit-button'));

            expect(mockOnEditAndResubmit).toHaveBeenCalledWith(3, 'updated message');
            expect(screen.queryByTestId('edit-textarea')).not.toBeInTheDocument(); // Exits editing mode
        });

        test('exits editing mode and discards changes on discard', () => {
            fireEvent.click(screen.getByTestId('edit-button'));
            fireEvent.input(screen.getByTestId('edit-textarea'), { target: { value: 'a change that will be discarded' } });
            fireEvent.click(screen.getByTestId('discard-edit-button'));
            
            expect(screen.queryByTestId('edit-textarea')).not.toBeInTheDocument();
            expect(screen.getByTestId('markdown-mock')).toHaveTextContent(userMessage.content); // Original content
        });
    });
});
