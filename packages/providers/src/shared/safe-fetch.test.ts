import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createHardenedProviderFetch,
  isPublicIpAddress,
  type HostnameResolver,
  type PinnedHttpTransport,
} from "./safe-fetch.js";

// Threat model: configured provider origins are explicit trusted destinations, including local
// self-hosted test servers. Discovered player/subtitle URLs are untrusted: every DNS answer and
// redirect hop must remain public, and the transport must connect to the validated pinned address.

test("public IP policy rejects literal private, reserved, mapped, and compatible addresses", () => {
  for (const address of [
    "0.0.0.0",
    "10.0.0.1",
    "127.0.0.1",
    "169.254.1.1",
    "172.16.0.1",
    "192.168.0.1",
    "198.51.100.1",
    "224.0.0.1",
    "::",
    "::1",
    "fc00::1",
    "fe80::1",
    "ff02::1",
    "2001:db8::1",
    "::ffff:127.0.0.1",
    "::192.168.0.1",
    "64:ff9b::7f00:1",
  ]) {
    assert.equal(isPublicIpAddress(address), false, address);
  }

  assert.equal(isPublicIpAddress("8.8.8.8"), true);
  assert.equal(isPublicIpAddress("2606:4700:4700::1111"), true);
});

test("hardened fetch rejects literal private targets before transport", async () => {
  let calls = 0;
  const request = createHardenedProviderFetch({
    provider: "test-provider",
    transport: async () => {
      calls += 1;
      return new Response("unexpected");
    },
  });

  for (const url of ["http://127.0.0.1/admin", "http://[::1]/admin"]) {
    await assert.rejects(() => request(url), {
      code: "PROVIDER_INVALID_RESPONSE",
      retryable: false,
    });
  }
  assert.equal(calls, 0);
});

test("hardened fetch rejects public hostnames resolving to private or mixed addresses", async () => {
  let calls = 0;
  const transport: PinnedHttpTransport = async () => {
    calls += 1;
    return new Response("unexpected");
  };

  for (const addresses of [
    [{ address: "127.0.0.1", family: 4 as const }],
    [
      { address: "203.0.114.10", family: 4 as const },
      { address: "10.0.0.1", family: 4 as const },
    ],
  ]) {
    const request = createHardenedProviderFetch({
      provider: "test-provider",
      resolver: async () => addresses,
      transport,
    });

    await assert.rejects(() => request("https://127.0.0.1.nip.io/embed"), {
      code: "PROVIDER_INVALID_RESPONSE",
      retryable: false,
    });
  }
  assert.equal(calls, 0);
});

test("hardened fetch pins an approved external host and disables automatic redirects", async () => {
  const resolver: HostnameResolver = async () => [{ address: "203.0.114.10", family: 4 }];
  const calls: Array<{ url: string; address: string; redirect?: RequestRedirect }> = [];
  const request = createHardenedProviderFetch({
    provider: "test-provider",
    resolver,
    transport: async (url, init, address) => {
      calls.push({ url: url.href, address: address.address, redirect: init.redirect });
      return new Response("working player");
    },
  });

  const response = await request("https://player.example/embed");

  assert.equal(await response.text(), "working player");
  assert.deepEqual(calls, [
    {
      url: "https://player.example/embed",
      address: "203.0.114.10",
      redirect: "manual",
    },
  ]);
});

test("hardened fetch rejects a redirect from a public host to a private target", async () => {
  let calls = 0;
  const request = createHardenedProviderFetch({
    provider: "test-provider",
    resolver: async () => [{ address: "203.0.114.10", family: 4 }],
    transport: async () => {
      calls += 1;
      return new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data" },
      });
    },
  });

  await assert.rejects(() => request("https://player.example/embed"), {
    code: "PROVIDER_INVALID_RESPONSE",
  });
  assert.equal(calls, 1);
});

test("hardened fetch rejects redirect loops within the bounded hop count", async () => {
  const calls: string[] = [];
  const request = createHardenedProviderFetch({
    provider: "test-provider",
    maxRedirects: 3,
    resolver: async () => [{ address: "203.0.114.10", family: 4 }],
    transport: async (url) => {
      calls.push(url.href);
      return new Response(null, {
        status: 302,
        headers: { location: url.pathname === "/one" ? "/two" : "/one" },
      });
    },
  });

  await assert.rejects(() => request("https://player.example/one"), {
    code: "PROVIDER_INVALID_RESPONSE",
  });
  assert.deepEqual(calls, ["https://player.example/one", "https://player.example/two"]);
});
