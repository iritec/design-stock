import { getCurrentWindow } from "@tauri-apps/api/window";
import type { MouseEvent } from "react";
import logoUrl from "../assets/logo.png";

export type SortOrder = "newest" | "oldest";

export interface ToolbarTag {
  name: string;
  count: number;
}

export interface ToolbarProps {
  totalCount: number;
  resultCount: number;
  loading: boolean;
  searchQuery: string;
  availableTags: ToolbarTag[];
  hiddenTagCount: number;
  selectedTags: string[];
  availableColors: readonly string[];
  selectedColors: string[];
  favoritesOnly: boolean;
  sortOrder: SortOrder;
  hasActiveFilters: boolean;
  onAdd: () => void;
  onSearchChange: (query: string) => void;
  onTagToggle: (tag: string) => void;
  onColorToggle: (color: string) => void;
  onFavoritesToggle: () => void;
  onSortChange: (sortOrder: SortOrder) => void;
  onClear: () => void;
}

export function Toolbar({
  totalCount,
  resultCount,
  loading,
  searchQuery,
  availableTags,
  hiddenTagCount,
  selectedTags,
  availableColors,
  selectedColors,
  favoritesOnly,
  sortOrder,
  hasActiveFilters,
  onAdd,
  onSearchChange,
  onTagToggle,
  onColorToggle,
  onFavoritesToggle,
  onSortChange,
  onClear,
}: ToolbarProps) {
  const isFiltered = hasActiveFilters;

  const handleMouseDown = (event: MouseEvent<HTMLElement>) => {
    const interactiveTarget = (event.target as HTMLElement).closest(
      'button, input, select, textarea, a, [role="button"]',
    );

    if (event.button !== 0 || interactiveTarget !== null) {
      return;
    }

    if (event.detail === 2) {
      void getCurrentWindow().toggleMaximize();
      return;
    }

    void getCurrentWindow().startDragging();
  };

  return (
    <header className="app-header" onMouseDown={handleMouseDown}>
      <div className="header-top">
        <div className="wordmark">
          <img
            className="wordmark-logo"
            src={logoUrl}
            alt=""
            aria-hidden="true"
            draggable={false}
          />
          <div>
            <h1>Design Stock</h1>
            <p className="item-count" aria-live="polite">
              {isFiltered ? `${resultCount}枚 / 全${totalCount}枚` : `${totalCount}枚`}
              {loading ? <span className="loading-dot"> 更新中</span> : null}
            </p>
          </div>
        </div>

        <button
          className="add-button"
          type="button"
          disabled={loading}
          onClick={onAdd}
        >
          <span aria-hidden="true">＋</span>
          画像を追加
        </button>
      </div>

      <div className="toolbar-controls">
        <label className="search-control">
          <span className="search-icon" aria-hidden="true" />
          <span className="visually-hidden">画像を検索</span>
          <input
            type="search"
            value={searchQuery}
            placeholder="タイトル・ファイル名・タグ・色を検索"
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </label>

        <button
          className={`favorite-filter${favoritesOnly ? " is-active" : ""}`}
          type="button"
          aria-pressed={favoritesOnly}
          onClick={onFavoritesToggle}
          title="お気に入りのみ"
        >
          <span aria-hidden="true">★</span>
          お気に入り
        </button>

        <div className="sort-control" aria-label="並び順">
          <button
            type="button"
            className={sortOrder === "newest" ? "is-active" : ""}
            aria-pressed={sortOrder === "newest"}
            onClick={() => onSortChange("newest")}
          >
            新しい順
          </button>
          <button
            type="button"
            className={sortOrder === "oldest" ? "is-active" : ""}
            aria-pressed={sortOrder === "oldest"}
            onClick={() => onSortChange("oldest")}
          >
            古い順
          </button>
        </div>

        <button
          className="clear-filter-button"
          type="button"
          disabled={!hasActiveFilters}
          onClick={onClear}
        >
          クリア
        </button>
      </div>

      {availableColors.length > 0 ? (
        <div className="color-filter-row" aria-label="色で絞り込み">
          <span className="tag-filter-label">COLORS</span>
          <div className="tag-filter-list">
            {availableColors.map((color) => {
              const selected = selectedColors.includes(color);
              const label = ["白", "黒", "グレー"].includes(color)
                ? color
                : `${color}系`;
              return (
                <button
                  className={`color-filter-chip${selected ? " is-active" : ""}`}
                  type="button"
                  key={color}
                  aria-pressed={selected}
                  onClick={() => onColorToggle(color)}
                >
                  <span
                    className="color-swatch"
                    data-color={color}
                    aria-hidden="true"
                  />
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {availableTags.length > 0 ? (
        <div className="tag-filter-row" aria-label="タグで絞り込み">
          <span className="tag-filter-label">TAGS</span>
          <div className="tag-filter-list">
            {availableTags.map((tag) => {
              const selected = selectedTags.includes(tag.name);
              return (
                <button
                  className={`filter-chip${selected ? " is-active" : ""}`}
                  type="button"
                  key={tag.name}
                  aria-pressed={selected}
                  onClick={() => onTagToggle(tag.name)}
                >
                  {tag.name}
                  <span>{tag.count}</span>
                </button>
              );
            })}
            {hiddenTagCount > 0 ? (
              <span className="tag-overflow" title={`ほか${hiddenTagCount}タグ`}>
                +{hiddenTagCount}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </header>
  );
}
