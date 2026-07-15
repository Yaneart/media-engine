import { kinobdStreamingProvider, type KinoBdStreamingProviderOptions } from "./index.js";

export interface RequestRecord {
  method: string;
  path: string;
  search: string;
  query: URLSearchParams;
  body: URLSearchParams;
}

export function createProvider(options: Partial<KinoBdStreamingProviderOptions>) {
  return kinobdStreamingProvider({
    baseUrl: "https://kinobd.test",
    ...options,
  });
}

export function createMockFetch(requests: RequestRecord[], responses: Record<string, unknown>) {
  return async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = new URLSearchParams(String(init?.body ?? ""));

    requests.push({
      method,
      path: url.pathname,
      search: url.search,
      query: url.searchParams,
      body,
    });

    return Response.json(responses[`${method} ${url.pathname}`] ?? {});
  };
}
