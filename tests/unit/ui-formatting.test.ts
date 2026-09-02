import { describe, expect, it } from "vitest";
import { formatBytes } from "@/components/ui";

describe("formatBytes", () => {
  it("formata bigint retornado pelo PostgreSQL como string", () => {
    expect(formatBytes("306089")).toBe("298,9 KB");
  });

  it("mantém zero e valores inválidos seguros", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes("inválido")).toBe("0 B");
  });
});
