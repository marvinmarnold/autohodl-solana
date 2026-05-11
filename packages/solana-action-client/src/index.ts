const SOLANA_MAINNET_RPC = "https://api.mainnet-beta.solana.com";

export type ActionGetResponse = {
  title?: string;
  label?: string;
  description?: string;
  icon?: string;
  links?: {
    actions?: Array<{ label: string; href: string; type?: string }>;
  };
};

export type ActionPostResponse = {
  transaction: string;
  message?: string;
  links?: {
    next?: {
      type: "post" | "inline";
      href?: string;
      action?: unknown;
    };
  };
};

export type PrepareActionOpts = {
  actionUrl: string;
  account: string;
  params?: Record<string, unknown>;
};

export type PrepareActionResult = {
  txBase64: string;
  confirmUrl: string | null; // resolved absolute URL from links.next.href
  message: string | null;
};

export type ProcessActionOpts = {
  /** Full URL to the Solana Action endpoint */
  actionUrl: string;
  /** Signer's base58 public key */
  account: string;
  /** Merged into POST body alongside { account } */
  params?: Record<string, unknown>;
  /** Defaults to Solana mainnet-beta */
  rpcUrl?: string;
  /**
   * Injected signer — receives a base64-encoded unsigned transaction,
   * must return the base58 transaction signature after signing + broadcasting.
   * Keeping this injected makes the library wallet-agnostic.
   */
  sign: (txBase64: string) => Promise<string>;
};

export type ProcessActionResult = {
  signature: string;
  nextResult?: unknown;
};

/**
 * Steps 1-2 mirror processAction's fetch logic; extract a shared helper if a third consumer appears.
 * Fetches and validates a Solana Action, then POSTs to get an unsigned transaction.
 * Returns the base64 tx, the resolved confirm URL (from links.next), and the message.
 * Does NOT sign — caller is responsible for signing and broadcasting.
 */
export async function prepareAction(opts: PrepareActionOpts): Promise<PrepareActionResult> {
  const { actionUrl, account, params = {} } = opts;

  // Step 1: validate it's a real Action
  const getRes = await fetch(actionUrl, { headers: { Accept: "application/json" } });
  if (!getRes.ok) {
    throw new Error(`Action GET failed: ${getRes.status} ${actionUrl}`);
  }
  const actionMeta = (await getRes.json()) as ActionGetResponse;
  if (!actionMeta.label && !actionMeta.title) {
    throw new Error(
      `Response from ${actionUrl} does not appear to be a Solana Action (missing label/title)`,
    );
  }

  // Step 2: POST to get the unsigned transaction
  const postRes = await fetch(actionUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...params, account }),
  });
  if (!postRes.ok) {
    const body = await postRes.text().catch(() => "(unreadable)");
    throw new Error(`Action POST failed: ${postRes.status} — ${body}`);
  }
  const postData = (await postRes.json()) as ActionPostResponse;
  if (!postData.transaction) {
    throw new Error("Action POST response missing transaction field");
  }

  // Step 3: resolve links.next.href to an absolute URL
  const nextHref = postData.links?.next?.href ?? null;
  let confirmUrl: string | null = null;
  if (nextHref) {
    confirmUrl = nextHref.startsWith("http")
      ? nextHref
      : new URL(nextHref, actionUrl).toString();
  }

  return {
    txBase64: postData.transaction,
    confirmUrl,
    message: postData.message ?? null,
  };
}

/**
 * Posts a transaction signature to the confirm URL (links.next chain-call).
 * Returns the parsed JSON response from the server.
 * Throws on non-2xx responses.
 */
export async function confirmAction(confirmUrl: string, signature: string): Promise<unknown> {
  const res = await fetch(confirmUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ signature }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    throw new Error(`Confirm POST failed: ${res.status} — ${body}`);
  }
  return res.json();
}

/**
 * Process any Solana Action endpoint:
 * 1. GET the action URL to validate it is a real Action
 * 2. POST with { account, ...params } to get the unsigned transaction
 * 3. Call opts.sign(txBase64) → signature
 * 4. If the POST response includes links.next, follow the chain
 *
 * Does NOT handle Action `parameters` input fields (fixed-param Actions only).
 */
export async function processAction(opts: ProcessActionOpts): Promise<ProcessActionResult> {
  const { actionUrl, account, params = {}, rpcUrl = SOLANA_MAINNET_RPC, sign } = opts;

  // Step 1: validate it's a real Action
  const getRes = await fetch(actionUrl, {
    headers: { Accept: "application/json" },
  });
  if (!getRes.ok) {
    throw new Error(`Action GET failed: ${getRes.status} ${actionUrl}`);
  }
  const actionMeta = (await getRes.json()) as ActionGetResponse;
  if (!actionMeta.label && !actionMeta.title) {
    throw new Error(`Response from ${actionUrl} does not appear to be a Solana Action (missing label/title)`);
  }

  // Step 2: POST to get the unsigned transaction
  const postRes = await fetch(actionUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...params, account }),
  });
  if (!postRes.ok) {
    const body = await postRes.text().catch(() => "(unreadable)");
    throw new Error(`Action POST failed: ${postRes.status} — ${body}`);
  }
  const postData = (await postRes.json()) as ActionPostResponse;
  if (!postData.transaction) {
    throw new Error("Action POST response missing transaction field");
  }

  // Step 3: sign (and broadcast) via injected signer
  const signature = await sign(postData.transaction);

  // Step 4: follow links.next if present
  let nextResult: unknown;
  const next = postData.links?.next;
  if (next?.type === "post" && next.href) {
    const confirmUrl = next.href.startsWith("http") ? next.href : new URL(next.href, actionUrl).toString();
    const confirmRes = await fetch(confirmUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signature }),
    });
    if (confirmRes.ok) {
      nextResult = await confirmRes.json().catch(() => null);
    } else {
      console.warn(`links.next POST failed: ${confirmRes.status} ${confirmUrl}`);
    }
  }

  return { signature, nextResult };
}
