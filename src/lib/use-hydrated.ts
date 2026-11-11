import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

// False on the server and during hydration, true once React is running in the browser.
// A form button disabled until then cannot be pressed before its onSubmit exists.
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
