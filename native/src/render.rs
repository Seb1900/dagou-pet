use crate::input::DogKeyRole;
use anyhow::{Context, Result, bail};
use png::{ColorType, Transformations};
use std::collections::HashMap;
use std::ffi::c_void;
use std::io::Cursor;
use std::mem::size_of;
use std::time::{Duration, Instant};
use windows::Win32::Foundation::{COLORREF, HWND, POINT, RECT, SIZE};
use windows::Win32::Graphics::Direct2D::Common::{
    D2D_RECT_F, D2D_SIZE_U, D2D1_ALPHA_MODE_PREMULTIPLIED, D2D1_COLOR_F, D2D1_PIXEL_FORMAT,
};
use windows::Win32::Graphics::Direct2D::{
    D2D1_ANTIALIAS_MODE_ALIASED, D2D1_BITMAP_INTERPOLATION_MODE_LINEAR, D2D1_BITMAP_PROPERTIES,
    D2D1_FACTORY_TYPE_SINGLE_THREADED, D2D1_FEATURE_LEVEL_DEFAULT,
    D2D1_OPACITY_MASK_CONTENT_GRAPHICS, D2D1_RENDER_TARGET_PROPERTIES,
    D2D1_RENDER_TARGET_TYPE_DEFAULT, D2D1_RENDER_TARGET_USAGE_GDI_COMPATIBLE, D2D1CreateFactory,
    ID2D1Bitmap, ID2D1DCRenderTarget, ID2D1Factory, ID2D1RenderTarget,
};
use windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_B8G8R8A8_UNORM;
use windows::Win32::Graphics::Gdi::{
    AC_SRC_ALPHA, AC_SRC_OVER, BI_RGB, BITMAPINFO, BITMAPINFOHEADER, BLENDFUNCTION,
    CreateCompatibleDC, CreateDIBSection, DIB_RGB_COLORS, DeleteDC, DeleteObject, HBITMAP, HDC,
    HGDIOBJ, SelectObject,
};
use windows::Win32::UI::WindowsAndMessaging::{ULW_ALPHA, UpdateLayeredWindow};
use windows_numerics::Matrix3x2;

const SPRITE_IDLE: &[u8] = include_bytes!("../../assets/dagou/sprites/idle.png");
const SPRITE_SHY: &[u8] = include_bytes!("../../assets/dagou/sprites/idle-shy.png");
const SPRITE_SHY_TAIL: &[u8] = include_bytes!("../../assets/dagou/sprites/idle-shy-tail.png");
const SPRITE_BARK01: &[u8] = include_bytes!("../../assets/dagou/sprites/bark01.png");
const SPRITE_BARK02: &[u8] = include_bytes!("../../assets/dagou/sprites/bark02.png");
const SPRITE_SCALE: &[u8] = include_bytes!("../../assets/dagou/sprites/idle-scale.png");

const STATE_FADE: Duration = Duration::from_millis(120);
const SHY_DELAY: Duration = Duration::from_secs(3);
const TAIL_WAG_DURATION: Duration = Duration::from_millis(1_050);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum VisualState {
    Idle,
    Shy,
    Bark01,
    Bark02,
    Scale,
}

#[derive(Debug, Clone, Copy)]
pub struct AnimationFrame {
    pub previous_state: VisualState,
    pub target_state: VisualState,
    pub transition: f32,
    pub lift: f32,
    pub rotation_degrees: f32,
    pub body_scale_x: f32,
    pub body_scale_y: f32,
    pub shake_x: f32,
    pub shake_y: f32,
    pub jelly_scale: f32,
    pub tail_angle_degrees: f32,
    pub tint_opacity: f32,
    pub flip_horizontal: bool,
    pub flip_vertical: bool,
}

pub struct PetAnimator {
    active: HashMap<u32, DogKeyRole>,
    current_state: VisualState,
    target_state: VisualState,
    transition_started: Instant,
    animation_origin: Instant,
    last_tick: Instant,
    last_interaction: Instant,
    normal_mouth_until: Instant,
    jiao_mouth_until: Instant,
    hold_started: Option<Instant>,
    tail_wag_started: Option<Instant>,
    scale_hover: bool,
    displacement: f32,
    velocity: f32,
    heat: f32,
    hold_level: f32,
    tint_opacity: f32,
    reaction_intensity: f32,
    flip_horizontal: bool,
    flip_vertical: bool,
}

