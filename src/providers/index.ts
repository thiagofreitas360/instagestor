import { getEnv } from "@/lib/env";
import { FakeInstagramProvider } from "./fake-instagram";
import type { InstagramProvider } from "./instagram";
import { MetaInstagramProvider } from "./meta-instagram";

let provider: InstagramProvider | undefined;

export function getInstagramProvider() {
  if (!provider) provider = getEnv().INSTAGRAM_PROVIDER === "meta" ? new MetaInstagramProvider() : new FakeInstagramProvider();
  return provider;
}

export function resetInstagramProviderForTests() {
  provider = undefined;
}

export { FakeInstagramProvider, MetaInstagramProvider };
export type { InstagramProvider } from "./instagram";
