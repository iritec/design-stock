import { useCallback, useEffect, useState } from "react";
import { assetUrl, revealItem } from "../api";
import type { StockItem } from "../types";

export interface LightboxProps {
  item: StockItem;
  items: StockItem[];
  tagging: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
  onUpdateItem: (
    id: string,
    title?: string,
    tags?: string[],
    favorite?: boolean,
  ) => Promise<StockItem>;
  onAutoTagItem: (id: string) => Promise<StockItem>;
  onDeleteItem: (id: string) => Promise<void>;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const fractionDigits = value >= 10 ? 0 : 1;
  return `${value.toFixed(fractionDigits)} ${units[unitIndex]}`;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  );
}

export function Lightbox({
  item,
  items,
  tagging,
  onClose,
  onSelect,
  onUpdateItem,
  onAutoTagItem,
  onDeleteItem,
}: LightboxProps) {
  const [title, setTitle] = useState(item.title);
  const [tagInput, setTagInput] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const currentIndex = items.findIndex((candidate) => candidate.id === item.id);

  useEffect(() => {
    setTitle(item.title);
    setTagInput("");
    setConfirmingDelete(false);
    setActionError(null);
  }, [item.id, item.title]);

  const navigate = useCallback(
    (direction: -1 | 1) => {
      const nextIndex = currentIndex + direction;
      const nextItem = items[nextIndex];
      if (nextItem !== undefined) {
        onSelect(nextItem.id);
      }
    },
    [currentIndex, items, onSelect],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) {
        return;
      }

      if (event.key === "Escape") {
        onClose();
      } else if (event.key === "ArrowLeft") {
        navigate(-1);
      } else if (event.key === "ArrowRight") {
        navigate(1);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [navigate, onClose]);

  const runAction = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setActionError(null);
    try {
      await action();
      return true;
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const commitTitle = async () => {
    if (title === item.title) {
      return;
    }

    const succeeded = await runAction(() =>
      onUpdateItem(item.id, title, undefined, undefined),
    );
    if (!succeeded) {
      setTitle(item.title);
    }
  };

  const addTag = async () => {
    const tag = tagInput.trim();
    if (tag === "") {
      setTagInput("");
      return;
    }

    if (item.tags.includes(tag)) {
      setTagInput("");
      return;
    }

    const succeeded = await runAction(() =>
      onUpdateItem(item.id, undefined, [...item.tags, tag], undefined),
    );
    if (succeeded) {
      setTagInput("");
    }
  };

  const removeTag = async (tag: string) => {
    await runAction(() =>
      onUpdateItem(
        item.id,
        undefined,
        item.tags.filter((candidate) => candidate !== tag),
        undefined,
      ),
    );
  };

  const toggleFavorite = async () => {
    await runAction(() =>
      onUpdateItem(item.id, undefined, undefined, !item.favorite),
    );
  };

  const generateAutoTags = async () => {
    await runAction(() => onAutoTagItem(item.id));
  };

  const deleteItem = async () => {
    const succeeded = await runAction(() => onDeleteItem(item.id));
    if (succeeded) {
      onClose();
    }
  };

  const reveal = async () => {
    await runAction(() => revealItem(item.id));
  };

  return (
    <div
      className="lightbox-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`${item.title || item.source_name}の詳細`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="lightbox">
        <section className="lightbox-preview">
          <button
            className="lightbox-close"
            type="button"
            onClick={onClose}
            aria-label="閉じる"
          >
            ×
          </button>

          <button
            className="lightbox-nav lightbox-nav-prev"
            type="button"
            disabled={currentIndex <= 0}
            onClick={() => navigate(-1)}
            aria-label="前の画像"
          >
            ‹
          </button>
          <img
            src={assetUrl(item.image_path)}
            alt={item.title || item.source_name}
          />
          <button
            className="lightbox-nav lightbox-nav-next"
            type="button"
            disabled={currentIndex < 0 || currentIndex >= items.length - 1}
            onClick={() => navigate(1)}
            aria-label="次の画像"
          >
            ›
          </button>
        </section>

        <aside className="lightbox-panel">
          <div className="lightbox-panel-heading">
            <span>IMAGE DETAILS</span>
            <strong>
              {currentIndex + 1} / {items.length}
            </strong>
          </div>
          <label className="field-label" htmlFor="lightbox-title">
            タイトル
          </label>
          <input
            id="lightbox-title"
            className="title-input"
            type="text"
            value={title}
            disabled={busy}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => void commitTitle()}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.currentTarget.blur();
              }
            }}
          />

          <div className="tags-editor">
            <div className="tags-editor-heading">
              <label className="field-label" htmlFor="lightbox-tags">
                タグ
              </label>
              <button
                className="ai-tag-button"
                type="button"
                disabled={busy || tagging}
                onClick={() => void generateAutoTags()}
              >
                {tagging ? (
                  <>
                    <span className="mini-spinner" aria-hidden="true" />
                    生成中…
                  </>
                ) : (
                  "AIタグを生成"
                )}
              </button>
            </div>
            <div className="tag-list">
              {item.tags.map((tag) => (
                <span className="tag-chip editable-tag" key={tag}>
                  {tag}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void removeTag(tag)}
                    aria-label={`${tag}タグを削除`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <input
              id="lightbox-tags"
              className="tag-input"
              type="text"
              value={tagInput}
              disabled={busy}
              placeholder="タグを入力して Enter"
              onChange={(event) => setTagInput(event.target.value)}
              onKeyDown={(event) => {
                if (
                  (event.key === "Enter" || event.key === ",") &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  void addTag();
                }
              }}
            />
          </div>

          <dl className="metadata-list">
            {item.colors.length > 0 ? (
              <div className="metadata-colors">
                <dt>カラー</dt>
                <dd>
                  {item.colors.slice(0, 3).map((color) => {
                    const label = `${color}系`;
                    return (
                      <span className="color-chip" key={color}>
                        <span
                          className="color-swatch"
                          data-color={color}
                          aria-hidden="true"
                        />
                        {label}
                      </span>
                    );
                  })}
                </dd>
              </div>
            ) : null}
            <div>
              <dt>サイズ</dt>
              <dd>
                {item.width} × {item.height}
              </dd>
            </div>
            <div>
              <dt>ファイル</dt>
              <dd>{formatFileSize(item.size_bytes)}</dd>
            </div>
            <div>
              <dt>追加日時</dt>
              <dd>{new Date(item.created_at).toLocaleString("ja-JP")}</dd>
            </div>
            <div>
              <dt>ソース</dt>
              <dd title={item.source_name}>{item.source_name}</dd>
            </div>
          </dl>

          {actionError !== null ? (
            <p className="panel-error" role="alert">
              処理に失敗しました: {actionError}
            </p>
          ) : null}

          <div className="panel-actions">
            <button
              className={`favorite-button${item.favorite ? " is-favorite" : ""}`}
              type="button"
              disabled={busy}
              onClick={() => void toggleFavorite()}
            >
              {item.favorite ? "★ お気に入り" : "☆ お気に入りに追加"}
            </button>
            <button type="button" disabled={busy} onClick={() => void reveal()}>
              Finderで表示
            </button>
          </div>

          <div className="delete-section">
            {confirmingDelete ? (
              <div className="delete-confirm" role="group" aria-label="削除の確認">
                <strong>本当に削除しますか？</strong>
                <div>
                  <button
                    className="danger-button"
                    type="button"
                    disabled={busy}
                    onClick={() => void deleteItem()}
                  >
                    はい、削除する
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirmingDelete(false)}
                  >
                    キャンセル
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="delete-button"
                type="button"
                disabled={busy}
                onClick={() => setConfirmingDelete(true)}
              >
                削除
              </button>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
