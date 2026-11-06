'use client';

import { useSyncExternalStore } from 'react';

import {
  readSidebarMode,
  subscribeToSidebar,
  type SidebarMode,
} from '@/lib/sidebar';

const serverMode = (): SidebarMode => 'expanded';

export const useSidebarMode = () =>
  useSyncExternalStore(subscribeToSidebar, readSidebarMode, serverMode);
