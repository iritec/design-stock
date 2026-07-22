use std::{env, fs, path::PathBuf, process::Command};

fn main() {
    println!("cargo:rerun-if-changed=tagger/main.swift");

    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        build_tagger();
    }

    tauri_build::build()
}

fn build_tagger() {
    let manifest_dir =
        PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is not set"));
    let target = env::var("TARGET").expect("TARGET is not set");
    let binaries_dir = manifest_dir.join("binaries");
    fs::create_dir_all(&binaries_dir).expect("failed to create binaries directory for tagger");

    let output_path = binaries_dir.join(format!("tagger-{target}"));
    let module_cache = binaries_dir.join("module-cache");
    let output = Command::new("swiftc")
        .current_dir(&manifest_dir)
        .env("CLANG_MODULE_CACHE_PATH", &module_cache)
        .env("SWIFT_MODULECACHE_PATH", &module_cache)
        .args(["-O", "-parse-as-library", "tagger/main.swift", "-o"])
        .arg(&output_path)
        .output()
        .expect("failed to run swiftc while building the tagger sidecar");

    if !output.status.success() {
        panic!(
            "swiftc failed to build tagger sidecar (status {}):\n{}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
