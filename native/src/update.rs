use anyhow::{Context, Result, bail};
use semver::Version;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::ffi::c_void;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::mem::size_of;
use std::path::{Path, PathBuf};
use std::ptr::null;
use windows::Win32::Networking::WinHttp::{
    URL_COMPONENTS, WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY, WINHTTP_FLAG_SECURE,
    WINHTTP_INTERNET_SCHEME_HTTPS, WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_QUERY_STATUS_CODE,
    WinHttpCloseHandle, WinHttpConnect, WinHttpCrackUrl, WinHttpOpen, WinHttpOpenRequest,
    WinHttpQueryDataAvailable, WinHttpQueryHeaders, WinHttpReadData, WinHttpReceiveResponse,
    WinHttpSendRequest,
};
use windows::core::{PCWSTR, w};

pub const RELEASES_URL: &str = "https://github.com/Seb1900/dagou-pet/releases/latest";
const LATEST_RELEASE_API: &str = "https://api.github.com/repos/Seb1900/dagou-pet/releases/latest";
const MAX_RELEASE_JSON_BYTES: usize = 1024 * 1024;
const MAX_CHECKSUM_BYTES: usize = 1024 * 1024;
const MAX_INSTALLER_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Debug)]
pub enum UpdateResult {
    UpToDate,
    Ready {
        version: Version,
        installer_path: PathBuf,
    },
    Error(String),
}

#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    #[allow(dead_code)]
    html_url: String,
    assets: Vec<GitHubAsset>,
}

#[derive(Debug, Clone, Deserialize)]
struct GitHubAsset {
    name: String,
    browser_download_url: String,
    size: u64,
}

pub fn is_installed_build() -> bool {
    std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.join("Uninstall.exe")))
        .is_some_and(|uninstaller| uninstaller.is_file())
}

pub fn check_and_download() -> UpdateResult {
    match check_and_download_inner() {
        Ok(result) => result,
        Err(error) => UpdateResult::Error(user_error(&error)),
    }
}

pub fn start_installer(path: &Path) -> Result<()> {
    std::process::Command::new(path)
        .args(["/S", "/UPDATE"])
        .spawn()
        .with_context(|| format!("无法启动更新安装包 {}", path.display()))?;
    Ok(())
}

fn check_and_download_inner() -> Result<UpdateResult> {
    let current = Version::parse(env!("CARGO_PKG_VERSION"))?;
    let client = WinHttpClient::new()?;
    let release_bytes = client.get_bytes(LATEST_RELEASE_API, MAX_RELEASE_JSON_BYTES)?;
    let release: GitHubRelease =
        serde_json::from_slice(&release_bytes).context("GitHub 更新信息格式无效")?;
    let latest = parse_tag_version(&release.tag_name)?;
    if latest <= current {
        return Ok(UpdateResult::UpToDate);
    }

    let installer =
        find_installer(&release.assets, &latest).context("新版本缺少 Windows x64 安装包")?;
    if installer.size == 0 || installer.size > MAX_INSTALLER_BYTES {
        bail!("更新安装包大小异常");
    }
    let checksum_asset = release
        .assets
        .iter()
        .find(|asset| asset.name.eq_ignore_ascii_case("SHA256SUMS.txt"))
        .context("新版本缺少 SHA256SUMS.txt")?;
    let checksum_bytes =
        client.get_bytes(&checksum_asset.browser_download_url, MAX_CHECKSUM_BYTES)?;
    let checksums = String::from_utf8(checksum_bytes).context("校验文件不是 UTF-8 文本")?;
    let expected = checksum_for(&checksums, &installer.name).context("校验文件中没有安装包记录")?;

    let update_directory = update_directory(&latest);
    fs::create_dir_all(&update_directory).context("无法创建更新缓存目录")?;
    let installer_path = update_directory.join(&installer.name);
    if installer_path.is_file()
        && file_sha256(&installer_path)
            .map(|hash| hash.eq_ignore_ascii_case(expected))
            .unwrap_or(false)
    {
        return Ok(UpdateResult::Ready {
            version: latest,
            installer_path,
        });
    }

    let partial_path = installer_path.with_extension("exe.part");
    let (downloaded, actual_hash) =
        client.download_file(&installer.browser_download_url, &partial_path)?;
    if downloaded != installer.size {
        let _ = fs::remove_file(&partial_path);
        bail!(
            "更新包下载不完整：期望 {} 字节，实际 {} 字节",
            installer.size,
            downloaded
        );
    }
    if !actual_hash.eq_ignore_ascii_case(expected) {
        let _ = fs::remove_file(&partial_path);
        bail!("更新包 SHA-256 校验失败");
    }
    if installer_path.exists() {
        fs::remove_file(&installer_path).context("无法替换旧更新缓存")?;
    }
    fs::rename(&partial_path, &installer_path).context("无法提交已下载的更新包")?;
    Ok(UpdateResult::Ready {
        version: latest,
        installer_path,
    })
}

