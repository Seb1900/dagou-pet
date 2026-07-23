use std::fs;
use std::path::PathBuf;
use std::process::Command;

fn main() {
    println!("cargo:rerun-if-env-changed=PATH");
    println!("cargo:rerun-if-env-changed=CARGO_PKG_VERSION");
    println!("cargo:rerun-if-changed=assets/branding/app-icon.ico");

    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }
    if Command::new("windres").arg("--version").output().is_err() {
        println!(
            "cargo:warning=windres is unavailable; executable resources are skipped for this development build"
        );
        return;
    }

    let output = PathBuf::from(std::env::var_os("OUT_DIR").expect("OUT_DIR is missing"));
    let version = std::env::var("CARGO_PKG_VERSION").expect("CARGO_PKG_VERSION is missing");
    let numeric_version = version
        .split(['-', '+'])
        .next()
        .expect("package version is empty");
    let mut version_parts = numeric_version.split('.');
    let major = version_parts
        .next()
        .expect("package version is missing its major component");
    let minor = version_parts
        .next()
        .expect("package version is missing its minor component");
    let patch = version_parts
        .next()
        .expect("package version is missing its patch component");
    for part in [major, minor, patch] {
        part.parse::<u16>()
            .expect("Windows version components must be unsigned integers");
    }
    fs::copy("assets/branding/app-icon.ico", output.join("app-icon.ico"))
        .expect("failed to stage app icon");
    fs::write(
        output.join("app.manifest"),
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <assemblyIdentity version="1.0.0.0" processorArchitecture="amd64" name="Seb1900.DagouPet" type="win32"/>
  <description>大狗桌宠</description>
  <dependency>
    <dependentAssembly>
      <assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls" version="6.0.0.0" processorArchitecture="*" publicKeyToken="6595b64144ccf1df" language="*"/>
    </dependentAssembly>
  </dependency>
  <application xmlns="urn:schemas-microsoft-com:asm.v3">
    <windowsSettings>
      <dpiAware xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">true/pm</dpiAware>
      <dpiAwareness xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">PerMonitorV2</dpiAwareness>
      <longPathAware xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">true</longPathAware>
    </windowsSettings>
  </application>
</assembly>
"#,
    )
    .expect("failed to write application manifest");
    fs::write(
        output.join("resource.rc"),
        format!(
            r#"
1 ICON "app-icon.ico"
2 24 "app.manifest"

1 VERSIONINFO
 FILEVERSION {major},{minor},{patch},0
 PRODUCTVERSION {major},{minor},{patch},0
 FILEFLAGSMASK 0x3fL
 FILEOS 0x40004L
 FILETYPE 0x1L
BEGIN
  BLOCK "StringFileInfo"
  BEGIN
    BLOCK "080404B0"
    BEGIN
      VALUE "CompanyName", "Seb1900\0"
      VALUE "FileDescription", "大狗桌宠\0"
      VALUE "FileVersion", "{version}\0"
      VALUE "InternalName", "dagou-pet\0"
      VALUE "LegalCopyright", "Copyright (c) 2026 Seb1900\0"
      VALUE "OriginalFilename", "dagou-pet.exe\0"
      VALUE "ProductName", "大狗桌宠\0"
      VALUE "ProductVersion", "{version}\0"
    END
  END
  BLOCK "VarFileInfo"
  BEGIN
    VALUE "Translation", 0x0804, 1200
  END
END
"#
        ),
    )
    .expect("failed to write resource script");

    let windres = Command::new("windres")
        .current_dir(&output)
        .args([
            "--codepage=65001",
            "--target",
            "pe-x86-64",
            "resource.rc",
            "resource.o",
        ])
        .status()
        .expect("failed to launch windres");
    assert!(windres.success(), "windres failed");

    let archive = Command::new("ar")
        .current_dir(&output)
        .args(["rsc", "libresource.a", "resource.o"])
        .status()
        .expect("failed to launch ar");
    assert!(archive.success(), "resource archive failed");

    println!("cargo:rustc-link-search=native={}", output.display());
    println!("cargo:rustc-link-lib=static:+whole-archive=resource");
}