impl PetAnimator {
    pub fn new(settings: &crate::settings::AppSettings) -> Self {
        let now = Instant::now();
        Self {
            active: HashMap::new(),
            current_state: VisualState::Idle,
            target_state: VisualState::Idle,
            transition_started: now,
            animation_origin: now,
            last_tick: now,
            last_interaction: now,
            normal_mouth_until: now,
            jiao_mouth_until: now,
            hold_started: None,
            tail_wag_started: None,
            scale_hover: false,
            displacement: 0.0,
            velocity: 0.0,
            heat: 0.0,
            hold_level: 0.0,
            tint_opacity: 0.0,
            reaction_intensity: settings.reaction_intensity,
            flip_horizontal: settings.flip_horizontal,
            flip_vertical: settings.flip_vertical,
        }
    }

    pub fn apply_settings(&mut self, settings: &crate::settings::AppSettings) {
        self.reaction_intensity = settings.reaction_intensity;
        self.flip_horizontal = settings.flip_horizontal;
        self.flip_vertical = settings.flip_vertical;
    }

    pub fn key_down(&mut self, press_id: u32, role: DogKeyRole) {
        if self.active.contains_key(&press_id) {
            return;
        }
        let now = Instant::now();
        if self.active.is_empty() {
            self.hold_started = Some(now);
        }
        self.active.insert(press_id, role);
        self.last_interaction = now;
        let is_jiao = role == DogKeyRole::Jiao;
        let impulse = if is_jiao { 1.45 } else { 0.72 } * self.reaction_intensity;
        self.velocity = (self.velocity + impulse * 4.8).min(11.5);
        self.heat =
            (self.heat + if is_jiao { 0.24 } else { 0.13 } * self.reaction_intensity).min(1.35);
        if is_jiao {
            self.jiao_mouth_until = now + Duration::from_millis(390);
        } else {
            self.normal_mouth_until = now + Duration::from_millis(140);
        }
    }

    pub fn key_up(&mut self, press_id: u32, role: DogKeyRole) {
        let now = Instant::now();
        self.active.remove(&press_id);
        self.last_interaction = now;
        if self.active.is_empty() {
            self.hold_started = None;
        }
        if role == DogKeyRole::Jiao {
            self.jiao_mouth_until = self.jiao_mouth_until.max(now + Duration::from_millis(240));
        } else {
            self.normal_mouth_until = self
                .normal_mouth_until
                .max(now + Duration::from_millis(100));
        }
    }

    pub fn set_scale_hover(&mut self, enabled: bool) {
        self.scale_hover = enabled;
        if enabled {
            self.last_interaction = Instant::now();
        }
    }

    pub fn hover_dog(&mut self) {
        self.last_interaction = Instant::now() - SHY_DELAY;
    }

    pub fn pet(&mut self) {
        let now = Instant::now();
        self.last_interaction = now - SHY_DELAY;
        self.velocity = (self.velocity + 0.82 * self.reaction_intensity * 4.8).min(11.5);
        self.heat = (self.heat + 0.16 * self.reaction_intensity).min(1.35);
        self.tail_wag_started = Some(now);
    }

    pub fn reset(&mut self) {
        let now = Instant::now();
        self.active.clear();
        self.current_state = VisualState::Idle;
        self.target_state = VisualState::Idle;
        self.transition_started = now;
        self.last_tick = now;
        self.last_interaction = now;
        self.normal_mouth_until = now;
        self.jiao_mouth_until = now;
        self.hold_started = None;
        self.tail_wag_started = None;
        self.displacement = 0.0;
        self.velocity = 0.0;
        self.heat = 0.0;
        self.hold_level = 0.0;
        self.tint_opacity = 0.0;
    }

