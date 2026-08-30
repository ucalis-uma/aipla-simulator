/// Tauri 2 アプリ本体。
///
/// UI は単一HTML（dist/aipura_simulator.html・file:// 相当の静的配信）で完結しており、
/// IPC コマンドは不要。将来ファイル保存等をネイティブ化する場合はここにコマンドを追加する。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
