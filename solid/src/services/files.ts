import { invoke } from "@tauri-apps/api/core";

export function base64ToBytes(encoded: string) {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function readDemoWorkbook() {
  const encoded = await invoke<string>("demo_workbook");
  return base64ToBytes(encoded);
}
