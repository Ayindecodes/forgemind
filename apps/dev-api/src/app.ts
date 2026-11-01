import { HealthResponse } from '@forgemind/contract';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

export const app = new Hono();

app.use(
  cors({
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:3200',
  }),
);

app.get('/health', (c) => c.json(HealthResponse.parse({ status: 'ok' })));
