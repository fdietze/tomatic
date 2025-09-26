import { NavigateFunction } from "react-router-dom";

export interface NavigationService {
  navigate: NavigateFunction;
  replace: (path: string) => void;
}
