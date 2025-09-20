import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector } from '@xstate/react';
import { DisplayModelInfo, SystemPrompt } from '@/types/storage';
import ChatMessage from './ChatMessage';
import ChatControls from './ChatControls';
import Combobox, { ComboboxItem } from './Combobox';
import { isMobile as checkIsMobile } from '@/utils/isMobile';
import { useGlobalState } from '@/context/GlobalStateContext';
import { ModelsSnapshot } from '@/machines/modelsMachine';
import { SessionSnapshot } from '@/machines/sessionMachine';
import { SettingsSnapshot } from '@/machines/settingsMachine';

interface ChatInterfaceContentsProps {
    systemPrompt?: SystemPrompt;
}

const ChatInterfaceContents: React.FC<ChatInterfaceContentsProps> = ({ systemPrompt }) => {
    const historyRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const [isMobile, setIsMobile] = useState(false);
    useEffect(() => {
        setIsMobile(checkIsMobile());
    }, []);

    const navigate = useNavigate();
    const { settingsActor, sessionActor, modelsActor } = useGlobalState();

    // --- Granular Selectors ---
    const messages = useSelector(sessionActor, (state: SessionSnapshot) => state.context.messages);
    const scrollEffect = useSelector(sessionActor, (state: SessionSnapshot) => state.context.scrollEffect);
    const isStreaming = useSelector(sessionActor, (state: SessionSnapshot) => state.matches('processingSubmission'));
    
    const input = useSelector(settingsActor, (state: SettingsSnapshot) => state.context.input);
    const apiKey = useSelector(settingsActor, (state: SettingsSnapshot) => state.context.apiKey);
    const modelName = useSelector(settingsActor, (state: SettingsSnapshot) => state.context.modelName);
    const error = useSelector(sessionActor, (state: SessionSnapshot) => state.context.error);

    if (error) {
        console.log('[DEBUG] ChatInterfaceContents: Rendering error box with error:', error);
    }

    const cachedModels = useSelector(modelsActor, (state: ModelsSnapshot) => state.context.cachedModels);
    const modelsLoading = useSelector(modelsActor, (state: ModelsSnapshot) => state.context.modelsLoading);
    const modelsError = useSelector(modelsActor, (state: ModelsSnapshot) => state.context.modelsError);
    
    // No need to select these anymore for event payloads
    
    const displayMessages = useMemo(() => {
        if (systemPrompt && messages.length === 0) {
            return [{
                id: 'system-prompt-display',
                role: 'system' as const,
                content: systemPrompt.prompt,
                raw_content: systemPrompt.prompt,
                prompt_name: systemPrompt.name,
            }];
        }
        return messages;
    }, [messages, systemPrompt]);
    
    useEffect(() => {
        if (!scrollEffect || !historyRef.current) return;

        if (scrollEffect.type === 'scrollToBottom') {
            historyRef.current.scrollTop = historyRef.current.scrollHeight;
        } else {
            const lastUserMessage = messages.filter(m => m.role === 'user').pop();
            if (lastUserMessage) {
                 const lastMessageElement = document.querySelector(`[data-message-id="${lastUserMessage.id}"]`);
                 lastMessageElement?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }

        sessionActor.send({ type: 'SCROLL_EFFECT_CONSUMED' });

    }, [scrollEffect, sessionActor, messages]);

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    const modelComboboxItems = useMemo((): ComboboxItem[] => (
        cachedModels.map((model: DisplayModelInfo) => {
            const priceDisplay = (model.prompt_cost_usd_pm !== null && model.completion_cost_usd_pm !== null)
                ? `in: ${model.prompt_cost_usd_pm.toFixed(2)}$ out: ${model.completion_cost_usd_pm.toFixed(2)}$/MTok`
                : '';
            const text = `${model.name} ${priceDisplay}`;
            const html = `<div style='display: flex; justify-content: space-between; align-items: center; width: 100%; gap: 1em;'><span style='white-space: nowrap; flex-shrink: 0'>${model.name}</span><span class='model-price' style='white-space: pre; text-align: right; overflow: hidden; flex-shrink: 1'>${priceDisplay}</span></div>`;
            return { id: model.id, display_text: text, display_html: priceDisplay ? html : undefined, model_info: model };
        })
    ), [cachedModels]);

    const handleRegenerate = (index: number): void => {
        console.log('[DEBUG] ChatInterfaceContents: handleRegenerate called.');
        sessionActor.send({
            type: 'REGENERATE',
            messageIndex: index,
        });
    };

    const handleEditAndResubmit = (index: number, newContent: string): void => {
        console.log('[DEBUG] ChatInterfaceContents: handleEditAndResubmit called.');
        sessionActor.send({
            type: 'EDIT_MESSAGE',
            messageIndex: index,
            newContent,
        });
    };

    const handleSubmit = (prompt: string): void => {
        console.log('[DEBUG] ChatInterfaceContents: handleSubmit called.');
        sessionActor.send({ type: 'SUBMIT_USER_MESSAGE', message: prompt });
    };

    const handleSetInput = (value: string): void => {
        settingsActor.send({ type: 'SET_INPUT', text: value });
    };

    const handleSetModelName = (name: string): void => {
        settingsActor.send({ type: 'SET_MODEL_NAME', name });
    };

    const handleFetchModels = (): void => {
        modelsActor.send({ type: 'FETCH' });
    };

    return (
        <div className="chat-interface">
            <div className="chat-history" ref={historyRef}>
                {apiKey && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px', borderBottom: '1px solid var(--base02)' }}>
                        <div style={{ flexGrow: 1 }}>
                            <Combobox items={modelComboboxItems} selectedId={modelName} onSelect={handleSetModelName} placeholder="Select or type model ID (e.g. openai/gpt-4o)" loading={modelsLoading} onReload={handleFetchModels} errorMessage={modelsError} />
                        </div>
                    </div>
                )}
                {!apiKey && messages.length === 0 && (
                    <div className="onboarding-message">
                        <p style={{ marginBottom: '1em' }}>To get started, please add your API key in the settings.</p>
                        <button data-role="primary" onClick={() => { void navigate('/settings'); }}>Go to Settings</button>
                    </div>
                )}
                {displayMessages.map((message, index) => (
                    <ChatMessage key={message.id} message={message} messageIndex={index} onRegenerate={handleRegenerate} onEditAndResubmit={handleEditAndResubmit} isMobile={isMobile} />
                ))}
                {error && <div className="error-box" data-testid="error-message"><div style={{ fontWeight: 'bold' }}>error</div>{error}</div>}
            </div>
            <ChatControls
                input={input}
                setInput={handleSetInput}
                onSubmit={handleSubmit}
                isStreaming={isStreaming}
                isMobile={isMobile}
                inputRef={inputRef}
                apiKey={apiKey}
            />
        </div>
    );
};

export default ChatInterfaceContents;
