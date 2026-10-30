import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Without Vitest globals, Testing Library can't register its own cleanup.
afterEach(cleanup);
