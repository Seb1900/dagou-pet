use anyhow::{Context, Result};
use windows::Win32::Foundation::HINSTANCE;
#[cfg(debug_assertions)]
use windows::Win32::UI::WindowsAndMessaging::IDC_HAND;
use windows::Win32::UI::WindowsAndMessaging::{HCURSOR, LoadCursorW};
use windows::core::PCWSTR;

const CURSOR_GRAB_RESOURCE: u16 = 101;
const CURSOR_GRABBING_RESOURCE: u16 = 102;

pub struct DragCursors {
    grab: HCURSOR,
    grabbing: HCURSOR,
}

impl DragCursors {
    pub fn load(instance: HINSTANCE) -> Result<Self> {
        Ok(Self {
            grab: load_cursor(instance, CURSOR_GRAB_RESOURCE, "grab")?,
            grabbing: load_cursor(instance, CURSOR_GRABBING_RESOURCE, "grabbing")?,
        })
    }

    pub fn grab(&self) -> HCURSOR {
        self.grab
    }

    pub fn grabbing(&self) -> HCURSOR {
        self.grabbing
    }
}

fn load_cursor(instance: HINSTANCE, resource: u16, name: &str) -> Result<HCURSOR> {
    match unsafe { LoadCursorW(Some(instance), PCWSTR(resource as usize as *const u16)) } {
        Ok(cursor) => Ok(cursor),
        Err(error) => {
            #[cfg(debug_assertions)]
            {
                let _ = error;
                unsafe { LoadCursorW(None, IDC_HAND) }
                    .with_context(|| format!("failed to load fallback for {name} cursor"))
            }
            #[cfg(not(debug_assertions))]
            {
                Err(error).with_context(|| format!("failed to load bundled {name} cursor"))
            }
        }
    }
}
