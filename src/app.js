import express from "express";
import cors from "cors";
import searchfixRoutes from "./routes/searchfix.routes.js";
import { requestTrace, trace } from './services/trace.service.js';

export function createApp() {
    const app = express();
    app.disable("x-powered-by");
    app.use('/api/searchfix', requestTrace);
    app.get("/", (req, res) => res.json({ message: "SearchFix AI Server is running.", version: "1.6.0" }));
    app.get("/health", (req, res) => res.json({ status: "OK", version: "1.6.0", credentialMode: "request-key-only" }));
    app.use("/api/searchfix", (req, res, next) => {
        const origin = req.get("Origin");
        if (origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) {
            return res.status(403).json({ error: "Requests must come from the SearchFix extension." });
        }
        res.set("Cache-Control", "no-store");
        next();
    });
    app.use(cors({ origin: true, methods: ["POST", "OPTIONS"],
        allowedHeaders: ["Content-Type", "X-SearchFix-Gemini-Key"],
        exposedHeaders: ["X-SearchFix-Key-Source", "X-SearchFix-Request-Id"] }));
    app.use(express.json({ limit: "1mb" }));
    app.use("/api/searchfix", searchfixRoutes);
    app.use((err, req, res, next) => {
        // Do not log arbitrary request objects or SDK errors containing credentials.
        const status = err.code?.startsWith("LIMIT_") || err.type === "entity.too.large" ? 413 : err.status === 400 ? 400 : 500;
        trace('request.failed',{httpStatus:status});
        res.status(status).json({ error: status === 413 ? "Request exceeds the upload or input limit." : status === 400 ? "Invalid request body." : "SearchFix analysis failed." });
    });
    return app;
}
