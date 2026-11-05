import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const readEnv = (dir: string, mode: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const file of ['.env', `.env.${mode}`]) {
    try {
      for (const line of readFileSync(path.join(dir, file), 'utf8').split(/\r?\n/)) {
        const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
        if (!match) continue;
        out[match[1]!] = match[2]!.replace(/^(['"])(.*)\1$/, '$2');
      }
    } catch {
      // An env file is optional; Vite/server environment variables still apply.
    }
  }
  return out;
};

/** Run the shared chat server locally; never send the private key to the browser. */
export function aiChatDev() {
  const functionsDir = fileURLToPath(new URL('../../../functions/', import.meta.url));
  const require = createRequire(path.join(functionsDir, 'package.json'));
  return {
    name: 'nesam-local-ai-chat',
    apply: 'serve',
    configureServer(server: any) {
      // Explicitly configured HTTP APIs and emulators keep their own backend.
      const appEnv = { ...readEnv(server.config.root, server.config.mode), ...(server.config.env ?? {}) };
      if (appEnv.VITE_API_URL || appEnv.EXPO_PUBLIC_API_URL || appEnv.EXPO_PUBLIC_USE_FIREBASE_EMULATORS === 'true') return;
      const env = readEnv(functionsDir, server.config.mode);
      for (const name of ['GROQ_API_KEY', 'GROQ_MODEL']) {
        if (!process.env[name] && env[name]) process.env[name] = env[name];
      }
      server.middlewares.use(async (req: any, res: any, next: () => void) => {
        if (req.url?.split('?')[0] !== '/__functions/chatWithBot') return next();
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        const fail = (status: number, code: string, message: string) => {
          res.statusCode = status;
          res.end(JSON.stringify({ error: { status: code, message } }));
        };
        if (req.method !== 'POST') return fail(405, 'INVALID_ARGUMENT', 'Use POST.');
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) {
          return fail(403, 'PERMISSION_DENIED', 'Origin not allowed.');
        }
        try {
          let body = '';
          for await (const chunk of req) {
            body += chunk.toString();
            if (Buffer.byteLength(body) > 64 * 1024) return fail(413, 'INVALID_ARGUMENT', 'Message history is too large.');
          }
          let parsed;
          try { parsed = JSON.parse(body); } catch { return fail(400, 'INVALID_ARGUMENT', 'Invalid JSON.'); }
          const { chatWithBot } = require(path.join(functionsDir, 'lib/groqChat.js'));
          const result = await chatWithBot.run({ data: parsed.data, rawRequest: req });
          res.end(JSON.stringify({ result }));
        } catch (err) {
          const code = (err as { code?: string }).code;
          if (code === 'resource-exhausted') return fail(429, 'RESOURCE_EXHAUSTED', 'Please wait before sending another message.');
          if (code === 'invalid-argument') return fail(400, 'INVALID_ARGUMENT', 'Please send a message.');
          server.config.logger.error('Local AI chat failed. Run npm --prefix functions run build and restart the dev server.');
          fail(503, 'UNAVAILABLE', 'The assistant is temporarily unavailable.');
        }
      });
    },
  };
}
