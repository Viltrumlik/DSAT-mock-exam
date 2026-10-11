// The website's OWN tests, run inside the island's suite against the very modules the island
// imports through the @website alias (architecture.md §3: "The website's own tests run against
// the island"). Importing a test file registers its describe/it blocks here, so a change to a
// reused module that breaks the website's expectations fails `npm test` in the island too.
// Listed in parity-manifest.json (use: "test").
import "@website/features/testing-simulation/tools/__tests__/annotations.test.ts";
import "@website/features/testing-simulation/tools/__tests__/reviewOffsetParity.test.ts";
import "@website/features/testing-simulation/utils/__tests__/richContent.test.ts";
import "@website/features/testing-simulation/__tests__/utils.test.ts";
