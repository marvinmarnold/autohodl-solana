import { describe, it, expect, beforeEach, mock } from "bun:test";
import { prepareAction, confirmAction } from "./index.js";

// Mock fetch globally for all tests in this file
const fetchMock = mock();
global.fetch = fetchMock as unknown as typeof fetch;

beforeEach(() => {
  fetchMock.mockReset();
});

// ── prepareAction ─────────────────────────────────────────────────────────────

describe("prepareAction", () => {
  it("returns txBase64, confirmUrl, and message on success", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ title: "Test Action", description: "desc" }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          transaction: "base64tx==",
          message: "Sign to authorize",
          links: { next: { type: "post", href: "https://api.example.com/confirm?foo=1" } },
        }),
      } as Response);

    const result = await prepareAction({
      actionUrl: "https://api.example.com/actions/save",
      account: "9xDefABCabc123",
      params: { freq: "weekly", amount: 20 },
    });

    expect(result.txBase64).toBe("base64tx==");
    expect(result.confirmUrl).toBe("https://api.example.com/confirm?foo=1");
    expect(result.message).toBe("Sign to authorize");
  });

  it("resolves relative confirmUrl against actionUrl", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ label: "Act" }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          transaction: "tx",
          links: { next: { type: "post", href: "/confirm?a=1" } },
        }),
      } as Response);

    const result = await prepareAction({
      actionUrl: "https://api.example.com/actions/save",
      account: "wallet",
    });

    expect(result.confirmUrl).toBe("https://api.example.com/confirm?a=1");
  });

  it("returns null confirmUrl when links.next is absent", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ title: "Act" }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ transaction: "tx" }),
      } as Response);

    const result = await prepareAction({
      actionUrl: "https://api.example.com/actions/save",
      account: "wallet",
    });

    expect(result.confirmUrl).toBeNull();
    expect(result.message).toBeNull();
  });

  it("throws when GET returns non-2xx", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 } as Response);

    expect(
      prepareAction({ actionUrl: "https://api.example.com/actions/save", account: "wallet" }),
    ).rejects.toThrow("Action GET failed: 404");
  });

  it("throws when GET response is not a valid Action", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ icon: "only-icon-no-label" }),
    } as Response);

    expect(
      prepareAction({ actionUrl: "https://api.example.com/actions/save", account: "wallet" }),
    ).rejects.toThrow("does not appear to be a Solana Action");
  });

  it("throws when POST returns non-2xx", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ title: "Act" }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "internal error",
      } as Response);

    expect(
      prepareAction({ actionUrl: "https://api.example.com/actions/save", account: "wallet" }),
    ).rejects.toThrow("Action POST failed: 500");
  });

  it("merges params into POST body alongside account", async () => {
    let capturedBody: unknown;
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ title: "Act" }),
      } as Response)
      .mockImplementationOnce(async (_url: string, init?: RequestInit) => {
        capturedBody = JSON.parse(init?.body as string);
        return { ok: true, json: async () => ({ transaction: "tx" }) } as Response;
      });

    await prepareAction({
      actionUrl: "https://api.example.com/actions/save",
      account: "mywallet",
      params: { freq: "daily", amount: 5 },
    });

    expect(capturedBody).toEqual({ account: "mywallet", freq: "daily", amount: 5 });
  });
});

// ── confirmAction ─────────────────────────────────────────────────────────────

describe("confirmAction", () => {
  it("posts signature and returns parsed JSON", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ type: "completed", message: "✅ Done" }),
    } as Response);

    const result = await confirmAction("https://api.example.com/confirm", "sig123");

    expect(result).toEqual({ type: "completed", message: "✅ Done" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.example.com/confirm");
    expect(JSON.parse(init.body as string)).toEqual({ signature: "sig123" });
  });

  it("throws on non-2xx with status and body in message", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => "bad signature",
    } as Response);

    expect(confirmAction("https://api.example.com/confirm", "badsig")).rejects.toThrow(
      "Confirm POST failed: 400",
    );
  });
});
