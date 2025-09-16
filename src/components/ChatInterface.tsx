import React from 'react';
import ChatInterfaceContents from './ChatInterfaceContents';
import { SystemPrompt } from '@/types/storage';

interface ChatInterfaceProps {
    systemPrompt?: SystemPrompt;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ systemPrompt }) => {
    return <ChatInterfaceContents systemPrompt={systemPrompt} />;
};

export default ChatInterface;
