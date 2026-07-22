use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use image::{DynamicImage, GenericImageView, ImageFormat};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

const THUMBNAIL_MAX_EDGE: u32 = 640;
const LIBRARY_FILE: &str = "library.json";

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct StockItem {
    pub id: String,
    pub file_name: String,
    pub thumb_name: String,
    pub title: String,
    pub tags: Vec<String>,
    #[serde(default)]
    pub colors: Vec<String>,
    pub favorite: bool,
    pub width: u32,
    pub height: u32,
    pub size_bytes: u64,
    pub created_at: u64,
    pub source_name: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct StockItemDto {
    pub id: String,
    pub file_name: String,
    pub thumb_name: String,
    pub title: String,
    pub tags: Vec<String>,
    #[serde(default)]
    pub colors: Vec<String>,
    pub favorite: bool,
    pub width: u32,
    pub height: u32,
    pub size_bytes: u64,
    pub created_at: u64,
    pub source_name: String,
    pub image_path: String,
    pub thumb_path: String,
}

pub struct Library {
    base_dir: PathBuf,
    items: Vec<StockItem>,
}

impl Library {
    pub fn new(base_dir: impl AsRef<Path>) -> Result<Self, String> {
        let base_dir = absolute_path(base_dir.as_ref())?;
        fs::create_dir_all(base_dir.join("images"))
            .map_err(|error| format!("failed to create images directory: {error}"))?;
        fs::create_dir_all(base_dir.join("thumbs"))
            .map_err(|error| format!("failed to create thumbs directory: {error}"))?;

        let mut library = Self {
            base_dir,
            items: Vec::new(),
        };
        library.load()?;
        Ok(library)
    }

    pub fn load(&mut self) -> Result<(), String> {
        let path = self.base_dir.join(LIBRARY_FILE);
        if !path.exists() {
            self.items.clear();
            return self.save();
        }

        let contents = fs::read_to_string(&path)
            .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
        self.items = serde_json::from_str(&contents)
            .map_err(|error| format!("failed to parse {}: {error}", path.display()))?;

        let mut changed = false;
        for item in &mut self.items {
            if !item.colors.is_empty() {
                continue;
            }

            let thumb_path = self.base_dir.join("thumbs").join(&item.thumb_name);
            let image_path = self.base_dir.join("images").join(&item.file_name);
            if let Ok(image) = image::open(&thumb_path).or_else(|_| image::open(&image_path)) {
                let colors = dominant_colors(&image, 3);
                if !colors.is_empty() {
                    item.colors = colors;
                    changed = true;
                }
            }
        }

        if changed {
            self.save()?;
        }
        Ok(())
    }

    pub fn save(&self) -> Result<(), String> {
        let path = self.base_dir.join(LIBRARY_FILE);
        let json = serde_json::to_string_pretty(&self.items)
            .map_err(|error| format!("failed to serialize library: {error}"))?;
        fs::write(&path, json)
            .map_err(|error| format!("failed to write {}: {error}", path.display()))
    }

    pub fn import_file(&mut self, path: &Path) -> Result<Option<StockItem>, String> {
        let Some(extension) = accepted_extension(path) else {
            return Ok(None);
        };
        let Ok(image) = image::open(path) else {
            return Ok(None);
        };

        let metadata = fs::metadata(path)
            .map_err(|error| format!("failed to read metadata for {}: {error}", path.display()))?;
        let source_name = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();
        let title = path
            .file_stem()
            .map(|stem| stem.to_string_lossy().into_owned())
            .unwrap_or_default();

        let item = self.store_image(
            image,
            extension,
            title,
            source_name,
            metadata.len(),
            |destination| fs::copy(path, destination).map(|_| ()),
        )?;
        Ok(Some(item))
    }

    pub fn import_bytes(&mut self, bytes: &[u8], source_name: String) -> Result<StockItem, String> {
        let format = image::guess_format(bytes)
            .map_err(|error| format!("unsupported or invalid image bytes: {error}"))?;
        let extension =
            extension_for_format(format).ok_or_else(|| "unsupported image format".to_string())?;
        let image = image::load_from_memory_with_format(bytes, format)
            .map_err(|error| format!("failed to decode image bytes: {error}"))?;
        let size_bytes = u64::try_from(bytes.len())
            .map_err(|_| "image byte length does not fit in u64".to_string())?;

        self.store_image(
            image,
            extension,
            "Screenshot".to_string(),
            source_name,
            size_bytes,
            |destination| fs::write(destination, bytes),
        )
    }

    pub fn update(
        &mut self,
        id: &str,
        title: Option<String>,
        tags: Option<Vec<String>>,
        favorite: Option<bool>,
    ) -> Result<StockItem, String> {
        let item = self
            .items
            .iter_mut()
            .find(|item| item.id == id)
            .ok_or_else(|| format!("item not found: {id}"))?;

        if let Some(title) = title {
            item.title = title;
        }
        if let Some(tags) = tags {
            item.tags = tags;
        }
        if let Some(favorite) = favorite {
            item.favorite = favorite;
        }

        let updated = item.clone();
        self.save()?;
        Ok(updated)
    }

    pub fn merge_auto_tags(
        &mut self,
        id: &str,
        new_tags: &[String],
        max_new: usize,
    ) -> Result<StockItem, String> {
        let item = self
            .items
            .iter_mut()
            .find(|item| item.id == id)
            .ok_or_else(|| format!("item not found: {id}"))?;

        let mut added = 0;
        for new_tag in new_tags {
            let tag = new_tag.trim();
            if tag.is_empty()
                || item.tags.iter().any(|existing| existing.trim() == tag)
                || added == max_new
            {
                continue;
            }
            item.tags.push(tag.to_string());
            added += 1;
        }

        let updated = item.clone();
        self.save()?;
        Ok(updated)
    }

    pub fn delete(&mut self, id: &str) -> Result<(), String> {
        let item = self
            .items
            .iter()
            .find(|item| item.id == id)
            .cloned()
            .ok_or_else(|| format!("item not found: {id}"))?;

        remove_if_present(&self.base_dir.join("images").join(&item.file_name))?;
        remove_if_present(&self.base_dir.join("thumbs").join(&item.thumb_name))?;
        self.items.retain(|candidate| candidate.id != id);
        self.save()
    }

    pub fn list(&self) -> Vec<StockItem> {
        let mut items = self.items.clone();
        items.sort_by(|left, right| right.created_at.cmp(&left.created_at));
        items
    }

    pub fn image_path(&self, id: &str) -> Result<PathBuf, String> {
        let item = self
            .items
            .iter()
            .find(|item| item.id == id)
            .ok_or_else(|| format!("item not found: {id}"))?;
        Ok(self.base_dir.join("images").join(&item.file_name))
    }

    pub fn to_dto(&self, item: &StockItem) -> StockItemDto {
        StockItemDto {
            id: item.id.clone(),
            file_name: item.file_name.clone(),
            thumb_name: item.thumb_name.clone(),
            title: item.title.clone(),
            tags: item.tags.clone(),
            colors: item.colors.clone(),
            favorite: item.favorite,
            width: item.width,
            height: item.height,
            size_bytes: item.size_bytes,
            created_at: item.created_at,
            source_name: item.source_name.clone(),
            image_path: self
                .base_dir
                .join("images")
                .join(&item.file_name)
                .to_string_lossy()
                .into_owned(),
            thumb_path: self
                .base_dir
                .join("thumbs")
                .join(&item.thumb_name)
                .to_string_lossy()
                .into_owned(),
        }
    }

    fn store_image<F>(
        &mut self,
        image: DynamicImage,
        extension: &str,
        title: String,
        source_name: String,
        size_bytes: u64,
        write_original: F,
    ) -> Result<StockItem, String>
    where
        F: FnOnce(&Path) -> std::io::Result<()>,
    {
        let id = Uuid::new_v4().to_string();
        let file_name = format!("{id}.{extension}");
        let thumb_name = format!("{id}.png");
        let image_path = self.base_dir.join("images").join(&file_name);
        let thumb_path = self.base_dir.join("thumbs").join(&thumb_name);
        let (width, height) = image.dimensions();
        let created_at = unix_millis()?;
        let colors = dominant_colors(&image, 3);

        write_original(&image_path).map_err(|error| {
            format!(
                "failed to store original at {}: {error}",
                image_path.display()
            )
        })?;

        let thumbnail = if width.max(height) > THUMBNAIL_MAX_EDGE {
            image.thumbnail(THUMBNAIL_MAX_EDGE, THUMBNAIL_MAX_EDGE)
        } else {
            image.clone()
        };
        if let Err(error) = thumbnail.save_with_format(&thumb_path, ImageFormat::Png) {
            let _ = fs::remove_file(&image_path);
            return Err(format!(
                "failed to write thumbnail at {}: {error}",
                thumb_path.display()
            ));
        }

        let item = StockItem {
            id,
            file_name,
            thumb_name,
            title,
            tags: Vec::new(),
            colors,
            favorite: false,
            width,
            height,
            size_bytes,
            created_at,
            source_name,
        };
        self.items.push(item.clone());

        if let Err(error) = self.save() {
            self.items.pop();
            let _ = fs::remove_file(image_path);
            let _ = fs::remove_file(thumb_path);
            return Err(error);
        }

        Ok(item)
    }
}

pub fn dominant_colors(image: &DynamicImage, max: usize) -> Vec<String> {
    const BUCKET_NAMES: [&str; 11] = [
        "黒",
        "白",
        "グレー",
        "赤",
        "オレンジ",
        "茶",
        "黄",
        "緑",
        "青",
        "紫",
        "ピンク",
    ];

    if max == 0 {
        return Vec::new();
    }

    let thumbnail = image.thumbnail(64, 64);
    let mut counts = [0_u64; BUCKET_NAMES.len()];
    let mut total = 0_u64;

    for (_, _, pixel) in thumbnail.pixels() {
        let [red, green, blue, alpha] = pixel.0;
        if alpha < 128 {
            continue;
        }

        let red = f32::from(red) / 255.0;
        let green = f32::from(green) / 255.0;
        let blue = f32::from(blue) / 255.0;
        let value = red.max(green).max(blue);
        let min = red.min(green).min(blue);
        let delta = value - min;
        let saturation = if value == 0.0 { 0.0 } else { delta / value };

        let bucket = if value < 0.16 {
            0
        } else if saturation < 0.12 {
            if value > 0.85 {
                1
            } else {
                2
            }
        } else {
            let hue = if value == red {
                60.0 * ((green - blue) / delta).rem_euclid(6.0)
            } else if value == green {
                60.0 * ((blue - red) / delta + 2.0)
            } else {
                60.0 * ((red - green) / delta + 4.0)
            };

            if !(15.0..345.0).contains(&hue) {
                3
            } else if hue < 45.0 {
                if value < 0.62 {
                    5
                } else {
                    4
                }
            } else if hue < 70.0 {
                6
            } else if hue < 165.0 {
                7
            } else if hue < 255.0 {
                8
            } else if hue < 290.0 {
                9
            } else {
                10
            }
        };

        counts[bucket] += 1;
        total += 1;
    }

    if total == 0 {
        return Vec::new();
    }

    let mut ranked: Vec<_> = counts.into_iter().enumerate().collect();
    ranked.sort_by(|left, right| right.1.cmp(&left.1));
    let qualifying: Vec<_> = ranked
        .iter()
        .copied()
        .filter(|(_, count)| count * 10 >= total)
        .take(max)
        .collect();
    let selected = if qualifying.is_empty() {
        &ranked[..1]
    } else {
        qualifying.as_slice()
    };

    selected
        .iter()
        .map(|(index, _)| BUCKET_NAMES[*index].to_string())
        .collect()
}

fn absolute_path(path: &Path) -> Result<PathBuf, String> {
    if path.is_absolute() {
        Ok(path.to_path_buf())
    } else {
        std::env::current_dir()
            .map(|current_dir| current_dir.join(path))
            .map_err(|error| format!("failed to resolve base directory: {error}"))
    }
}

fn accepted_extension(path: &Path) -> Option<&'static str> {
    let extension = path.extension()?.to_str()?;
    match extension.to_ascii_lowercase().as_str() {
        "png" => Some("png"),
        "jpg" => Some("jpg"),
        "jpeg" => Some("jpeg"),
        "gif" => Some("gif"),
        "webp" => Some("webp"),
        "bmp" => Some("bmp"),
        "tiff" => Some("tiff"),
        _ => None,
    }
}

