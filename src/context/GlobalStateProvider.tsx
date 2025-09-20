import React, { useMemo } from 'react';
import { useActorRef, useSelector } from '@xstate/react';
import { InspectionEvent } from 'xstate';

// Import the root machine
import { rootMachine } from '@/machines/rootMachine';

// Import the context and type from the new file
import { GlobalStateContext, GlobalStateContextType } from './GlobalStateContext';

const inspector = (inspEvent: InspectionEvent) => {
    // Less noisy logging
    if (inspEvent.type === '@xstate.snapshot' && 'snapshot' in inspEvent && inspEvent.snapshot && 'context' in inspEvent.snapshot) {
        const simplifiedContext = { ...(inspEvent.snapshot.context as Record<string, unknown>) };
        // Avoid logging huge things
        if (simplifiedContext.snippets && Array.isArray(simplifiedContext.snippets)) simplifiedContext.snippets = `[${simplifiedContext.snippets.length} snippets]`;
        if (simplifiedContext.messages && Array.isArray(simplifiedContext.messages)) simplifiedContext.messages = `[${simplifiedContext.messages.length} messages]`;
        if (simplifiedContext.systemPrompts && Array.isArray(simplifiedContext.systemPrompts)) simplifiedContext.systemPrompts = `[${simplifiedContext.systemPrompts.length} prompts]`;
        if (simplifiedContext.cachedModels && Array.isArray(simplifiedContext.cachedModels)) simplifiedContext.cachedModels = `[${simplifiedContext.cachedModels.length} models]`;
        
        const actorId = 'id' in inspEvent.actorRef ? String(inspEvent.actorRef.id) : 'unknown';
        const snapshotValue = 'value' in inspEvent.snapshot ? inspEvent.snapshot.value : 'unknown';

        console.log(`[XSTATE] SNAPSHOT for ${actorId}: value: ${JSON.stringify(snapshotValue)}, context: ${JSON.stringify(simplifiedContext)}`);
    } else if (inspEvent.type === '@xstate.event') {
        const sourceId = inspEvent.sourceRef && 'id' in inspEvent.sourceRef ? String(inspEvent.sourceRef.id) : 'external';
        const actorId = 'id' in inspEvent.actorRef ? String(inspEvent.actorRef.id) : 'unknown';
        console.log(`[XSTATE] EVENT for ${actorId} from ${sourceId}:`, inspEvent.event);
    }
};

// Create the provider component
export const GlobalStateProvider = ({ children }: { children: React.ReactNode }): React.JSX.Element => {
  const rootActor = useActorRef(rootMachine, { inspect: inspector });
  
  const isReady = useSelector(rootActor, (state) => state.matches('running'));
  const { settingsActor, promptsActor, snippetsActor, modelsActor, sessionActor } = useSelector(rootActor, (state) => state.context);

  const actorContextValue = useMemo((): GlobalStateContextType | null => {
    if (!isReady || !settingsActor || !promptsActor || !snippetsActor || !modelsActor || !sessionActor) {
      return null;
    }
    return {
      rootActor,
      settingsActor,
      sessionActor,
      promptsActor,
      snippetsActor,
      modelsActor,
    };
  }, [isReady, rootActor, settingsActor, sessionActor, promptsActor, snippetsActor, modelsActor]);

  if (!actorContextValue) {
    return <></>; // Or a loading spinner
  }

  return (
    <GlobalStateContext.Provider value={actorContextValue}>
      {children}
    </GlobalStateContext.Provider>
  );
};
