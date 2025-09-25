import React from "react";
import { useSelector, useDispatch } from "react-redux";
import ChatInterfaceContents from "./ChatInterfaceContents";
import { SystemPrompt } from "@/types/storage";
import {
  selectSession,
  sendMessageRequested,
} from "@/store/features/session/sessionSlice";

interface ChatInterfaceProps {
  systemPrompt?: SystemPrompt;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ systemPrompt }) => {
  const dispatch = useDispatch();
  const session = useSelector(selectSession);

  const handleNewMessage = (content: string) => {
    dispatch(sendMessageRequested({ prompt: content }));
  };

  return (
    <ChatInterfaceContents
      session={session}
      onNewMessage={handleNewMessage}
      systemPrompt={systemPrompt}
    />
  );
};

export default ChatInterface;
