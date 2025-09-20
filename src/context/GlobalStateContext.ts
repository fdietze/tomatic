import { createContext, useContext } from 'react';
import { ActorRefFrom } from 'xstate';
import { settingsMachine } from '@/machines/settingsMachine';
import { sessionMachine } from '@/machines/sessionMachine';
import { promptsMachine } from '@/machines/promptsMachine';
import { snippetsMachine } from '@/machines/snippetsMachine';
import { modelsMachine } from '@/machines/modelsMachine';
import { rootMachine } from '@/machines/rootMachine';

export interface GlobalStateContextType {
  rootActor: ActorRefFrom<typeof rootMachine>;
  settingsActor: ActorRefFrom<typeof settingsMachine>;
  sessionActor: ActorRefFrom<typeof sessionMachine>;
  promptsActor: ActorRefFrom<typeof promptsMachine>;
  snippetsActor: ActorRefFrom<typeof snippetsMachine>;
  modelsActor: ActorRefFrom<typeof modelsMachine>;
}

export const GlobalStateContext = createContext<GlobalStateContextType>({} as GlobalStateContextType);

export const useGlobalState = (): GlobalStateContextType => {
    return useContext(GlobalStateContext);
};
