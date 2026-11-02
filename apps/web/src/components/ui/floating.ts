/*
 * Shared classes for anything that floats over the page: popovers, menus,
 * selects, tooltips and toasts. They are glass, and they rise out of the
 * control that opened them, whichever side Radix places them on.
 */

export const floating =
  'material-popover z-50 outline-none data-[state=open]:motion-popover-in data-[state=closed]:motion-popover-out';

export const riseFromSide =
  'data-[side=top]:[--motion-shift-y:var(--motion-shift)] data-[side=left]:[--motion-shift-x:var(--motion-shift)] data-[side=left]:[--motion-shift-y:0px] data-[side=right]:[--motion-shift-x:calc(-1*var(--motion-shift))] data-[side=right]:[--motion-shift-y:0px]';

export const menuItem =
  'flex h-7 cursor-default items-center gap-2 rounded-sm px-2 text-sm outline-none select-none data-[highlighted]:bg-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-50';
