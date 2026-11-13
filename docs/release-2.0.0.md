# Media Engine 2.0.0

Core, Providers and SDK are prepared at 2.0.0. REST/OpenAPI remains 0.20.0.

## Migration

Remove imports and registrations of `ddbbStreamingProvider`, `vibixStreamingProvider`,
`videoSeedStreamingProvider` and `hdvbStreamingProvider`. Their adapters and reference
API environment settings were removed. The major version reflects these public API removals.

The retained direct iframe providers are Collaps, Alloha and Mirage. Add VeoVeo's
separate iframe provider alongside its existing direct HLS provider when desired:

```ts
import { veoVeoEmbedProvider } from "@media-engine/providers";

const provider = veoVeoEmbedProvider({
  apiKey: process.env.VEOVEO_API_KEY,
  allowApiKeyInEmbedUrl: true,
});
```

The iframe exposes the provider-issued token to viewers, so explicit public-token
consent is required. The current operator authorized using the existing VeoVeo
token. Translations and episodes remain inside the iframe; exact episode queries
are served by the existing direct HLS provider. Returned identity and movie/series
kind are checked against VeoVeo's native catalog before emitting an option.

Reference API/Compose flags, both false by default:

```dotenv
MEDIA_ENGINE_VEOVEO_EMBED_ENABLED=true
MEDIA_ENGINE_VEOVEO_EMBED_ALLOW_API_KEY_IN_EMBED_URL=true
```

## Validation

- 43 focused provider tests and 24 reference API configuration tests passed.
- Three public packages compiled; release consistency and clean output inventories passed.
- Dry packs: Core 211, Providers 331 and SDK 10 files. Removed adapters are absent.
- Live factory queries returned one iframe for Dune, Interstellar and Breaking Bad.
  Fresh Chromium on 127.0.0.1 played Dune at 1920px beyond 158 seconds and Breaking
  Bad at 1920px beyond 28 seconds, both readyState 4. These are startup checks.
- No full-project release gate was run. The operator may run `pnpm release:check`
  before publication. No Git staging, commit, push, tagging or publication was performed.

## Publication

Run from the repository root after reviewing, committing and pushing the changes:

```powershell
pnpm.cmd --filter @media-engine/core publish --access public
pnpm.cmd --filter @media-engine/providers publish --access public
pnpm.cmd --filter @media-engine/sdk publish --access public
```

Publish in that order. Upgrade yaneMedia's exact dependencies and lockfile only
after all three 2.0.0 packages are published; it currently uses registry 1.14.0.
