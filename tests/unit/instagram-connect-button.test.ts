import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InstagramConnectButton } from "@/components/instagram-connect-button";

describe("InstagramConnectButton", () => {
  it("conta nova vai direto ao app oficial, sem escolha de Meta App", () => {
    const html = renderToStaticMarkup(createElement(InstagramConnectButton, {}, "Conectar"));
    expect(html).toBe('<a class="button button-primary" href="/api/instagram/oauth/start">Conectar</a>');
  });

  it("reconexão só informa a conta; o app é decidido no servidor", () => {
    const html = renderToStaticMarkup(createElement(InstagramConnectButton, { accountId: "abc" }, "Reconectar"));
    expect(html).toContain('href="/api/instagram/oauth/start?account=abc"');
    expect(html).not.toContain("app=");
  });
});
