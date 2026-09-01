import { describe, expect, it } from "vitest";
import { retryDelaySeconds } from "@/jobs/queue";

describe("retryDelaySeconds", () => {
  it("aplica backoff exponencial por tentativa", () => {
    const withoutJitter = () => 0;

    expect(retryDelaySeconds(1, undefined, withoutJitter)).toBe(3);
    expect(retryDelaySeconds(2, undefined, withoutJitter)).toBe(5);
    expect(retryDelaySeconds(3, undefined, withoutJitter)).toBe(10);
    expect(retryDelaySeconds(4, undefined, withoutJitter)).toBe(20);
  });

  it("permite jitter determinístico e limita o backoff a uma hora", () => {
    expect(retryDelaySeconds(1, undefined, () => 0.75)).toBe(5);
    expect(retryDelaySeconds(20, undefined, () => 0.99)).toBe(3582);
  });

  it("prioriza Retry-After positivo e também o limita a uma hora", () => {
    expect(retryDelaySeconds(7, 45, () => 0)).toBe(45);
    expect(retryDelaySeconds(7, 45, () => 0.5)).toBe(48);
    expect(retryDelaySeconds(7, 7200, () => 0)).toBe(3600);
    expect(retryDelaySeconds(1, 0, () => 0)).toBe(3);
  });
});
