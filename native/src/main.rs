#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app;
mod audio;
mod input;
mod render;
mod settings;
mod ui;
mod update;
mod window;

fn main() -> anyhow::Result<()> {
    app::run()
}
