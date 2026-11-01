import { HealthResponse } from '@forgemind/contract';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export async function isApiHealthy(): Promise<boolean> {
  try {
    const response = await fetch(`${API_URL}/health`, { cache: 'no-store' });
    return HealthResponse.safeParse(await response.json()).success;
  } catch {
    return false;
  }
}