    pub fn tick(&mut self) -> AnimationFrame {
        let now = Instant::now();
        let dt = now
            .duration_since(self.last_tick)
            .as_secs_f32()
            .clamp(0.001, 0.05);
        self.last_tick = now;

        self.velocity += -42.0 * self.displacement * dt;
        self.velocity *= (-9.5 * dt).exp();
        self.velocity = self.velocity.clamp(-11.5, 11.5);
        self.displacement = (self.displacement + self.velocity * dt).clamp(-1.8, 1.8);
        self.heat *= (-2.35 * dt).exp();

        let long_hold = self.hold_started.is_some_and(|started| {
            !self.active.is_empty() && now.duration_since(started) > Duration::from_millis(220)
        });
        let hold_target = if long_hold { 1.0 } else { 0.0 };
        let hold_speed = if long_hold { 2.1 } else { 7.5 };
        self.hold_level += (hold_target - self.hold_level) * (hold_speed * dt).min(1.0);

        let requested = self.requested_state(now);
        if requested != self.target_state {
            if transition_progress(now, self.transition_started) >= 0.5 {
                self.current_state = self.target_state;
            }
            self.target_state = requested;
            self.transition_started = now;
        }
        let transition = transition_progress(now, self.transition_started);
        if transition >= 1.0 {
            self.current_state = self.target_state;
        }

        let tint_target = if self.active.values().any(|role| *role == DogKeyRole::Jiao)
            || now < self.jiao_mouth_until
        {
            0.14
        } else {
            0.0
        };
        let tint_duration = if tint_target > self.tint_opacity {
            0.32
        } else {
            0.9
        };
        self.tint_opacity += (tint_target - self.tint_opacity) * (dt / tint_duration).min(1.0);
        if (self.tint_opacity - tint_target).abs() < 0.0005 {
            self.tint_opacity = tint_target;
        }

        let positive = self.displacement.max(0.0);
        let time_ms = now.duration_since(self.animation_origin).as_secs_f32() * 1_000.0;
        let shake = self.hold_level * 6.5 * self.reaction_intensity;
        AnimationFrame {
            previous_state: self.current_state,
            target_state: self.target_state,
            transition,
            lift: positive * 34.0 + self.heat * 7.0,
            rotation_degrees: -positive * 5.8 + (time_ms * 0.025).sin() * self.heat * 3.2,
            body_scale_x: 1.0 + positive * 0.16 + self.heat * 0.05,
            body_scale_y: 1.0 - positive * 0.085 + self.heat * 0.03,
            shake_x: (time_ms * 0.145).sin() * shake,
            shake_y: (time_ms * 0.19).cos() * shake * 0.55,
            jelly_scale: 1.0 + self.hold_level * 0.2 * self.reaction_intensity,
            tail_angle_degrees: tail_angle(now, self.tail_wag_started),
            tint_opacity: if self.scale_hover {
                0.0
            } else {
                self.tint_opacity
            },
            flip_horizontal: self.flip_horizontal,
            flip_vertical: self.flip_vertical,
        }
    }

    fn requested_state(&self, now: Instant) -> VisualState {
        if self.scale_hover {
            return VisualState::Scale;
        }
        if self.active.values().any(|role| *role == DogKeyRole::Jiao) || now < self.jiao_mouth_until
        {
            return VisualState::Bark02;
        }
        if !self.active.is_empty() || now < self.normal_mouth_until {
            return VisualState::Bark01;
        }
        if now.duration_since(self.last_interaction) >= SHY_DELAY {
            VisualState::Shy
        } else {
            VisualState::Idle
        }
    }
}

fn transition_progress(now: Instant, started: Instant) -> f32 {
    let value = (now.duration_since(started).as_secs_f32() / STATE_FADE.as_secs_f32()).min(1.0);
    value * value * (3.0 - 2.0 * value)
}

fn state_opacities(frame: &AnimationFrame) -> (f32, f32) {
    if frame.previous_state == frame.target_state || frame.transition >= 1.0 {
        (0.0, 1.0)
    } else {
        (1.0, frame.transition.clamp(0.0, 1.0))
    }
}

