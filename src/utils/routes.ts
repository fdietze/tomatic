export const ROUTES = {
  chat: {
    new: '/chat/new',
    session: (sessionId: string): string => `/chat/${sessionId}`,
    byId: '/chat/:id',
  },
  scratchpad: {
    new: '/scratchpad/new',
    session: (sessionId: string): string => `/scratchpad/${sessionId}`,
    byId: '/scratchpad/:id',
  },
  settings: '/settings',
};
