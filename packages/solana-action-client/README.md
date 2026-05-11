# @autohodl/solana-action-client

Wallet-agnostic TypeScript library for processing [Solana Actions](https://solana.com/docs/advanced/actions) endpoints.

## Install

```bash
npm install @autohodl/solana-action-client
```

## API

### `prepareAction(opts)` — get an unsigned transaction

Fetches the Action metadata, POSTs to get an unsigned transaction, and resolves the confirm URL. Does not sign.

```typescript
import { prepareAction } from "@autohodl/solana-action-client";

const { txBase64, confirmUrl, message } = await prepareAction({
  actionUrl: "https://autohodl.vercel.app/api/actions/authorize",
  account: "9xDef...abc",          // signer's public key
  params: { freq: "weekly", amount: 20 },
});
// txBase64   — base64-encoded unsigned transaction
// confirmUrl — absolute URL to POST signature to (null if no chain-call)
// message    — human-readable action message (null if absent)
```

### `confirmAction(confirmUrl, signature)` — complete the action

Posts the transaction signature to the confirm URL returned by `prepareAction`. Only call when `confirmUrl` is non-null.

```typescript
import { confirmAction } from "@autohodl/solana-action-client";

const result = await confirmAction(confirmUrl, signature);
// result — parsed JSON from the server (e.g. { type: "completed", message: "✅ Done" })
```

### `processAction(opts)` — full round-trip with injected signer

For contexts where you control the signer. Fetches, POSTs, calls your `sign` callback, and follows `links.next`.

```typescript
import { processAction } from "@autohodl/solana-action-client";

const { signature } = await processAction({
  actionUrl: "https://...",
  account: "9xDef...abc",
  params: { freq: "weekly", amount: 20 },
  sign: async (txBase64) => {
    // sign and broadcast, return signature
    return myWallet.signAndSend(txBase64);
  },
});
```

## Notes

- Does not handle Solana Actions with interactive `parameters` input fields.
- Relative `links.next.href` values are resolved against `actionUrl` automatically.
- All functions throw on non-2xx HTTP responses with status + body in the error message.
- `account` always takes precedence over any `account` key in `params`.
