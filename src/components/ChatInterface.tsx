import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import ChatInterfaceContents from './ChatInterfaceContents';
import { SystemPrompt } from '@/types/storage';
import { selectSession, submitUserMessage } from '@/store/features/session/sessionSlice';

interface ChatInterfaceProps {
    systemPrompt?: SystemPrompt;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ systemPrompt }) => {
    const dispatch = useDispatch();
    const session = useSelector(selectSession);

    const handleNewMessage = (content: string) => {
        dispatch(submitUserMessage(content));
    };

    const handleRetry = (_messageId: string) => {
        // This will be implemented later
    };

    return (
        <ChatInterfaceContents
            session={session}
            onNewMessage={handleNewMessage}
            onRetry={handleRetry}
            systemPrompt={systemPrompt}
        />
    );
};

export default ChatInterface;
