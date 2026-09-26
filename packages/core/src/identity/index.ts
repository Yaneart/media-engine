export type * from "./canonical.js";
export {
  CanonicalIdentityIndex,
  createWorkKey,
  formatIdentityAlias,
  parseIdentityAlias,
} from "./canonical.js";
export type * from "./model.js";
export { IDENTITY_NAMESPACES, normalizeIdentityId, resolveIdentityClaims } from "./model.js";
export type { IdentityResolverSource, IdentityResolverOptions } from "./resolver.js";
export { IdentityResolver } from "./resolver.js";
