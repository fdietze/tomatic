import React, { useEffect, useMemo, useState, useRef } from "react";
import { useSelector, useDispatch } from "react-redux";
import { SystemPrompt } from "@/types/storage";
import { Message as ChatMessageType } from "@/types/chat";
import ChatMessage from "./ChatMessage";
import ChatControls from "./ChatControls";
import Combobox from "./Combobox";
import {
  selectSettings,
  setModelName,
  saveSettings,
} from "@/store/features/settings/settingsSlice";
import { selectModels, fetchModels } from "@/store/features/models/modelsSlice";
import { isMobile as checkIsMobile } from "@/utils/isMobile";
import {
  SessionState,
  cancelSubmission,
  regenerateResponseRequested,
  editMessageRequested,
} from "@/store/features/session/sessionSlice";

interface ChatInterfaceContentsProps {
  session: SessionState;
  onNewMessage: (content: string) => void;

  systemPrompt?: SystemPrompt;
}

const ChatInterfaceContents: React.FC<ChatInterfaceContentsProps> = ({
  session,
  onNewMessage,

  systemPrompt,
}) => {
  const dispatch = useDispatch();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    setIsMobile(checkIsMobile());
  }, []);

  // --- Redux State ---
  const { modelName, apiKey } = useSelector(selectSettings);
  const {
    models,
    loading: modelsLoading,
    error: modelsError,
  } = useSelector(selectModels);

  const [input, setInput] = useState("");

  useEffect(() => {
    dispatch(fetchModels());
  }, [dispatch]);

  const displayMessages = useMemo(() => {
    if (systemPrompt && session.messages.length === 0) {
      return [
        {
          id: "system-prompt-display",
          role: "system" as const,
          content: systemPrompt.prompt,
          raw_content: systemPrompt.prompt,
          timestamp: Date.now(),
        },
      ];
    }
    return session.messages;
  }, [session.messages, systemPrompt]);

  const handleModelChange = (newModel: string) => {
    dispatch(setModelName(newModel));
    dispatch(saveSettings({}));
  };

  const handleSubmit = (prompt: string): void => {
    onNewMessage(prompt);
    setInput("");
  };

  const handleRegenerate = (index: number): void => {
    dispatch(regenerateResponseRequested({ index }));
  };

  const handleEditAndResubmit = (index: number, newContent: string): void => {
    dispatch(editMessageRequested({ index, newPrompt: newContent }));
  };

  const handleCancel = () => {
    dispatch(cancelSubmission());
  };

  return (
    <div className="chat-interface">
      <div className="chat-history">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "4px",
            padding: "4px",
            borderBottom: "1px solid var(--base02)",
          }}
        >
          <div style={{ flexGrow: 1 }}>
            <Combobox
              items={models.map((m) => ({ id: m.id, display_text: m.name }))}
              selectedId={modelName}
              onSelect={handleModelChange}
              placeholder="Select or type model ID (e.g. openai/gpt-4o)"
              loading={modelsLoading === "loading"}
              onReload={() => dispatch(fetchModels())}
              errorMessage={modelsError}
            />
          </div>
        </div>
        {displayMessages.map((message: ChatMessageType, index: number) => (
          <ChatMessage
            key={message.id}
            message={message}
            messageIndex={index}
            onRegenerate={handleRegenerate}
            onEditAndResubmit={handleEditAndResubmit}
            isMobile={isMobile}
          />
        ))}
      </div>
      <ChatControls
        input={input}
        setInput={setInput}
        onSubmit={handleSubmit}
        isStreaming={session.submitting}
        isMobile={isMobile}
        inputRef={inputRef}
        apiKey={apiKey}
        onCancel={handleCancel}
      />
    </div>
  );
};

export default ChatInterfaceContents;
