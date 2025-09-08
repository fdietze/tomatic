import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/store/appStore';
import ChatMessage from './ChatMessage';
import ChatControls from './ChatControls';
import Combobox, { ComboboxItem } from './Combobox';
import { useShallow } from 'zustand/react/shallow';
import { isMobile as checkIsMobile } from '@/utils/isMobile';

const ChatInterface: React.FC = () => {
    const historyRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    // State to hold the mobile status, checked once on mount.
    const [isMobile, setIsMobile] = useState(false);
    useEffect(() => {
        setIsMobile(checkIsMobile());
    }, []);

    const navigate = useNavigate();

    const {
        messages,
        input,
        setInput,
        isStreaming,
        error,
        modelName,
        setModelName,
        cachedModels,
        modelsLoading,
        modelsError,
        apiKey,
    } = useAppStore(
        useShallow((state) => ({
            messages: state.messages,
            input: state.input,
            setInput: state.setInput,
            isStreaming: state.isStreaming,
            error: state.error,
            modelName: state.modelName,
            setModelName: state.setModelName,
            cachedModels: state.cachedModels,
            modelsLoading: state.modelsLoading,
            modelsError: state.modelsError,
            apiKey: state.apiKey,
        }))
    );
    
    const { 
        submitMessage,
        regenerateMessage,
        editAndResubmitMessage,
        cancelStream,
        fetchModelList, 
        setSelectedPromptName,
        systemPrompts,
    } = useAppStore();

    // Scroll to the bottom of the chat history when new messages are added.
    useEffect(() => {
        if (historyRef.current) {
            historyRef.current.scrollTop = historyRef.current.scrollHeight;
        }
    }, [messages]);

    // Fetch models if the cache is empty and an API key is present.
    useEffect(() => {
        if (cachedModels.length === 0 && apiKey) {
            fetchModelList();
        }
    }, [apiKey, cachedModels.length, fetchModelList]);

    // Effect to handle @mention system prompts in the input
    useEffect(() => {
        const match = input.match(/@(\w+)/);
        if (match) {
            const promptName = match[1];
            const mentionedPrompt = systemPrompts.find(p => p.name === promptName);
            if (mentionedPrompt) {
                setSelectedPromptName(promptName);
            }
        }
    }, [input, systemPrompts, setSelectedPromptName]);

    // Effect to handle the initial prompt from the URL
    useEffect(() => {
        const { initialChatPrompt, setInitialChatPrompt } = useAppStore.getState();
        if (initialChatPrompt && messages.length === 0 && !isStreaming) {
            submitMessage({ promptOverride: initialChatPrompt, navigate });
            setInitialChatPrompt(null); // Consume the prompt
        }
    }, [messages.length, isStreaming, submitMessage, navigate]);

    // Auto-focus the input on load
    useEffect(() => {
        inputRef.current?.focus();
    }, []);


    const modelComboboxItems = useMemo((): ComboboxItem[] => {
        return cachedModels.map((model) => {
            const priceDisplay = 
                (model.prompt_cost_usd_pm !== null && model.completion_cost_usd_pm !== null)
                ? `in: ${model.prompt_cost_usd_pm.toFixed(2)}$ out: ${model.completion_cost_usd_pm.toFixed(2)}$/MTok`
                : '';
            
            const text = `${model.name} ${priceDisplay}`;
            const html = `
                <div style='display: flex; justify-content: space-between; align-items: center; width: 100%; gap: 1em;'>
                    <span style='white-space: nowrap; flex-shrink: 0'>${model.name}</span>
                    <span class='model-price' style='white-space: pre; text-align: right; overflow: hidden; flex-shrink: 1'>${priceDisplay}</span>
                </div>`;

            return {
                id: model.id,
                display_text: text,
                display_html: priceDisplay ? html : undefined,
                model_info: model,
            };
        });
    }, [cachedModels]);

    const handleRegenerate = (index: number) => {
        regenerateMessage(index);
    };

    const handleEditAndResubmit = (index: number, newContent: string) => {
        editAndResubmitMessage(index, newContent);
    };

    const handleSubmit = (promptOverride?: string) => {
        submitMessage({ promptOverride, navigate });
    };

    const handleCancel = () => {
        cancelStream();
    };


    return (
        <div className="chat-interface">
            <div className="chat-history" ref={historyRef}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px', borderBottom: '1px solid var(--border-color)', backgroundColor: 'var(--background-secondary-color)', position: 'sticky', top: 0, zIndex: 10 }}>
                    <div style={{ flexGrow: 1 }}>
                        <Combobox
                            items={modelComboboxItems}
                            selectedId={modelName}
                            onSelect={setModelName}
                            placeholder="Select or type model ID (e.g. openai/gpt-4o)"
                            loading={modelsLoading}
                            onReload={fetchModelList}
                            errorMessage={modelsError}
                            disabled={!apiKey}
                        />
                    </div>
                </div>

                {messages.map((message, index) => (
                    <ChatMessage
                        key={message.id} // Note: Using index is not ideal if messages can be deleted/inserted.
                        message={message}
                        messageIndex={index}
                        onRegenerate={handleRegenerate}
                        onEditAndResubmit={handleEditAndResubmit}
                        isMobile={isMobile}
                    />
                ))}

                {error && (
                    <div className="error-box">
                        <div style={{ fontWeight: 'bold' }}>error</div>
                        {error}
                    </div>
                )}
            </div>
            <ChatControls
                input={input}
                setInput={setInput}
                isStreaming={isStreaming}
                onSubmit={handleSubmit}
                onCancel={handleCancel}
                isMobile={isMobile}
                inputRef={inputRef}
            />
        </div>
    );
};

export default ChatInterface;
