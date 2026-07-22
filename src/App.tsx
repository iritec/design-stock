import { useCallback, useEffect, useMemo, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { Gallery } from "./components/Gallery";
import { Lightbox } from "./components/Lightbox";
import { Toolbar, type SortOrder } from "./components/Toolbar";
import { useLibrary } from "./hooks/useLibrary";
import logoUrl from "./assets/logo.png";
import "./App.css";

const IMAGE_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "tiff",
] as const;
const IMAGE_EXTENSION_SET = new Set<string>(IMAGE_EXTENSIONS);
const MAX_VISIBLE_TAGS = 12;
const COLOR_FILTER_ORDER = [
  "赤",
  "オレンジ",
  "黄",
  "緑",
  "青",
  "紫",
  "ピンク",
  "茶",
  "白",
  "黒",
  "グレー",
] as const;

export interface LibraryFilters {
  query: string;
  selectedTags: string[];
  selectedColors: string[];
  favoritesOnly: boolean;
  sortOrder: SortOrder;
}

const INITIAL_FILTERS: LibraryFilters = {
  query: "",
  selectedTags: [],
  selectedColors: [],
  favoritesOnly: false,
  sortOrder: "newest",
};

function isImagePath(path: string): boolean {
  const extension = path.split(".").pop()?.toLowerCase();
  return extension !== undefined && IMAGE_EXTENSION_SET.has(extension);
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function App() {
  const {
    items,
    loading,
    error,
    taggingIds,
    importPaths,
    importBlob,
    updateItem,
    autoTagItem,
    deleteItem,
  } = useLibrary();
  const [dropActive, setDropActive] = useState(false);
  const [uiError, setUiError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filters, setFilters] = useState<LibraryFilters>(INITIAL_FILTERS);

  const rankedTags = useMemo(() => {
    const frequencies = new Map<string, number>();

    for (const item of items) {
      for (const tag of item.tags) {
        frequencies.set(tag, (frequencies.get(tag) ?? 0) + 1);
      }
    }

    return [...frequencies]
      .sort(
        ([tagA, countA], [tagB, countB]) =>
          countB - countA || tagA.localeCompare(tagB, "ja"),
      )
      .map(([name, count]) => ({ name, count }));
  }, [items]);

  const availableColors = useMemo(() => {
    const presentColors = new Set(items.flatMap((item) => item.colors));
    return COLOR_FILTER_ORDER.filter((color) => presentColors.has(color));
  }, [items]);

  const visibleItems = useMemo(() => {
    const normalizedQuery = filters.query.trim().toLocaleLowerCase("ja-JP");
    const filtered = items.filter((item) => {
      if (filters.favoritesOnly && !item.favorite) {
        return false;
      }

      if (
        !filters.selectedTags.every((selectedTag) =>
          item.tags.includes(selectedTag),
        )
      ) {
        return false;
      }

      if (
        filters.selectedColors.length > 0 &&
        !filters.selectedColors.some((color) => item.colors.includes(color))
      ) {
        return false;
      }

      if (normalizedQuery === "") {
        return true;
      }

      return [item.title, item.source_name, ...item.tags, ...item.colors]
        .join("\n")
        .toLocaleLowerCase("ja-JP")
        .includes(normalizedQuery);
    });

    return [...filtered].sort((itemA, itemB) =>
      filters.sortOrder === "newest"
        ? itemB.created_at - itemA.created_at
        : itemA.created_at - itemB.created_at,
    );
  }, [filters, items]);

  const hasActiveFilters =
    filters.query.trim() !== "" ||
    filters.selectedTags.length > 0 ||
    filters.selectedColors.length > 0 ||
    filters.favoritesOnly;

  const toggleTag = useCallback((tag: string) => {
    setFilters((current) => ({
      ...current,
      selectedTags: current.selectedTags.includes(tag)
        ? current.selectedTags.filter((selectedTag) => selectedTag !== tag)
        : [...current.selectedTags, tag],
    }));
  }, []);

  const toggleColor = useCallback((color: string) => {
    setFilters((current) => ({
      ...current,
      selectedColors: current.selectedColors.includes(color)
        ? current.selectedColors.filter(
            (selectedColor) => selectedColor !== color,
          )
        : [...current.selectedColors, color],
    }));
  }, []);

  const clearFilters = useCallback(() => {
    setFilters((current) => ({
      ...INITIAL_FILTERS,
      sortOrder: current.sortOrder,
    }));
  }, []);

  useEffect(() => {
    if (
      selectedId !== null &&
      !visibleItems.some((item) => item.id === selectedId)
    ) {
      setSelectedId(null);
    }
  }, [selectedId, visibleItems]);

  const handleAdd = useCallback(async () => {
    setUiError(null);

    try {
      const selected = await open({
        multiple: true,
        filters: [
          {
            name: "画像",
            extensions: [...IMAGE_EXTENSIONS],
          },
        ],
      });

      if (selected === null) {
        return;
      }

      const paths = Array.isArray(selected) ? selected : [selected];
      await importPaths(paths);
    } catch (addError) {
      setUiError(messageFrom(addError));
    }
  }, [importPaths]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "over") {
          setDropActive(true);
          return;
        }

        if (event.payload.type === "drop") {
          setDropActive(false);
          setUiError(null);
          const imagePaths = event.payload.paths.filter(isImagePath);
          if (imagePaths.length > 0) {
            void importPaths(imagePaths).catch(() => undefined);
          }
          return;
        }

        if (event.payload.type === "leave") {
          setDropActive(false);
        }
      })
      .then((stopListening) => {
        if (disposed) {
          stopListening();
        } else {
          unlisten = stopListening;
        }
      })
      .catch((listenerError: unknown) => {
        if (!disposed) {
          setUiError(messageFrom(listenerError));
        }
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [importPaths]);

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const clipboardItems = Array.from(event.clipboardData?.items ?? []);
      const imageFiles = clipboardItems.flatMap((item) => {
        if (item.kind !== "file" || !item.type.startsWith("image/")) {
          return [];
        }

        const file = item.getAsFile();
        return file === null ? [] : [file];
      });

      if (imageFiles.length === 0) {
        return;
      }

      event.preventDefault();
      setUiError(null);
      void Promise.all(
        imageFiles.map((file) => importBlob(file, file.name || "clipboard")),
      ).catch(() => undefined);
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [importBlob]);

  const visibleError = uiError ?? error;
  const showInitialLoading = loading && items.length === 0;
  const selectedItem = visibleItems.find((item) => item.id === selectedId);

  return (
    <div className="app-shell">
      <Toolbar
        totalCount={items.length}
        resultCount={visibleItems.length}
        loading={loading}
        searchQuery={filters.query}
        availableTags={rankedTags.slice(0, MAX_VISIBLE_TAGS)}
        hiddenTagCount={Math.max(0, rankedTags.length - MAX_VISIBLE_TAGS)}
        selectedTags={filters.selectedTags}
        availableColors={availableColors}
        selectedColors={filters.selectedColors}
        favoritesOnly={filters.favoritesOnly}
        sortOrder={filters.sortOrder}
        hasActiveFilters={hasActiveFilters}
        onAdd={() => void handleAdd()}
        onSearchChange={(query) =>
          setFilters((current) => ({ ...current, query }))
        }
        onTagToggle={toggleTag}
        onColorToggle={toggleColor}
        onFavoritesToggle={() =>
          setFilters((current) => ({
            ...current,
            favoritesOnly: !current.favoritesOnly,
          }))
        }
        onSortChange={(sortOrder) =>
          setFilters((current) => ({ ...current, sortOrder }))
        }
        onClear={clearFilters}
      />

      <main className="library">
        {visibleError !== null ? (
          <p className="error-message" role="alert">
            処理に失敗しました: {visibleError}
          </p>
        ) : null}

        {showInitialLoading ? (
          <div className="status-message" role="status">
            画像を読み込んでいます…
          </div>
        ) : items.length === 0 ? (
          <div className="empty-state">
            <img
              className="empty-state-logo"
              src={logoUrl}
              alt=""
              aria-hidden="true"
              draggable={false}
            />
            <p>最初のデザインをストック</p>
            <span>スクリーンショットや画像をここへドロップ</span>
            <div className="empty-shortcut">
              または <kbd>⌘</kbd><kbd>V</kbd> で貼り付け
            </div>
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="empty-state filtered-empty-state">
            <div className="empty-search-mark" aria-hidden="true" />
            <p>条件に一致する画像がありません</p>
            <span>検索語やタグの組み合わせを変えてみてください</span>
            <button type="button" onClick={clearFilters}>
              条件をクリア
            </button>
          </div>
        ) : (
          <Gallery
            items={visibleItems}
            onOpen={setSelectedId}
            onUpdateItem={updateItem}
            onDeleteItem={deleteItem}
            taggingIds={taggingIds}
          />
        )}
      </main>

      {selectedItem !== undefined ? (
        <Lightbox
          item={selectedItem}
          items={visibleItems}
          onClose={() => setSelectedId(null)}
          onSelect={setSelectedId}
          onUpdateItem={updateItem}
          onAutoTagItem={autoTagItem}
          onDeleteItem={deleteItem}
          tagging={taggingIds.has(selectedItem.id)}
        />
      ) : null}

      {dropActive ? (
        <div className="drop-overlay" role="status">
          <div>ここに画像をドロップ</div>
        </div>
      ) : null}
    </div>
  );
}

export default App;
