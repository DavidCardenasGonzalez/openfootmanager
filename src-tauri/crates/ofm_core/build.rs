use sha2::{Digest, Sha256};
use std::{
    env, fs,
    path::{Path, PathBuf},
};

fn source_files(directory: &Path, files: &mut Vec<PathBuf>) {
    for entry in fs::read_dir(directory).expect("read engine sources") {
        let path = entry.expect("engine source entry").path();
        if path.is_dir() {
            source_files(&path, files);
        } else if path.extension().is_some_and(|ext| ext == "rs") {
            files.push(path);
        }
    }
}

fn main() {
    let root = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").expect("crate directory"));
    let engine = root.join("../engine/src");
    println!("cargo:rerun-if-changed={}", engine.display());
    let mut files = Vec::new();
    source_files(&engine, &mut files);
    files.extend([
        root.join("src/live_match_manager.rs"),
        root.join("src/match_recording.rs"),
        root.join("../../Cargo.lock"),
        root.join("build.rs"),
    ]);
    files.sort();
    let mut hash = Sha256::new();
    for file in files {
        println!("cargo:rerun-if-changed={}", file.display());
        let source = fs::read(file).expect("read recording fingerprint source");
        // Delimit inputs without embedding machine-specific absolute paths.
        hash.update((source.len() as u64).to_le_bytes());
        hash.update(source);
    }
    println!(
        "cargo:rustc-env=OFM_RECORDING_FINGERPRINT={:x}",
        hash.finalize()
    );
}
