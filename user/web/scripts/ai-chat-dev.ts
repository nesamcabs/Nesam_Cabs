import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
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

const resolveFunctionsDir = (): string => {
  const candidates = [
    fileURLToPath(new URL('../../../functions/', import.meta.url)),
    fileURLToPath(new URL('../../Project/functions/', import.meta.url)),
  ];
  return candidates.find((dir) => existsSync(path.join(dir, 'package.json'))) ?? candidates[0]!;
};

const ENV_ALLOWLIST = [
  'GROQ_API_KEY',
  'GROQ_MODEL',
  'NESAM_SERVICE_ACCOUNT',
  'FIREBASE_SERVICE_ACCOUNT',
  'NESAM_STORAGE_BUCKET',
  'SMTP_SERVICE',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_USER',
  'SMTP_PASS',
  'EMAIL_FROM',
  'EMAIL_FROM_NAME',
  'EMAIL_REPLY_TO',
  'OFFICE_EMAIL',
];

const ERROR_HTTP_MAP: Record<string, { http: number; status: string }> = {
  'invalid-argument': { http: 400, status: 'INVALID_ARGUMENT' },
  'failed-precondition': { http: 400, status: 'FAILED_PRECONDITION' },
  'permission-denied': { http: 403, status: 'PERMISSION_DENIED' },
  unauthenticated: { http: 401, status: 'UNAUTHENTICATED' },
  'not-found': { http: 404, status: 'NOT_FOUND' },
  'already-exists': { http: 409, status: 'ALREADY_EXISTS' },
  'resource-exhausted': { http: 429, status: 'RESOURCE_EXHAUSTED' },
};

/** Run the shared chat & support-lead server locally; never send private keys or service accounts to the browser. */
export function aiChatDev() {
  const functionsDir = resolveFunctionsDir();
  const require = createRequire(path.join(functionsDir, 'package.json'));
  return {
    name: 'nesam-local-ai-chat',
    apply: 'serve',
    configureServer(server: any) {
      // Explicitly configured HTTP APIs and emulators keep their own backend.
      const appEnv = { ...readEnv(server.config.root, server.config.mode), ...(server.config.env ?? {}) };
      if (appEnv.VITE_API_URL || appEnv.EXPO_PUBLIC_API_URL || appEnv.EXPO_PUBLIC_USE_FIREBASE_EMULATORS === 'true') return;
      const env = readEnv(functionsDir, server.config.mode);
      for (const name of ENV_ALLOWLIST) {
        if (!process.env[name] && env[name]) process.env[name] = env[name];
      }
      const hasAdminCreds = Boolean((process.env.NESAM_SERVICE_ACCOUNT || process.env.FIREBASE_SERVICE_ACCOUNT || '').trim());

      server.middlewares.use(async (req: any, res: any, next: () => void) => {
        const route = req.url?.split('?')[0];
        const isChat = route === '/__functions/chatWithBot';
        const isSupport = route === '/__functions/submitSupportRequest' && hasAdminCreds;
        if (!isChat && !isSupport) return next();

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
            if (Buffer.byteLength(body) > 64 * 1024) return fail(413, 'INVALID_ARGUMENT', 'Request payload is too large.');
          }
          let parsed: { data?: unknown };
          try { parsed = JSON.parse(body); } catch { return fail(400, 'INVALID_ARGUMENT', 'Invalid JSON.'); }

          if (isChat) {
            const { chatWithBot } = require(path.join(functionsDir, 'lib/groqChat.js'));
            const result = await chatWithBot.run({ data: parsed.data, rawRequest: req });
            return res.end(JSON.stringify({ result }));
          }

          let auth: { uid: string; token?: Record<string, unknown> } | undefined;
          const bearer = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''));
          if (bearer?.[1]) {
            try {
              const { getAuth } = require('firebase-admin/auth');
              require(path.join(functionsDir, 'lib/admin.js'));
              const decoded = await getAuth().verifyIdToken(bearer[1]);
              auth = { uid: decoded.uid, token: decoded };
            } catch {
              // Ignore malformed optional token on public callable and handle as visitor.
            }
          }
          const { submitSupportRequest } = require(path.join(functionsDir, 'lib/support.js'));
          const result = await submitSupportRequest.run({ data: parsed.data, ...(auth ? { auth } : {}), rawRequest: req });
          return res.end(JSON.stringify({ result }));
        } catch (err) {
          const typed = err as { code?: string; message?: string };
          const mapped = typed.code ? ERROR_HTTP_MAP[typed.code] : undefined;
          if (mapped) return fail(mapped.http, mapped.status, typed.message || 'Request rejected.');
          server.config.logger.error('Local function handler failed. Run npm --prefix functions run build and restart the dev server.');
          fail(503, 'UNAVAILABLE', 'The service is temporarily unavailable.');
        }
      });
    },
  };
}
