/**
 * Model type alias.
 *
 * pi's `Model<TApi>` is generic over the provider API descriptor. Agent CLI works
 * with models from several providers — `anthropic` for real runs, the `faux`
 * provider (whose model is `Model<string>`) in tests — so we deliberately accept a
 * model of any provider API here. The single `biome-ignore` on the alias keeps
 * that unavoidable `any` localized instead of scattering it across the runtime.
 */

import type { Model } from "@earendil-works/pi-ai";

// biome-ignore lint/suspicious/noExplicitAny: see module comment — provider-agnostic model handle.
export type AnyModel = Model<any>;
