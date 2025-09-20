/// <reference types="vitest/globals" />
import { render, screen, fireEvent, act } from '@testing-library/react';
import { vi, type MockInstance } from 'vitest';
import CopyButton from '../src/components/CopyButton';

const MOCK_TEXT = 'text to copy';

describe('CopyButton', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        Object.defineProperty(navigator, 'clipboard', {
            value: {
                writeText: vi.fn().mockResolvedValue(undefined),
            },
            writable: true,
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        // @ts-ignore
        navigator.clipboard = undefined;
    });

    test('renders with initial "copy" text', () => {
        render(<CopyButton textToCopy={MOCK_TEXT} />);
        expect(screen.getByRole('button')).toHaveTextContent('copy');
    });

    test('shows "copied" text after successful copy', async () => {
        render(<CopyButton textToCopy={MOCK_TEXT} />);
        const button = screen.getByRole('button');
        
        await act(async () => {
            fireEvent.click(button);
        });

        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(MOCK_TEXT);
        expect(button).toHaveTextContent('copied');
    });

    test('resets to "copy" text after feedback duration', async () => {
        render(<CopyButton textToCopy={MOCK_TEXT} />);
        const button = screen.getByRole('button');
        
        await act(async () => {
            fireEvent.click(button);
        });

        expect(button).toHaveTextContent('copied');

        act(() => {
            vi.advanceTimersByTime(1500);
        });

        expect(button).toHaveTextContent('copy');
    });

    describe('when copy fails', () => {
        let consoleErrorSpy: MockInstance;

        beforeEach(() => {
            // @ts-ignore
            navigator.clipboard.writeText.mockRejectedValue(new Error('Copy failed'));
            // Override console.error mock for this suite to prevent throwing
            consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        });
    
        afterEach(() => {
            // Restore original console.error mock
            consoleErrorSpy.mockRestore();
        });

        test('shows "failed" text after failed copy', async () => {
            render(<CopyButton textToCopy={MOCK_TEXT} />);
            const button = screen.getByRole('button');
    
            await act(async () => {
                fireEvent.click(button);
            });
            
            expect(button).toHaveTextContent('failed');
        });
    
        test('resets to "copy" text after failed copy and duration', async () => {
            render(<CopyButton textToCopy={MOCK_TEXT} />);
            const button = screen.getByRole('button');
            
            await act(async () => {
                fireEvent.click(button);
            });
    
            expect(button).toHaveTextContent('failed');
    
            act(() => {
                vi.advanceTimersByTime(1500);
            });
    
            expect(button).toHaveTextContent('copy');
        });
    });

    test('does not copy when textToCopy is empty', async () => {
        render(<CopyButton textToCopy="" />);
        const button = screen.getByRole('button');
        
        await act(async () => {
            fireEvent.click(button);
        });

        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
        expect(button).toHaveTextContent('copy');
    });
});
