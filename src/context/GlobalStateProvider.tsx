import React, { useMemo, useEffect } from 'react';
import { createActor } from 'xstate';

// Import all the machines
import { settingsMachine } from '@/machines/settingsMachine';
import { sessionMachine } from '@/machines/sessionMachine';
import { promptsMachine } from '@/machines/promptsMachine';
import { snippetsMachine } from '@/machines/snippetsMachine';
import { modelsMachine } from '@/machines/modelsMachine';

// Import the context and type from the new file
import { GlobalStateContext, GlobalStateContextType } from './GlobalStateContext';

const settingsActor = createActor(settingsMachine).start();
const promptsActor = createActor(promptsMachine).start();
const snippetsActor = createActor(snippetsMachine).start();
const modelsActor = createActor(modelsMachine).start();

// Create the provider component
export const GlobalStateProvider = ({ children }: { children: React.ReactNode }): React.JSX.Element => {
  const sessionActor = useMemo(() => {
    return createActor(sessionMachine, {
      systemId: 'sessionActor',
      input: {
        settingsActor,
        promptsActor,
        snippetsActor
      }
    }).start();
  }, []);

  useEffect(() => {
    promptsActor.send({ type: 'LOAD' });
    snippetsActor.send({ type: 'LOAD' });
  }, []);

  const actorContextValue = useMemo((): GlobalStateContextType => ({
    settingsActor,
    sessionActor,
    promptsActor,
    snippetsActor,
    modelsActor,
  }), [sessionActor]);

  return (
    <GlobalStateContext.Provider value={actorContextValue}>
      {children}
    </GlobalStateContext.Provider>
  );
};