fn parse_tag_version(tag: &str) -> Result<Version> {
    Version::parse(tag.trim().trim_start_matches(['v', 'V']))
        .with_context(|| format!("无法识别版本号 {tag}"))
}

fn find_installer<'a>(assets: &'a [GitHubAsset], version: &Version) -> Option<&'a GitHubAsset> {
    let expected = format!("Dagou-Desktop-Pet-Setup-{version}-x64.exe");
    assets
        .iter()
        .find(|asset| asset.name.eq_ignore_ascii_case(&expected))
}

fn checksum_for<'a>(contents: &'a str, filename: &str) -> Option<&'a str> {
    contents.lines().find_map(|line| {
        let mut fields = line.split_whitespace();
        let hash = fields.next()?;
        let name = fields.next()?.trim_start_matches('*');
        (hash.len() == 64 && name.eq_ignore_ascii_case(filename)).then_some(hash)
    })
}

fn update_directory(version: &Version) -> PathBuf {
    let root = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    root.join("dagou-pet")
        .join("updates")
        .join(format!("v{version}"))
}

fn file_sha256(path: &Path) -> Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn user_error(error: &anyhow::Error) -> String {
    let message = format!("{error:#}");
    if message.chars().count() > 180 {
        format!("{}...", message.chars().take(177).collect::<String>())
    } else {
        message
    }
}

struct WinHttpClient {
    session: InternetHandle,
}

impl WinHttpClient {
    fn new() -> Result<Self> {
        let handle = unsafe {
            WinHttpOpen(
                w!("DagouPet/0.4"),
                WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
                PCWSTR::null(),
                PCWSTR::null(),
                0,
            )
        };
        Ok(Self {
            session: InternetHandle::new(handle).context("无法初始化 WinHTTP")?,
        })
    }

    fn get_bytes(&self, url: &str, maximum: usize) -> Result<Vec<u8>> {
        let request = self.open_get(url)?;
        let mut output = Vec::new();
        loop {
            let available = query_available(request.raw())?;
            if available == 0 {
                break;
            }
            if output.len().saturating_add(available as usize) > maximum {
                bail!("服务器响应超过允许大小");
            }
            let start = output.len();
            output.resize(start + available as usize, 0);
            let read = read_data(request.raw(), &mut output[start..])?;
            output.truncate(start + read);
            if read == 0 {
                break;
            }
        }
        Ok(output)
    }

    fn download_file(&self, url: &str, path: &Path) -> Result<(u64, String)> {
        let request = self.open_get(url)?;
        let mut file = File::create(path).context("无法创建更新临时文件")?;
        let mut total = 0_u64;
        let mut hasher = Sha256::new();
        loop {
            let available = query_available(request.raw())?;
            if available == 0 {
                break;
            }
            let mut buffer = vec![0_u8; (available as usize).min(64 * 1024)];
            let read = read_data(request.raw(), &mut buffer)?;
            if read == 0 {
                break;
            }
            total = total.saturating_add(read as u64);
            if total > MAX_INSTALLER_BYTES {
                bail!("更新安装包超过允许大小");
            }
            file.write_all(&buffer[..read])?;
            hasher.update(&buffer[..read]);
        }
        file.sync_all()?;
        Ok((total, format!("{:x}", hasher.finalize())))
    }

    fn open_get(&self, url: &str) -> Result<HttpRequest> {
        let parsed = ParsedHttpsUrl::parse(url)?;
        let host = wide(&parsed.host);
        let path = wide(&parsed.path);
        let connection =
            unsafe { WinHttpConnect(self.session.raw(), PCWSTR(host.as_ptr()), parsed.port, 0) };
        let connection = InternetHandle::new(connection).context("无法连接更新服务器")?;
        let request = unsafe {
            WinHttpOpenRequest(
                connection.raw(),
                w!("GET"),
                PCWSTR(path.as_ptr()),
                PCWSTR::null(),
                PCWSTR::null(),
                null(),
                WINHTTP_FLAG_SECURE,
            )
        };
        let request = InternetHandle::new(request).context("无法创建更新请求")?;
        let headers = wide_without_nul(
            "Accept: application/vnd.github+json\r\n\
             X-GitHub-Api-Version: 2022-11-28\r\n\
             Cache-Control: no-cache\r\n",
        );
        unsafe {
            WinHttpSendRequest(request.raw(), Some(&headers), None, 0, 0, 0)
                .context("无法发送更新请求")?;
            WinHttpReceiveResponse(request.raw(), std::ptr::null_mut())
                .context("更新服务器没有返回响应")?;
        }
        let status = response_status(request.raw())?;
        if !(200..300).contains(&status) {
            bail!("更新服务器返回 HTTP {status}");
        }
        Ok(HttpRequest {
            request,
            _connection: connection,
        })
    }
}

