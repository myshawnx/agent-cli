import { describe, expect, it } from "vitest";
import { app } from "../src/index";

describe("app", () => {
	it("exports a Hono app", () => {
		expect(app).toBeDefined();
	});
});