fn extension_for_format(format: ImageFormat) -> Option<&'static str> {
    match format {
        ImageFormat::Png => Some("png"),
        ImageFormat::Jpeg => Some("jpg"),
        ImageFormat::Gif => Some("gif"),
        ImageFormat::WebP => Some("webp"),
        ImageFormat::Bmp => Some("bmp"),
        ImageFormat::Tiff => Some("tiff"),
        _ => None,
    }
}

fn unix_millis() -> Result<u64, String> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("system time is before unix epoch: {error}"))?
        .as_millis();
    u64::try_from(millis).map_err(|_| "unix timestamp does not fit in u64".to_string())
}

fn remove_if_present(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("failed to remove {}: {error}", path.display())),
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, io::Cursor, path::Path};

    use image::{DynamicImage, GenericImageView, ImageBuffer, ImageFormat, Rgba};
    use tempfile::tempdir;

    use super::{dominant_colors, Library};

    fn png_bytes(width: u32, height: u32) -> Vec<u8> {
        let image = DynamicImage::ImageRgba8(ImageBuffer::from_pixel(
            width,
            height,
            Rgba([20, 40, 60, 255]),
        ));
        let mut bytes = Cursor::new(Vec::new());
        image.write_to(&mut bytes, ImageFormat::Png).unwrap();
        bytes.into_inner()
    }

    #[test]
    fn imports_png_file_and_creates_thumbnail() {
        let temp = tempdir().unwrap();
        let source_path = temp.path().join("Wide Sample.PNG");
        let source_bytes = png_bytes(1200, 600);
        fs::write(&source_path, &source_bytes).unwrap();
        let mut library = Library::new(temp.path().join("library")).unwrap();

        let item = library.import_file(&source_path).unwrap().unwrap();
        let dto = library.to_dto(&item);
        let thumbnail = image::open(&dto.thumb_path).unwrap();

        assert_eq!(item.title, "Wide Sample");
        assert_eq!(item.source_name, "Wide Sample.PNG");
        assert_eq!((item.width, item.height), (1200, 600));
        assert_eq!(item.size_bytes, source_bytes.len() as u64);
        assert_eq!(library.list().len(), 1);
        assert_eq!(fs::read(&dto.image_path).unwrap(), source_bytes);
        assert!(thumbnail.dimensions().0.max(thumbnail.dimensions().1) <= 640);
    }

    #[test]
    fn imports_png_bytes_and_creates_files() {
        let temp = tempdir().unwrap();
        let bytes = png_bytes(80, 40);
        let mut library = Library::new(temp.path()).unwrap();

        let item = library
            .import_bytes(&bytes, "clipboard".to_string())
            .unwrap();
        let dto = library.to_dto(&item);
        let thumbnail = image::open(&dto.thumb_path).unwrap();

        assert_eq!(item.title, "Screenshot");
        assert_eq!(item.source_name, "clipboard");
        assert_eq!(item.colors, vec!["青"]);
        assert_eq!(dto.colors, item.colors);
        assert_eq!((item.width, item.height), (80, 40));
        assert_eq!(item.size_bytes, bytes.len() as u64);
        assert_eq!(fs::read(&dto.image_path).unwrap(), bytes);
        assert_eq!(thumbnail.dimensions(), (80, 40));
    }

    #[test]
    fn update_round_trips_through_save_and_load() {
        let temp = tempdir().unwrap();
        let bytes = png_bytes(10, 10);
        let mut library = Library::new(temp.path()).unwrap();
        let item = library
            .import_bytes(&bytes, "clipboard".to_string())
            .unwrap();

        library
            .update(
                &item.id,
                Some("Pinned reference".to_string()),
                Some(vec!["mobile".to_string(), "dark".to_string()]),
                Some(true),
            )
            .unwrap();

        let mut reloaded = Library::new(temp.path()).unwrap();
        reloaded.load().unwrap();
        let updated = reloaded.list().pop().unwrap();
        assert_eq!(updated.title, "Pinned reference");
        assert_eq!(updated.tags, vec!["mobile", "dark"]);
        assert!(updated.favorite);
    }

    #[test]
    fn merge_auto_tags_limits_dedupes_preserves_and_persists() {
        let temp = tempdir().unwrap();
        let bytes = png_bytes(10, 10);
        let mut library = Library::new(temp.path()).unwrap();
        let item = library
            .import_bytes(&bytes, "clipboard".to_string())
            .unwrap();
        library
            .update(
                &item.id,
                None,
                Some(vec!["existing".to_string(), "Keep Me".to_string()]),
                None,
            )
            .unwrap();

        let updated = library
            .merge_auto_tags(
                &item.id,
                &[
                    " existing ".to_string(),
                    "first".to_string(),
                    "first".to_string(),
                    "second".to_string(),
                    "third".to_string(),
                    "fourth".to_string(),
                ],
                3,
            )
            .unwrap();

        assert_eq!(
            updated.tags,
            vec!["existing", "Keep Me", "first", "second", "third"]
        );
        let reloaded = Library::new(temp.path()).unwrap();
        assert_eq!(reloaded.list()[0].tags, updated.tags);
    }

    #[test]
    fn merge_auto_tags_skips_empty_and_whitespace_tags() {
        let temp = tempdir().unwrap();
        let bytes = png_bytes(10, 10);
        let mut library = Library::new(temp.path()).unwrap();
        let item = library
            .import_bytes(&bytes, "clipboard".to_string())
            .unwrap();

        let updated = library
            .merge_auto_tags(
                &item.id,
                &["".to_string(), "   \n".to_string(), " valid ".to_string()],
                3,
            )
            .unwrap();

        assert_eq!(updated.tags, vec!["valid"]);
    }

    #[test]
    fn delete_removes_metadata_and_files() {
        let temp = tempdir().unwrap();
        let bytes = png_bytes(10, 10);
        let mut library = Library::new(temp.path()).unwrap();
        let item = library
            .import_bytes(&bytes, "clipboard".to_string())
            .unwrap();
        let dto = library.to_dto(&item);

        library.delete(&item.id).unwrap();

        assert!(library.list().is_empty());
        assert!(!Path::new(&dto.image_path).exists());
        assert!(!Path::new(&dto.thumb_path).exists());
        assert!(Library::new(temp.path()).unwrap().list().is_empty());
    }

    #[test]
    fn list_is_sorted_by_created_at_descending() {
        let temp = tempdir().unwrap();
        let bytes = png_bytes(10, 10);
        let mut library = Library::new(temp.path()).unwrap();
        let older = library.import_bytes(&bytes, "older".to_string()).unwrap();
        let newer = library.import_bytes(&bytes, "newer".to_string()).unwrap();
        library
            .items
            .iter_mut()
            .find(|item| item.id == older.id)
            .unwrap()
            .created_at = 1;
        library
            .items
            .iter_mut()
            .find(|item| item.id == newer.id)
            .unwrap()
            .created_at = 2;

        let items = library.list();
        assert_eq!(items[0].id, newer.id);
        assert_eq!(items[1].id, older.id);
    }

    #[test]
    fn dominant_colors_classifies_solid_blue() {
        let image =
            DynamicImage::ImageRgba8(ImageBuffer::from_pixel(20, 20, Rgba([0, 0, 255, 255])));

        assert_eq!(dominant_colors(&image, 3), vec!["青"]);
    }

    #[test]
    fn dominant_colors_orders_two_colors_by_share() {
        let image = DynamicImage::ImageRgba8(ImageBuffer::from_fn(10, 10, |x, _| {
            if x < 7 {
                Rgba([0, 0, 255, 255])
            } else {
                Rgba([255, 0, 0, 255])
            }
        }));

        assert_eq!(dominant_colors(&image, 3), vec!["青", "赤"]);
    }

    #[test]
    fn dominant_colors_classifies_black_white_and_gray() {
        let cases = [
            (Rgba([40, 0, 0, 255]), "黒"),
            (Rgba([250, 250, 250, 255]), "白"),
            (Rgba([128, 130, 128, 255]), "グレー"),
        ];

        for (pixel, expected) in cases {
            let image = DynamicImage::ImageRgba8(ImageBuffer::from_pixel(10, 10, pixel));
            assert_eq!(dominant_colors(&image, 3), vec![expected]);
        }
    }

    #[test]
    fn load_backfills_and_persists_missing_colors() {
        let temp = tempdir().unwrap();
        let base_dir = temp.path();
        fs::create_dir_all(base_dir.join("images")).unwrap();
        fs::create_dir_all(base_dir.join("thumbs")).unwrap();
        let thumb =
            DynamicImage::ImageRgba8(ImageBuffer::from_pixel(10, 10, Rgba([0, 0, 255, 255])));
        thumb.save(base_dir.join("thumbs/item.png")).unwrap();
        fs::write(
            base_dir.join("library.json"),
            r#"[
  {
    "id": "item",
    "file_name": "item.png",
    "thumb_name": "item.png",
    "title": "Legacy item",
    "tags": [],
    "favorite": false,
    "width": 10,
    "height": 10,
    "size_bytes": 0,
    "created_at": 1,
    "source_name": "item.png"
  }
]"#,
        )
        .unwrap();

        let library = Library::new(base_dir).unwrap();

        assert_eq!(library.list()[0].colors, vec!["青"]);
        let persisted: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(base_dir.join("library.json")).unwrap())
                .unwrap();
        assert_eq!(persisted[0]["colors"], serde_json::json!(["青"]));
    }
}
