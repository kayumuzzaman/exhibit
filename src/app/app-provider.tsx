import {
  createContext,
  useContext,
  useSyncExternalStore,
  type PropsWithChildren,
} from 'react';

import type { SanitizedRecordingSession } from '../domain/sanitized';
import type { SessionController } from '../features/session/session-controller';

type AppServices = Readonly<{
  controller: SessionController;
  exportEvidence(): Promise<void>;
}>;

const AppContext = createContext<AppServices | null>(null);

export function AppProvider({
  children,
  controller,
  exportEvidence = async () => undefined,
}: PropsWithChildren<
  Readonly<{
    controller: SessionController;
    exportEvidence?: () => Promise<void>;
  }>
>) {
  return <AppContext value={{ controller, exportEvidence }}>{children}</AppContext>;
}

function useServices(): AppServices {
  const services = useContext(AppContext);
  if (services === null) {
    throw new Error('Payloadra app services are unavailable.');
  }
  return services;
}

export function useSessionController(): SessionController {
  return useServices().controller;
}

export function useSession(): SanitizedRecordingSession {
  const controller = useSessionController();
  return useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
}

export function useExportEvidence(): () => Promise<void> {
  return useServices().exportEvidence;
}
