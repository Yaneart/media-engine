# RP-014 Kodik rollout gate

Status: passed on 2026-10-08.

## Scope

This is the user-approved narrow `RP-014` gate for the accepted direct Kodik lane. Other paused
credentialed providers are not enabled. KinoBD remains an independently called aggregate fallback.

## Acceptance

- Direct Kodik becomes observable without waiting for KinoBD's deadline.
- KinoBD failure does not remove the direct result.
- Equivalent direct and aggregate targets select direct Kodik and retain both attributions.
- A healthy availability result is cached; warm lookup does not call Kodik again.
- Ordering, provider failures, and completion state remain deterministic.

## Reproduction

```text
pnpm smoke:kodik
pnpm smoke:streaming-rollout
```

Both commands require a provider-issued `KODIK_API_KEY` in the process environment and print no
token or playback URL. Unit coverage remains in the focused Core availability contract and Kodik
provider suites.

## Accepted result

The final live gate passed on 2026-10-08. Direct Kodik produced five Parasite options after 631 ms
while KinoBD remained pending and then timed out at the bounded 10-second deadline. The complete
snapshot retained all five direct options and reported the aggregate failure independently. A
second direct lookup exercised the cache: cold 572 ms, warm 1 ms, one upstream call. The duplicate
fixture kept `kodik-streaming` and retained both aggregate and direct attributions.
