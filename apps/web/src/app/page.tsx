import { connection } from 'next/server';

import { isApiHealthy } from '@/lib/api';

export default async function HomePage() {
  await connection();
  const healthy = await isApiHealthy();

  return (
    <main className="p-8">
      <h1 className="text-xl font-semibold">ForgeMind</h1>
      <p>API: {healthy ? 'reachable' : 'unreachable'}</p>
    </main>
  );
}
