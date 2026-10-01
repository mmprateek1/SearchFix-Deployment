import "dotenv/config";
import { createApp } from "./app.js";
import { runtimeConfig } from "./config/runtime.js";

const config = runtimeConfig();
const app = createApp();
app.listen(config.port, config.host, () => {
    console.log(`SearchFix 1.6.0 listening on ${config.host}:${config.port}; supplied Gemini key required.`);
});
export default app;
