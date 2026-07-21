import type { RequestHandler } from 'express';
import helmet from 'helmet';

// Swagger needs its own self-only CSP; JSON API responses keep a no-content policy.
// Swagger требует отдельную self-only CSP; JSON API использует политику без content.
export function createSecurityHeadersMiddleware(options: {
  production: boolean;
}): RequestHandler {
  const transportSecurity = options.production
    ? { maxAge: 15_552_000, includeSubDomains: true }
    : false;
  const apiHeaders = helmet({
    strictTransportSecurity: transportSecurity,
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
  });
  const docsHeaders = helmet({
    strictTransportSecurity: transportSecurity,
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: null,
      },
    },
  });

  return (request, response, next) => {
    const middleware = isDocsRequest(request.path) ? docsHeaders : apiHeaders;
    middleware(request, response, next);
  };
}

function isDocsRequest(path: string): boolean {
  return path === '/docs' || path.startsWith('/docs/') || path === '/docs-json';
}
