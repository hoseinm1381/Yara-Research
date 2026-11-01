fn main() {
    let origin = std::env::args().nth(1).unwrap_or_default();
    let result = yara_research_lib::native_messaging(&origin);
    if let Err(error) = result {
        eprintln!("Yara native host: {error}");
        std::process::exit(1);
    }
}
