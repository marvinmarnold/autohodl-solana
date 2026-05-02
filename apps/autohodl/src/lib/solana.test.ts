import { expect, test, mock } from "bun:test";
import { Connection, Transaction } from "@solana/web3.js";
import { buildTokenApproveTransaction } from "./solana";

const USER_WALLET = "7nE9GvcwsqzYxmJLSrXmSKFtREvGQPsRsBFe3YWKmkn2";
const DELEGATE = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";

test("buildTokenApproveTransaction returns a valid base64 tx with one instruction", async () => {
  const connection = new Connection("https://api.devnet.solana.com");
  connection.getLatestBlockhash = mock(async () => ({
    blockhash: "EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N",
    lastValidBlockHeight: 1234,
  }));

  const base64Tx = await buildTokenApproveTransaction(USER_WALLET, DELEGATE, connection);

  expect(typeof base64Tx).toBe("string");
  expect(base64Tx.length).toBeGreaterThan(0);

  const buf = Buffer.from(base64Tx, "base64");
  const tx = Transaction.from(buf);
  expect(tx.instructions).toHaveLength(1);
  expect(tx.feePayer?.toString()).toBe(USER_WALLET);
});
