// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `quire mcp`: the windowless MCP server that Claude starts (see mcp.rs).
    if std::env::args().nth(1).as_deref() == Some("mcp") {
        quire_lib::mcp::run();
        return;
    }
    quire_lib::run()
}
