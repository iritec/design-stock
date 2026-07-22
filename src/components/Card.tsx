import { useEffect, useRef, useState, type CSSProperties } from "react";
import { assetUrl } from "../api";
import type { StockItem } from "../types";

export interface CardProps {
  item: StockItem;
  revealIndex: number;
  tagging: boolean;
  onOpen: (id: string) => void;
  onUpdateItem: (
    id: string,
    title?: string,
    tags?: string[],
    favorite?: boolean,
  ) => Promise<StockItem>;
  onDeleteItem: (id: string) => Promise<void>;
}

export function Card({
  item,
  revealIndex,
  tagging,
  onOpen,
  onUpdateItem,
  onDeleteItem,
}: CardProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const fallbackAttempted = useRef(false);

  useEffect(() => {
    setConfirmingDelete(false);
    setBusy(false);
    fallbackAttempted.current = false;
  }, [item.id]);

  const toggleFavorite = async () => {
    setBusy(true);
    try {
      await onUpdateItem(item.id, undefined, undefined, !item.favorite);
    } catch {
      // useLibrary exposes the failure through its error state.
    } finally {
      setBusy(false);
    }
  };

  const deleteItem = async () => {
    setBusy(true);
    try {
      await onDeleteItem(item.id);
    } catch {
      setBusy(false);
    }
  };

  return (
    <article
      className="gallery-card"
      style={{ "--reveal-index": revealIndex } as CSSProperties}
    >
      <div className="card-image-wrap">
        <button
          className="card-image-button"
          type="button"
          onClick={() => onOpen(item.id)}
          aria-label={`${item.title || item.source_name}を開く`}
        >
          <img
            src={assetUrl(item.thumb_path)}
            alt={item.title || item.source_name}
            width={item.width}
            height={item.height}
            loading={revealIndex < 12 ? "eager" : "lazy"}
            onError={(event) => {
              if (fallbackAttempted.current) {
                return;
              }

              fallbackAttempted.current = true;
              event.currentTarget.src = assetUrl(item.image_path);
            }}
          />
        </button>

        <div className="card-actions">
          <button
            className={`icon-button${item.favorite ? " is-favorite" : ""}`}
            type="button"
            disabled={busy}
            onClick={() => void toggleFavorite()}
            aria-label={item.favorite ? "お気に入りから外す" : "お気に入りに追加"}
            title={item.favorite ? "お気に入りから外す" : "お気に入りに追加"}
          >
            {item.favorite ? "★" : "☆"}
          </button>
          <button
            className="icon-button danger-icon"
            type="button"
            disabled={busy}
            onClick={() => setConfirmingDelete(true)}
            aria-label="削除"
            title="削除"
          >
            ×
          </button>
        </div>

        {tagging ? (
          <span className="tagging-badge" role="status">
            <span className="mini-spinner" aria-hidden="true" />
            AIタグ生成中…
          </span>
        ) : null}
      </div>

      <div className="card-details">
        <div className="card-heading">
          <h2 title={item.title || item.source_name}>
            {item.title || item.source_name}
          </h2>
          <div className="card-meta">
            {item.colors.length > 0 ? (
              <div className="card-color-dots" aria-label="使用色">
                {item.colors.slice(0, 3).map((color) => {
                  const label = `${color}系`;
                  return (
                    <span
                      className="color-swatch"
                      data-color={color}
                      title={label}
                      key={color}
                    />
                  );
                })}
              </div>
            ) : null}
            <span className="card-dimensions">
              {item.width} × {item.height}
            </span>
          </div>
        </div>

        {item.tags.length > 0 ? (
          <div className="tag-list card-tag-list" aria-label="タグ">
            {item.tags.slice(0, 3).map((tag) => (
              <span className="tag-chip" key={tag}>
                {tag}
              </span>
            ))}
            {item.tags.length > 3 ? (
              <span className="tag-chip tag-chip-more">+{item.tags.length - 3}</span>
            ) : null}
          </div>
        ) : null}

        {confirmingDelete ? (
          <div className="card-delete-confirm" role="group" aria-label="削除の確認">
            <span>削除しますか？</span>
            <button
              type="button"
              disabled={busy}
              onClick={() => void deleteItem()}
            >
              はい
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmingDelete(false)}
            >
              取消
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}
