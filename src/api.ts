import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { StockItem } from "./types";

export function listItems(): Promise<StockItem[]> {
  return invoke<StockItem[]>("list_items");
}

export function importFiles(paths: string[]): Promise<StockItem[]> {
  return invoke<StockItem[]>("import_files", { paths });
}

export function importImageBytes(
  bytes: number[] | Uint8Array,
  sourceName: string,
): Promise<StockItem> {
  return invoke<StockItem>("import_image_bytes", { bytes, sourceName });
}

export function updateItem(
  id: string,
  title?: string,
  tags?: string[],
  favorite?: boolean,
): Promise<StockItem> {
  return invoke<StockItem>("update_item", { id, title, tags, favorite });
}

export function autoTagItem(id: string): Promise<StockItem> {
  return invoke<StockItem>("auto_tag_item", { id });
}

export function deleteItem(id: string): Promise<void> {
  return invoke<void>("delete_item", { id });
}

export function revealItem(id: string): Promise<void> {
  return invoke<void>("reveal_item", { id });
}

export function assetUrl(path: string): string {
  return convertFileSrc(path);
}
