import type { BlinkAdapter, BlinkAdapterMetadata, SignMessageData } from "@dialectlabs/blinks";
import { DEFAULT_SUPPORTED_BLOCKCHAIN_IDS } from "@dialectlabs/blinks";

export class PrivyServerAdapter implements BlinkAdapter {
  readonly metadata: BlinkAdapterMetadata = {
    // Must use Dialect's CAIP-2 IDs: "solana:5eykt4..." / "solana:EtWTRAB..."
    supportedBlockchainIds: DEFAULT_SUPPORTED_BLOCKCHAIN_IDS,
  };

  constructor(
    private readonly walletAddress: string,
    private readonly freq: string,
    private readonly amount: number,
  ) {}

  async connect(): Promise<string> {
    return this.walletAddress;
  }

  async signTransaction(txBase64: string): Promise<{ signature: string }> {
    const res = await fetch(
      `/api/actions/sign?freq=${this.freq}&amount=${this.amount}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transaction: txBase64 }),
      },
    );

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error ?? `Signing failed (${res.status})`);
    }

    const { signature } = (await res.json()) as { signature: string };
    return { signature };
  }

  async confirmTransaction(_sig: string): Promise<void> {
    // Server already broadcast — nothing to do client-side.
  }

  async signMessage(_data: string | SignMessageData): Promise<{ signature: string }> {
    throw new Error("Message signing is not supported");
  }
}
