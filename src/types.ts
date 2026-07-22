export interface StockItem {
  id: string;
  file_name: string;
  thumb_name: string;
  title: string;
  tags: string[];
  colors: string[];
  favorite: boolean;
  width: number;
  height: number;
  size_bytes: number;
  created_at: number;
  source_name: string;
  image_path: string;
  thumb_path: string;
}
