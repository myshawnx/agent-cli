import { name } from "../src/server";

test("name", () => {
	expect(name).toBe("npm-ts-fixture");
});