fn tail_angle(now: Instant, started: Option<Instant>) -> f32 {
    let Some(started) = started else {
        return 0.0;
    };
    let elapsed = now.duration_since(started);
    if elapsed >= TAIL_WAG_DURATION {
        return 0.0;
    }
    let progress = elapsed.as_secs_f32() / TAIL_WAG_DURATION.as_secs_f32();
    (progress * std::f32::consts::TAU * 4.1).sin() * 24.0 * (1.0 - progress).powf(0.72)
}

struct DecodedSprite {
    width: u32,
    height: u32,
    pixels: Vec<u8>,
}

struct SpriteBitmaps {
    idle: ID2D1Bitmap,
    shy: ID2D1Bitmap,
    shy_tail: ID2D1Bitmap,
    bark01: ID2D1Bitmap,
    bark02: ID2D1Bitmap,
    scale: ID2D1Bitmap,
}

impl SpriteBitmaps {
    fn state(&self, state: VisualState) -> &ID2D1Bitmap {
        match state {
            VisualState::Idle => &self.idle,
            VisualState::Shy => &self.shy,
            VisualState::Bark01 => &self.bark01,
            VisualState::Bark02 => &self.bark02,
            VisualState::Scale => &self.scale,
        }
    }
}

pub struct LayeredRenderer {
    target: ID2D1DCRenderTarget,
    bitmaps: SpriteBitmaps,
    memory_dc: HDC,
    dib: HBITMAP,
    previous_bitmap: HGDIOBJ,
    width: i32,
    height: i32,
}

impl LayeredRenderer {
    pub fn new(width: i32, height: i32) -> Result<Self> {
        unsafe {
            let factory: ID2D1Factory = D2D1CreateFactory(D2D1_FACTORY_TYPE_SINGLE_THREADED, None)?;
            let properties = D2D1_RENDER_TARGET_PROPERTIES {
                r#type: D2D1_RENDER_TARGET_TYPE_DEFAULT,
                pixelFormat: D2D1_PIXEL_FORMAT {
                    format: DXGI_FORMAT_B8G8R8A8_UNORM,
                    alphaMode: D2D1_ALPHA_MODE_PREMULTIPLIED,
                },
                dpiX: 96.0,
                dpiY: 96.0,
                usage: D2D1_RENDER_TARGET_USAGE_GDI_COMPATIBLE,
                minLevel: D2D1_FEATURE_LEVEL_DEFAULT,
            };
            let target = factory.CreateDCRenderTarget(&properties)?;
            let memory_dc = CreateCompatibleDC(None);
            if memory_dc.is_invalid() {
                bail!("CreateCompatibleDC failed");
            }
            let (dib, previous_bitmap) = create_dib(memory_dc, width, height)?;
            target.BindDC(
                memory_dc,
                &RECT {
                    left: 0,
                    top: 0,
                    right: width,
                    bottom: height,
                },
            )?;
            let bitmaps = SpriteBitmaps {
                idle: create_bitmap(&target, decode_png(SPRITE_IDLE)?)?,
                shy: create_bitmap(&target, decode_png(SPRITE_SHY)?)?,
                shy_tail: create_bitmap(&target, decode_png(SPRITE_SHY_TAIL)?)?,
                bark01: create_bitmap(&target, decode_png(SPRITE_BARK01)?)?,
                bark02: create_bitmap(&target, decode_png(SPRITE_BARK02)?)?,
                scale: create_bitmap(&target, decode_png(SPRITE_SCALE)?)?,
            };
            Ok(Self {
                target,
                bitmaps,
                memory_dc,
                dib,
                previous_bitmap,
                width,
                height,
            })
        }
    }

    pub fn resize(&mut self, width: i32, height: i32) -> Result<()> {
        if self.width == width && self.height == height {
            return Ok(());
        }
        unsafe {
            SelectObject(self.memory_dc, self.previous_bitmap);
            let _ = DeleteObject(HGDIOBJ(self.dib.0));
            let (dib, previous_bitmap) = create_dib(self.memory_dc, width, height)?;
            self.dib = dib;
            self.previous_bitmap = previous_bitmap;
            self.width = width;
            self.height = height;
            self.target.BindDC(
                self.memory_dc,
                &RECT {
                    left: 0,
                    top: 0,
                    right: width,
                    bottom: height,
                },
            )?;
        }
        Ok(())
    }

