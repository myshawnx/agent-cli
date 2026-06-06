import type { FauxProviderRegistration, FauxResponseStep, RegisterFauxProviderOptions } from "@earendil-works/pi-ai";

type PiAiModule = typeof import("@earendil-works/pi-ai");

const piAi = (await import(
	"../node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/index.js"
)) as PiAiModule;

export const fauxAssistantMessage = piAi.fauxAssistantMessage;
export const fauxToolCall = piAi.fauxToolCall;
export const registerFauxProvider = piAi.registerFauxProvider as (
	options?: RegisterFauxProviderOptions,
) => FauxProviderRegistration;
export type { FauxProviderRegistration, FauxResponseStep, RegisterFauxProviderOptions };
