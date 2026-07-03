# @media-engine/sdk

Typed HTTP SDK for applications that call the Media Engine REST API.

The SDK is framework-independent. It does not depend on React, NestJS, Express, or provider packages.

## Usage

```ts
import { MediaEngineClient } from "@media-engine/sdk";

const client = new MediaEngineClient({
  baseUrl: "http://127.0.0.1:3000",
});

const search = await client.search({
  title: "Interstellar",
  type: "movie",
});

const details = await client.getDetails({
  imdb: "tt0816692",
  type: "movie",
});

const providers = await client.getProviders();
const health = await client.getHealth();
```

## Methods

- `search(query)` calls `GET /media/search`.
- `getDetails(query)` calls `GET /media/details`.
- `getProviders()` calls `GET /providers`.
- `getHealth()` calls `GET /health`.

Failed HTTP responses and invalid JSON payloads throw `MediaEngineApiError`.
