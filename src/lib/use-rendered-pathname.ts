import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";

// The nav puts data-nav-path={result} on its <header>, so the server HTML records
// which pathname it was rendered for. One component per page uses it (the nav, on its header).
const RENDERED_PATH_ATTR = "data-nav-path";

const subscribe = () => () => {};

// usePathname, safe to hydrate. The root layout's nav streams in and hydrates after the page
// body, so a client navigation can land first (a quick tap in the body hydrates that part
// first). React would then hydrate the nav with the new pathname over HTML rendered for the old
// one, and it does not patch attributes that differ: the old page stayed highlighted. Here,
// hydration renders with the pathname the server rendered for (read back from the HTML), and
// React re-renders with the current pathname straight after. Outside hydration it is usePathname.
export function useRenderedPathname(): string {
  const pathname = usePathname();
  return useSyncExternalStore(
    subscribe,
    () => pathname,
    () =>
      typeof document === "undefined"
        ? pathname
        : (document.querySelector(`header[${RENDERED_PATH_ATTR}]`)?.getAttribute(RENDERED_PATH_ATTR) ?? pathname),
  );
}
