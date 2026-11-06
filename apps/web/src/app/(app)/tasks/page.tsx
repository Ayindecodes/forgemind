import type { Metadata } from 'next';

import { TasksPage } from '@/components/tasks/tasks-page';

export const metadata: Metadata = { title: 'Engineering Tasks | ForgeMind' };

export default function Page() {
  return <TasksPage />;
}
