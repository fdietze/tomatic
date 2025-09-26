import { useNavigate } from "react-router-dom";
import { NavigationService } from "./navigation";
import { useEffect, useMemo } from "react";

// This is a bit of a hack to make the navigate function available to sagas.
// In a larger app, you might use a more sophisticated dependency injection system.
let navigationService: NavigationService;

export const NavigationProvider = ({ children }: { children: React.ReactNode }) => {
  const navigate = useNavigate();

  const service = useMemo(() => ({
    navigate,
    replace: (path: string) => navigate(path, { replace: true }),
  }), [navigate]);

  useEffect(() => {
    navigationService = service;
  }, [service]);

  return children;
};

export const getNavigationService = (): NavigationService => {
  if (!navigationService) {
    throw new Error("Navigation service is not yet available.");
  }
  return navigationService;
};
