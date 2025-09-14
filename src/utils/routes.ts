export const ROUTES = {
  chat: {
    new: '/chat/new',
    session: (sessionId: string) => `/chat/${sessionId}`,
    byId: '/chat/:id',
  },
  settings: '/settings',
};