    pub fn render(&self, hwnd: HWND, frame: &AnimationFrame, position: POINT) -> Result<()> {
        unsafe {
            self.target.BeginDraw();
            self.target.Clear(Some(&D2D1_COLOR_F {
                r: 0.0,
                g: 0.0,
                b: 0.0,
                a: 0.0,
            }));
            let content = content_rectangle(self.width, self.height);
            self.target.SetTransform(&body_transform(
                frame,
                self.width as f32,
                self.height as f32,
            ));

            let (previous_opacity, target_opacity) = state_opacities(frame);
            if previous_opacity > 0.0 {
                self.draw_state(
                    frame.previous_state,
                    previous_opacity,
                    content,
                    frame.tail_angle_degrees,
                );
            }
            if target_opacity > 0.0 {
                self.draw_state(
                    frame.target_state,
                    target_opacity,
                    content,
                    frame.tail_angle_degrees,
                );
            }
            if frame.tint_opacity > 0.001 {
                let brush = self.target.CreateSolidColorBrush(
                    &D2D1_COLOR_F {
                        r: 0.937,
                        g: 0.063,
                        b: 0.094,
                        a: 1.0,
                    },
                    None,
                )?;
                brush.SetOpacity(frame.tint_opacity);
                self.target.SetAntialiasMode(D2D1_ANTIALIAS_MODE_ALIASED);
                self.target.FillOpacityMask(
                    self.bitmaps.state(frame.target_state),
                    &brush,
                    D2D1_OPACITY_MASK_CONTENT_GRAPHICS,
                    Some(&content),
                    None,
                );
            }
            self.target.EndDraw(None, None)?;

            let source = POINT { x: 0, y: 0 };
            let size = SIZE {
                cx: self.width,
                cy: self.height,
            };
            let blend = BLENDFUNCTION {
                BlendOp: AC_SRC_OVER as u8,
                BlendFlags: 0,
                SourceConstantAlpha: 255,
                AlphaFormat: AC_SRC_ALPHA as u8,
            };
            UpdateLayeredWindow(
                hwnd,
                None,
                Some(&position),
                Some(&size),
                Some(self.memory_dc),
                Some(&source),
                COLORREF(0),
                Some(&blend),
                ULW_ALPHA,
            )?;
        }
        Ok(())
    }

    unsafe fn draw_state(
        &self,
        state: VisualState,
        opacity: f32,
        rectangle: D2D_RECT_F,
        tail_angle: f32,
    ) {
        unsafe {
            if opacity <= 0.001 {
                return;
            }
            if state == VisualState::Shy {
                let original = current_transform(&self.target);
                let pivot_x = rectangle.left + (rectangle.right - rectangle.left) * 0.61523;
                let pivot_y = rectangle.top + (rectangle.bottom - rectangle.top) * 0.26758;
                self.target.SetTransform(&multiply(
                    original,
                    rotation_about(tail_angle, pivot_x, pivot_y),
                ));
                self.target.DrawBitmap(
                    &self.bitmaps.shy_tail,
                    Some(&rectangle),
                    opacity,
                    D2D1_BITMAP_INTERPOLATION_MODE_LINEAR,
                    None,
                );
                self.target.SetTransform(&original);
            }
            self.target.DrawBitmap(
                self.bitmaps.state(state),
                Some(&rectangle),
                opacity,
                D2D1_BITMAP_INTERPOLATION_MODE_LINEAR,
                None,
            );
        }
    }
}

impl Drop for LayeredRenderer {
    fn drop(&mut self) {
        unsafe {
            SelectObject(self.memory_dc, self.previous_bitmap);
            let _ = DeleteObject(HGDIOBJ(self.dib.0));
            let _ = DeleteDC(self.memory_dc);
        }
    }
}

