import { installMainHistoryHook } from '../src/infrastructure/chrome/interaction-bridge';

export default defineUnlistedScript(() => {
  const installation = installMainHistoryHook(
    {
      global: globalThis as unknown as Record<string, unknown>,
      history,
      addEventListener: (type, listener) => window.addEventListener(type, listener),
      removeEventListener: (type, listener) =>
        window.removeEventListener(type, listener),
      dispatchSignal: (type, detail) => {
        window.dispatchEvent(new CustomEvent(type, { detail }));
      },
    },
    true,
  );
  return installation.token;
});
