export const SIDEBAR_STORAGE_KEY = 'forgemind-sidebar';

export const sidebarModes = ['expanded', 'compact'] as const;
export type SidebarMode = (typeof sidebarModes)[number];

/** Applied before first paint so the sidebar never jumps between widths. */
export const sidebarScript = `(function(){var m;try{m=localStorage.getItem(${JSON.stringify(SIDEBAR_STORAGE_KEY)})}catch(e){}document.documentElement.setAttribute("data-sidebar",m==="compact"?"compact":"expanded")})()`;

const listeners = new Set<() => void>();
let unsavedMode: SidebarMode | undefined;

const isMode = (value: unknown): value is SidebarMode =>
  sidebarModes.some((mode) => mode === value);

export function readSidebarMode(): SidebarMode {
  if (unsavedMode) return unsavedMode;

  try {
    const stored = localStorage.getItem(SIDEBAR_STORAGE_KEY);
    return isMode(stored) ? stored : 'expanded';
  } catch {
    return 'expanded';
  }
}

export function applySidebarMode() {
  document.documentElement.setAttribute('data-sidebar', readSidebarMode());
  listeners.forEach((listener) => listener());
}

export function setSidebarMode(mode: SidebarMode) {
  try {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, mode);
    unsavedMode = undefined;
  } catch {
    unsavedMode = mode;
  }

  applySidebarMode();
}

export function subscribeToSidebar(listener: () => void) {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function watchSidebarChanges() {
  const onStorage = ({ key }: StorageEvent) => {
    if (key === SIDEBAR_STORAGE_KEY) applySidebarMode();
  };

  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}