unsafe fn create_dib(memory_dc: HDC, width: i32, height: i32) -> Result<(HBITMAP, HGDIOBJ)> {
    let info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            biHeight: -height,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };
    let mut bits: *mut c_void = std::ptr::null_mut();
    let bitmap =
        unsafe { CreateDIBSection(Some(memory_dc), &info, DIB_RGB_COLORS, &mut bits, None, 0)? };
    if bits.is_null() {
        bail!("CreateDIBSection returned no pixel buffer");
    }
    let previous = unsafe { SelectObject(memory_dc, HGDIOBJ(bitmap.0)) };
    Ok((bitmap, previous))
}

fn create_bitmap(target: &ID2D1DCRenderTarget, sprite: DecodedSprite) -> Result<ID2D1Bitmap> {
    let properties = D2D1_BITMAP_PROPERTIES {
        pixelFormat: D2D1_PIXEL_FORMAT {
            format: DXGI_FORMAT_B8G8R8A8_UNORM,
            alphaMode: D2D1_ALPHA_MODE_PREMULTIPLIED,
        },
        dpiX: 96.0,
        dpiY: 96.0,
    };
    let render_target: &ID2D1RenderTarget = target;
    unsafe {
        Ok(render_target.CreateBitmap(
            D2D_SIZE_U {
                width: sprite.width,
                height: sprite.height,
            },
            Some(sprite.pixels.as_ptr().cast()),
            sprite.width * 4,
            &properties,
        )?)
    }
}

fn decode_png(bytes: &[u8]) -> Result<DecodedSprite> {
    let mut decoder = png::Decoder::new(Cursor::new(bytes));
    decoder.set_transformations(Transformations::EXPAND | Transformations::STRIP_16);
    let mut reader = decoder.read_info().context("failed to read PNG header")?;
    let mut buffer = vec![0; reader.output_buffer_size()];
    let output = reader
        .next_frame(&mut buffer)
        .context("failed to decode PNG")?;
    let source = &buffer[..output.buffer_size()];
    let pixel_count = output.width as usize * output.height as usize;
    let mut pixels = Vec::with_capacity(pixel_count * 4);
    for index in 0..pixel_count {
        let (red, green, blue, alpha) = match output.color_type {
            ColorType::Rgba => {
                let offset = index * 4;
                (
                    source[offset],
                    source[offset + 1],
                    source[offset + 2],
                    source[offset + 3],
                )
            }
            ColorType::Rgb => {
                let offset = index * 3;
                (source[offset], source[offset + 1], source[offset + 2], 255)
            }
            ColorType::GrayscaleAlpha => {
                let offset = index * 2;
                (
                    source[offset],
                    source[offset],
                    source[offset],
                    source[offset + 1],
                )
            }
            ColorType::Grayscale => {
                let gray = source[index];
                (gray, gray, gray, 255)
            }
            ColorType::Indexed => bail!("indexed PNG was not expanded"),
        };
        let alpha_scale = alpha as u16;
        pixels.extend_from_slice(&[
            ((blue as u16 * alpha_scale + 127) / 255) as u8,
            ((green as u16 * alpha_scale + 127) / 255) as u8,
            ((red as u16 * alpha_scale + 127) / 255) as u8,
            alpha,
        ]);
    }
    Ok(DecodedSprite {
        width: output.width,
        height: output.height,
        pixels,
    })
}

fn content_rectangle(width: i32, height: i32) -> D2D_RECT_F {
    let margin_x = width as f32 * 0.045;
    let margin_y = height as f32 * 0.045;
    D2D_RECT_F {
        left: margin_x,
        top: margin_y,
        right: width as f32 - margin_x,
        bottom: height as f32 - margin_y,
    }
}

