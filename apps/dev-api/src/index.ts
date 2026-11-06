import { serve } from '@hono/node-server';

import { app } from './app';

const port = Number(process.env.PORT ?? 4000);

serve({ fetch: app.fetch, port }, ({ port: listeningPort }) => {
  console.log(
    `dev-api listening on http://localhost:${listeningPort} (demo data)`,
  );
});
