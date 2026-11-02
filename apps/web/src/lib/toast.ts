export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export type ToastInput = {
  title: string;
  description?: string;
  tone?: ToastTone;
  action?: { label: string; onClick: () => void };
};

export type Toast = ToastInput & { id: number; tone: ToastTone; open: boolean };

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((listener) => listener());

export function toast(input: ToastInput): number {
  const id = nextId++;
  toasts = [...toasts, { tone: 'info', ...input, id, open: true }];
  emit();

  return id;
}

/** Starts the toast's exit. Remove it once the exit animation has finished. */
export function closeToast(id: number) {
  toasts = toasts.map((item) =>
    item.id === id ? { ...item, open: false } : item,
  );
  emit();
}

export function removeToast(id: number) {
  toasts = toasts.filter((item) => item.id !== id);
  emit();
}

export function clearToasts() {
  toasts = [];
  emit();
}

export const getToasts = () => toasts;

export function subscribeToToasts(listener: () => void) {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}