fn body_transform(frame: &AnimationFrame, width: f32, height: f32) -> Matrix3x2 {
    let center_x = width * 0.5;
    let center_y = height * 0.72;
    let mirror_x = if frame.flip_horizontal { -1.0 } else { 1.0 };
    let mirror_y = if frame.flip_vertical { -1.0 } else { 1.0 };
    let mut matrix = scale_about(mirror_x, mirror_y, center_x, center_y);
    matrix = multiply(
        matrix,
        scale_about(
            frame.body_scale_x * frame.jelly_scale,
            frame.body_scale_y * frame.jelly_scale,
            center_x,
            center_y,
        ),
    );
    matrix = multiply(
        matrix,
        rotation_about(frame.rotation_degrees, center_x, center_y),
    );
    multiply(
        matrix,
        translation(frame.shake_x, frame.shake_y - frame.lift),
    )
}

fn current_transform(target: &ID2D1DCRenderTarget) -> Matrix3x2 {
    let mut matrix = identity();
    unsafe { target.GetTransform(&mut matrix) };
    matrix
}

fn identity() -> Matrix3x2 {
    Matrix3x2 {
        M11: 1.0,
        M12: 0.0,
        M21: 0.0,
        M22: 1.0,
        M31: 0.0,
        M32: 0.0,
    }
}

fn translation(x: f32, y: f32) -> Matrix3x2 {
    Matrix3x2 {
        M31: x,
        M32: y,
        ..identity()
    }
}

fn scale_about(x: f32, y: f32, center_x: f32, center_y: f32) -> Matrix3x2 {
    multiply(
        multiply(
            translation(-center_x, -center_y),
            Matrix3x2 {
                M11: x,
                M22: y,
                ..identity()
            },
        ),
        translation(center_x, center_y),
    )
}

fn rotation_about(degrees: f32, center_x: f32, center_y: f32) -> Matrix3x2 {
    let (sine, cosine) = degrees.to_radians().sin_cos();
    multiply(
        multiply(
            translation(-center_x, -center_y),
            Matrix3x2 {
                M11: cosine,
                M12: sine,
                M21: -sine,
                M22: cosine,
                M31: 0.0,
                M32: 0.0,
            },
        ),
        translation(center_x, center_y),
    )
}

fn multiply(left: Matrix3x2, right: Matrix3x2) -> Matrix3x2 {
    Matrix3x2 {
        M11: left.M11 * right.M11 + left.M12 * right.M21,
        M12: left.M11 * right.M12 + left.M12 * right.M22,
        M21: left.M21 * right.M11 + left.M22 * right.M21,
        M22: left.M21 * right.M12 + left.M22 * right.M22,
        M31: left.M31 * right.M11 + left.M32 * right.M21 + right.M31,
        M32: left.M31 * right.M12 + left.M32 * right.M22 + right.M32,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_sprites_share_one_canvas() {
        for sprite in [
            SPRITE_IDLE,
            SPRITE_SHY,
            SPRITE_SHY_TAIL,
            SPRITE_BARK01,
            SPRITE_BARK02,
            SPRITE_SCALE,
        ] {
            let decoded = decode_png(sprite).unwrap();
            assert_eq!((decoded.width, decoded.height), (1024, 1024));
            assert_eq!(decoded.pixels.len(), 1024 * 1024 * 4);
        }
    }

    #[test]
    fn scale_about_keeps_pivot_fixed() {
        let matrix = scale_about(-1.0, 1.0, 10.0, 20.0);
        let x = 10.0 * matrix.M11 + 20.0 * matrix.M21 + matrix.M31;
        let y = 10.0 * matrix.M12 + 20.0 * matrix.M22 + matrix.M32;
        assert!((x - 10.0).abs() < 0.001);
        assert!((y - 20.0).abs() < 0.001);
    }

    #[test]
    fn state_transition_keeps_previous_sprite_opaque() {
        let frame = AnimationFrame {
            previous_state: VisualState::Idle,
            target_state: VisualState::Shy,
            transition: 0.5,
            lift: 0.0,
            rotation_degrees: 0.0,
            body_scale_x: 1.0,
            body_scale_y: 1.0,
            shake_x: 0.0,
            shake_y: 0.0,
            jelly_scale: 1.0,
            tail_angle_degrees: 0.0,
            tint_opacity: 0.0,
            flip_horizontal: false,
            flip_vertical: false,
        };

        assert_eq!(state_opacities(&frame), (1.0, 0.5));
    }
}