struct HttpRequest {
    request: InternetHandle,
    _connection: InternetHandle,
}

impl HttpRequest {
    fn raw(&self) -> *mut c_void {
        self.request.raw()
    }
}

struct InternetHandle(*mut c_void);

impl InternetHandle {
    fn new(handle: *mut c_void) -> Option<Self> {
        (!handle.is_null()).then_some(Self(handle))
    }

    fn raw(&self) -> *mut c_void {
        self.0
    }
}

impl Drop for InternetHandle {
    fn drop(&mut self) {
        unsafe {
            let _ = WinHttpCloseHandle(self.0);
        }
    }
}

struct ParsedHttpsUrl {
    host: String,
    path: String,
    port: u16,
}

impl ParsedHttpsUrl {
    fn parse(url: &str) -> Result<Self> {
        let encoded = wide_without_nul(url);
        let mut components = URL_COMPONENTS {
            dwStructSize: size_of::<URL_COMPONENTS>() as u32,
            dwHostNameLength: u32::MAX,
            dwUrlPathLength: u32::MAX,
            dwExtraInfoLength: u32::MAX,
            ..Default::default()
        };
        unsafe {
            WinHttpCrackUrl(&encoded, 0, &mut components).context("更新地址无效")?;
        }
        if components.nScheme != WINHTTP_INTERNET_SCHEME_HTTPS {
            bail!("更新地址必须使用 HTTPS");
        }
        let host = unsafe {
            wide_pointer_to_string(components.lpszHostName.0, components.dwHostNameLength)?
        };
        let mut path = unsafe {
            wide_pointer_to_string(components.lpszUrlPath.0, components.dwUrlPathLength)?
        };
        let extra = unsafe {
            wide_pointer_to_string(components.lpszExtraInfo.0, components.dwExtraInfoLength)?
        };
        path.push_str(&extra);
        if path.is_empty() {
            path.push('/');
        }
        Ok(Self {
            host,
            path,
            port: components.nPort,
        })
    }
}

unsafe fn wide_pointer_to_string(pointer: *mut u16, length: u32) -> Result<String> {
    if pointer.is_null() || length == 0 {
        return Ok(String::new());
    }
    let slice = unsafe { std::slice::from_raw_parts(pointer, length as usize) };
    String::from_utf16(slice).context("更新地址包含无效字符")
}

fn query_available(request: *mut c_void) -> Result<u32> {
    let mut available = 0_u32;
    unsafe {
        WinHttpQueryDataAvailable(request, &mut available).context("读取更新响应失败")?;
    }
    Ok(available)
}

fn read_data(request: *mut c_void, buffer: &mut [u8]) -> Result<usize> {
    let mut read = 0_u32;
    unsafe {
        WinHttpReadData(
            request,
            buffer.as_mut_ptr().cast(),
            buffer.len() as u32,
            &mut read,
        )
        .context("读取更新数据失败")?;
    }
    Ok(read as usize)
}

fn response_status(request: *mut c_void) -> Result<u32> {
    let mut status = 0_u32;
    let mut status_size = size_of::<u32>() as u32;
    let mut index = 0_u32;
    unsafe {
        WinHttpQueryHeaders(
            request,
            WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
            PCWSTR::null(),
            Some((&mut status as *mut u32).cast()),
            &mut status_size,
            &mut index,
        )
        .context("无法读取更新服务器状态")?;
    }
    Ok(status)
}

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

fn wide_without_nul(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_release_tag() {
        assert_eq!(parse_tag_version("v0.4.1").unwrap(), Version::new(0, 4, 1));
    }

    #[test]
    fn selects_exact_installer_asset() {
        let assets = vec![
            GitHubAsset {
                name: "Dagou-Desktop-Pet-Portable-0.4.1-x64.exe".into(),
                browser_download_url: "https://example.invalid/portable".into(),
                size: 1,
            },
            GitHubAsset {
                name: "Dagou-Desktop-Pet-Setup-0.4.1-x64.exe".into(),
                browser_download_url: "https://example.invalid/setup".into(),
                size: 1,
            },
        ];
        assert_eq!(
            find_installer(&assets, &Version::new(0, 4, 1))
                .unwrap()
                .name,
            "Dagou-Desktop-Pet-Setup-0.4.1-x64.exe"
        );
    }

    #[test]
    fn reads_common_checksum_formats() {
        let hash = "a".repeat(64);
        let contents = format!("{hash}  first.exe\n{hash} *second.exe\n");
        assert_eq!(checksum_for(&contents, "SECOND.exe"), Some(hash.as_str()));
    }
}
