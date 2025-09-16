export const ROUTES = {
  chat: {
    new: '/chat/new',
    session: (sessionId: string): string => `/chat/${sessionId}`,
    byId: '/chat/:id',
  },
  settings: '/settings',
};
