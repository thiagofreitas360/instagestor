import { describe, expect, it } from "vitest";
import { clientAddressFromHeaders } from "@/server/auth";

describe("clientAddressFromHeaders", () => {
  it("prioriza o endereço normalizado pelo ingress", () => {
    const headers = new Headers({
      "cf-connecting-ip": "2001:0db8:0:0:0:0:0:1",
      "x-real-ip": "192.0.2.10",
      "x-forwarded-for": "198.51.100.20, 10.0.0.2",
    });

    expect(clientAddressFromHeaders(headers)).toBe("2001:db8::1");
  });

  it("aceita o primeiro X-Forwarded-For válido e rejeita valores arbitrários", () => {
    expect(clientAddressFromHeaders(new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.2" }))).toBe("203.0.113.9");
    expect(clientAddressFromHeaders(new Headers({ "x-forwarded-for": "forged-client-value" }))).toBe("unknown");
  });

  it("remove porta de IPv4 quando o proxy a inclui", () => {
    expect(clientAddressFromHeaders(new Headers({ "x-real-ip": "192.0.2.44:54321" }))).toBe("192.0.2.44");
  });
});
