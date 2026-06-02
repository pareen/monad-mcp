import { formatUnits } from "viem";

export function formatNative(wei: bigint): string {
  return `${formatUnits(wei, 18)} MON`;
}

export function formatToken(amount: bigint, decimals: number, symbol: string): string {
  return `${formatUnits(amount, decimals)} ${symbol}`;
}

export function shortAddr(addr: string): string {
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
