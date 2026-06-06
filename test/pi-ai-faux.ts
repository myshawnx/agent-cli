import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { FauxProviderRegistration, FauxResponseStep, RegisterFauxProviderOptions } from "@earendil-works/pi-ai";

type PiAiModule = typeof import("@earendil-works/pi-ai");

const nestedPiAiUrl = new URL(
	"../node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/index.js",
	import.meta.url,
);
const piAi = (await import(
	existsSync(fileURLToPath(nestedPiAiUrl)) ? nestedPiAiUrl.href : "@earendil-works/pi-ai"
)) as PiAiModule;

export const fauxAssistantMessage = piAi.fauxAssistantMessage;
export const fauxToolCall = piAi.fauxToolCall;
export const registerFauxProvider = piAi.registerFauxProvider as (
	options?: RegisterFauxProviderOptions,
) => FauxProviderRegistration;
export type { FauxProviderRegistration, FauxResponseStep, RegisterFauxProviderOptions };
