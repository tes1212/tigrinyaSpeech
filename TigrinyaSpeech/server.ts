import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import fs from "fs";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Route for TTS Proxy with resilient retry mechanisms, DNS cycling, and Keep-Alive bypass
  app.get("/api/tts", async (req, res) => {
    const text = req.query.text as string;
    if (!text) {
      return res.status(400).json({ error: "Text is required" });
    }

    const retries = 4;
    const initialDelay = 500;

    const host = "www.lomitec.com";
    const apiUrl = `https://${host}/piper?text=${encodeURIComponent(text)}`;

    for (let attempt = 1; attempt <= retries; attempt++) {
      // Provide a generous timeout (25s) for the first attempt to allow the serverless TTS engine to cold-start.
      // Subsequent warm attempts are set to 15s.
      const timeoutMs = attempt === 1 ? 25000 : 15000;
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(apiUrl, { 
          signal: controller.signal,
          headers: {
            "Connection": "close",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "*/*"
          }
        });
        clearTimeout(timeoutId);

        if (response.ok) {
          const contentType = response.headers.get("content-type") || "audio/wav";
          res.setHeader("Content-Type", contentType);
          const buffer = await response.arrayBuffer();
          return res.send(Buffer.from(buffer));
        }

        console.warn(`[TTS Attempt ${attempt}/${retries}] ${host} API status: ${response.status}`);
      } catch (error: any) {
        clearTimeout(timeoutId);
        
        // Log friendly/detailed warning
        const isAbort = error.name === 'AbortError' || error.message?.includes('aborted');
        const reason = isAbort ? `${timeoutMs}ms request timeout` : error.message || String(error);
        console.error(`[TTS Attempt ${attempt}/${retries}] Connect to ${host} failed: ${reason}`);
        
        if (attempt === retries) {
          return res.status(503).json({ 
            error: "Failed to fetch audio from TTS engine after multiple retries", 
            details: reason
          });
        }
      }

      // Exponential backoff with a bit of jitter (faster retry intervals for earlier retries)
      const sleepTime = initialDelay * Math.pow(1.5, attempt - 1) + Math.random() * 150;
      await new Promise(resolve => setTimeout(resolve, sleepTime));
    }
  });

  // Sync API with persistence and multiple files
  const SYNC_FILE = path.join(process.cwd(), "sync_store.json");
  // Structure: { code: { projects: { id: { name, text, currentIndex, updatedAt } }, lastActiveId } }
  let syncStore: Record<string, { projects: Record<string, any>, lastActiveId?: string }> = {};

  if (fs.existsSync(SYNC_FILE)) {
    try {
      syncStore = JSON.parse(fs.readFileSync(SYNC_FILE, "utf-8"));
    } catch (e) {
      console.error("Failed to load sync store", e);
    }
  }

  const saveSyncStore = () => {
    try {
      fs.writeFileSync(SYNC_FILE, JSON.stringify(syncStore), "utf-8");
    } catch (e) {
      console.error("Failed to save sync store", e);
    }
  };

  app.get("/api/sync/:code", (req, res) => {
    const { code } = req.params;
    const data = syncStore[code];
    if (data) {
      res.json(data);
    } else {
      res.status(404).json({ error: "Code not found" });
    }
  });

  app.post("/api/sync/save", (req, res) => {
    const { code, projectId, text, currentIndex, name } = req.body;
    if (!code) {
      return res.status(400).json({ error: "Code is required" });
    }

    if (!syncStore[code]) {
      syncStore[code] = { projects: {} };
    }

    const id = projectId || "default_" + Date.now();
    
    // Auto-name if not provided
    const projectName = name || text.slice(0, 30).trim() + (text.length > 30 ? "..." : "") || "Untitled Reading";

    syncStore[code].projects[id] = {
      id,
      name: projectName,
      text,
      currentIndex,
      updatedAt: Date.now()
    };
    syncStore[code].lastActiveId = id;

    saveSyncStore();
    res.json({ success: true, projectId: id, name: projectName });
  });

  app.post("/api/sync/delete", (req, res) => {
    const { code, projectId } = req.body;
    if (syncStore[code] && syncStore[code].projects[projectId]) {
      delete syncStore[code].projects[projectId];
      saveSyncStore();
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "Project not found" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get("*", (req, res) => {
        res.sendFile(path.join(distPath, "index.html"));
      });
    }
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
