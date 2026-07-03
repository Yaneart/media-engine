# @media-engine/sdk

Typed HTTP SDK for applications that call the Media Engine REST API.

The SDK is framework-independent. It does not depend on React, NestJS, Express, or provider packages.

## Usage

```ts
import { MediaEngineClient } from "@media-engine/sdk";

const client = new MediaEngineClient({
  baseUrl: "http://127.0.0.1:3000",
});
```

`TASK-060` initializes the package and exports `MediaEngineClient`. Search, details, providers, and health methods are added in `TASK-061`.
