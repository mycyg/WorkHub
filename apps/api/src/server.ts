import { serve } from "@hono/node-server";

import app from "./app.js";
import { settings } from "@workhub/config";

serve(
  {
    fetch: app.fetch,
    hostname: settings.apiHost,
    port: settings.port
  },
  (info) => {
    console.log(`WorkHub API daemon listening on http://${settings.apiHost}:${info.port}`);
  }
);
