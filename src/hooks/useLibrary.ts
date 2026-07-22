import { useCallback, useEffect, useRef, useState } from "react";
import {
  autoTagItem as autoTagStockItem,
  deleteItem as deleteStockItem,
  importFiles,
  importImageBytes,
  listItems,
  updateItem as updateStockItem,
} from "../api";
import type { StockItem } from "../types";

export interface UseLibraryResult {
  items: StockItem[];
  loading: boolean;
  error: string | null;
  taggingIds: Set<string>;
  reload: () => Promise<void>;
  importPaths: (paths: string[]) => Promise<StockItem[]>;
  importBlob: (blob: Blob, sourceName: string) => Promise<StockItem>;
  updateItem: (
    id: string,
    title?: string,
    tags?: string[],
    favorite?: boolean,
  ) => Promise<StockItem>;
  autoTagItem: (id: string) => Promise<StockItem>;
  deleteItem: (id: string) => Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useLibrary(): UseLibraryResult {
  const [items, setItems] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [taggingIds, setTaggingIds] = useState<Set<string>>(() => new Set());
  const pendingCount = useRef(0);
  const autoTagQueue = useRef<Promise<void>>(Promise.resolve());
  const taggingPromises = useRef(new Map<string, Promise<StockItem>>());

  const runTask = useCallback(async <T,>(task: () => Promise<T>): Promise<T> => {
    pendingCount.current += 1;
    setLoading(true);
    setError(null);

    try {
      return await task();
    } catch (taskError) {
      setError(errorMessage(taskError));
      throw taskError;
    } finally {
      pendingCount.current -= 1;
      if (pendingCount.current === 0) {
        setLoading(false);
      }
    }
  }, []);

  const reload = useCallback(async (): Promise<void> => {
    const loadedItems = await runTask(listItems);
    setItems(loadedItems);
  }, [runTask]);

  const autoTagItem = useCallback((id: string): Promise<StockItem> => {
    const existingPromise = taggingPromises.current.get(id);
    if (existingPromise !== undefined) {
      return existingPromise;
    }

    setTaggingIds((currentIds) => new Set(currentIds).add(id));

    const taggingPromise = autoTagQueue.current.then(async () => {
      const updatedItem = await autoTagStockItem(id);
      setItems((currentItems) =>
        currentItems.map((item) => (item.id === id ? updatedItem : item)),
      );
      return updatedItem;
    });

    autoTagQueue.current = taggingPromise.then(
      () => undefined,
      () => undefined,
    );
    taggingPromises.current.set(id, taggingPromise);

    const finishTagging = () => {
      taggingPromises.current.delete(id);
      setTaggingIds((currentIds) => {
        const nextIds = new Set(currentIds);
        nextIds.delete(id);
        return nextIds;
      });
    };
    void taggingPromise.then(finishTagging, finishTagging);

    return taggingPromise;
  }, []);

  const autoTagImportedItems = useCallback(
    async (importedItems: StockItem[]): Promise<void> => {
      for (const item of importedItems) {
        try {
          await autoTagItem(item.id);
        } catch {
          // Auto-tagging is best-effort and must not fail the import.
        }
      }
    },
    [autoTagItem],
  );

  const importPaths = useCallback(
    async (paths: string[]): Promise<StockItem[]> => {
      const importedItems = await runTask(() => importFiles(paths));
      setItems((currentItems) => [...importedItems, ...currentItems]);
      await autoTagImportedItems(importedItems);
      return importedItems;
    },
    [autoTagImportedItems, runTask],
  );

  const importBlob = useCallback(
    async (blob: Blob, sourceName: string): Promise<StockItem> => {
      const importedItem = await runTask(async () => {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        return importImageBytes(bytes, sourceName);
      });
      setItems((currentItems) => [importedItem, ...currentItems]);
      await autoTagImportedItems([importedItem]);
      return importedItem;
    },
    [autoTagImportedItems, runTask],
  );

  const updateItem = useCallback(
    async (
      id: string,
      title?: string,
      tags?: string[],
      favorite?: boolean,
    ): Promise<StockItem> => {
      const updatedItem = await runTask(() =>
        updateStockItem(id, title, tags, favorite),
      );
      setItems((currentItems) =>
        currentItems.map((item) => (item.id === id ? updatedItem : item)),
      );
      return updatedItem;
    },
    [runTask],
  );

  const deleteItem = useCallback(
    async (id: string): Promise<void> => {
      await runTask(() => deleteStockItem(id));
      setItems((currentItems) =>
        currentItems.filter((item) => item.id !== id),
      );
    },
    [runTask],
  );

  useEffect(() => {
    void reload().catch(() => undefined);
  }, [reload]);

  return {
    items,
    loading,
    error,
    taggingIds,
    reload,
    importPaths,
    importBlob,
    updateItem,
    autoTagItem,
    deleteItem,
  };
}
