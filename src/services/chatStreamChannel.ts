import { END, eventChannel, EventChannel } from "redux-saga";
import { ChatRequest, streamChat } from "@/services/chatService";

export type ChatStreamEvent = { chunk: string } | { done: true } | { error: unknown };

/**
 * Bridges a streaming chat completion into a redux-saga channel, so sagas can `take` its chunks.
 * Emits chunks, then exactly one `done` or `error`, then END.
 * Closing the channel (also implicitly when the consuming saga is cancelled and closes it) aborts the HTTP request.
 */
export function createChatStreamChannel(request: ChatRequest): EventChannel<ChatStreamEvent> {
  return eventChannel((emit) => {
    const controller = new AbortController();
    const processStream = async () => {
      try {
        const stream = await streamChat({ ...request, signal: controller.signal });
        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content || "";
          if (content) {
            emit({ chunk: content });
          }
        }
        emit({ done: true });
      } catch (error) {
        emit({ error });
      } finally {
        emit(END);
      }
    };
    void processStream();
    return () => controller.abort();
  });
}
