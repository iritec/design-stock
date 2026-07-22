import { useEffect, useMemo, useState } from "react";
import type { StockItem } from "../types";
import { Card } from "./Card";

export interface GalleryProps {
  items: StockItem[];
  taggingIds: Set<string>;
  onOpen: (id: string) => void;
  onUpdateItem: (
    id: string,
    title?: string,
    tags?: string[],
    favorite?: boolean,
  ) => Promise<StockItem>;
  onDeleteItem: (id: string) => Promise<void>;
}

function getColumnCount() {
  if (window.matchMedia("(max-width: 540px)").matches) {
    return 2;
  }

  if (window.matchMedia("(max-width: 980px)").matches) {
    return 3;
  }

  return 5;
}

export function Gallery({
  items,
  taggingIds,
  onOpen,
  onUpdateItem,
  onDeleteItem,
}: GalleryProps) {
  const [columnCount, setColumnCount] = useState(getColumnCount);

  useEffect(() => {
    const mediaQueries = [
      window.matchMedia("(max-width: 540px)"),
      window.matchMedia("(max-width: 980px)"),
    ];
    const updateColumnCount = () => setColumnCount(getColumnCount());

    mediaQueries.forEach((query) => query.addEventListener("change", updateColumnCount));
    return () => {
      mediaQueries.forEach((query) =>
        query.removeEventListener("change", updateColumnCount),
      );
    };
  }, []);

  const columns = useMemo(() => {
    const nextColumns = Array.from({ length: columnCount }, () => ({
      estimatedHeight: 0,
      items: [] as { item: StockItem; index: number }[],
    }));

    items.forEach((item, index) => {
      const shortestColumn = nextColumns.reduce((shortest, column) =>
        column.estimatedHeight < shortest.estimatedHeight ? column : shortest,
      );
      shortestColumn.items.push({ item, index });
      shortestColumn.estimatedHeight += item.width > 0 ? item.height / item.width : 1;
    });

    return nextColumns;
  }, [columnCount, items]);

  return (
    <div className="gallery" aria-label="画像ギャラリー">
      {columns.map((column, columnIndex) => (
        <div className="gallery-column" key={columnIndex}>
          {column.items.map(({ item, index }) => (
            <Card
              key={item.id}
              item={item}
              revealIndex={index}
              tagging={taggingIds.has(item.id)}
              onOpen={onOpen}
              onUpdateItem={onUpdateItem}
              onDeleteItem={onDeleteItem}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
