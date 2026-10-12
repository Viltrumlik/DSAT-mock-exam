#!/usr/bin/env python3
"""Fail when a module in the Windows bundle imports a DLL the student's laptop may not have.

    python3 check-imports.py <bundle dir>

Every .exe/.dll in the bundle (recursively) is parsed, and each DLL in its import table must be
either IN the bundle or part of Windows itself — the loader refuses to start the process
otherwise. Delay-load imports are only loaded when first called (dartjni's jvm.dll is never
called on Windows), so a missing one is listed as a warning, not a failure.
"Part of Windows" deliberately EXCLUDES the Visual C++ runtime (msvcp*, vcruntime*, concrt*,
vccorlib*, vcomp*, mfc*): the CI machine has the VC++ redistributable installed, so a
"does it start on CI" check passes while a clean laptop refuses with "VCRUNTIME140_1.dll was
not found" — which is exactly how 0.2.0 shipped (2026-10-12). The runtime must be bundled
(windows/CMakeLists.txt installs it next to the exe).

Pure Python (no pefile), so it also runs on macOS against an unpacked nupkg.
Exit 0 = every import resolves; 1 = something is missing (listed); 2 = usage / unreadable PE.
"""
from __future__ import annotations

import struct
import sys
from pathlib import Path

# DLLs that ship with every supported Windows (10 1809+ / 11, x64). API sets (api-ms-win-*,
# ext-ms-*) are resolved by the loader. Anything else must be in the bundle.
WINDOWS_DLLS = {
    "kernel32.dll", "kernelbase.dll", "ntdll.dll", "user32.dll", "gdi32.dll", "gdiplus.dll",
    "advapi32.dll", "shell32.dll", "shlwapi.dll", "ole32.dll", "oleaut32.dll", "comctl32.dll",
    "comdlg32.dll", "uxtheme.dll", "dwmapi.dll", "dxgi.dll", "d3d11.dll", "d3d9.dll", "d3d12.dll",
    "d3dcompiler_47.dll", "dcomp.dll", "dwrite.dll", "d2d1.dll", "opengl32.dll", "winmm.dll",
    "version.dll", "ws2_32.dll", "winhttp.dll", "wininet.dll", "crypt32.dll", "bcrypt.dll",
    "ncrypt.dll", "secur32.dll", "sspicli.dll", "userenv.dll", "setupapi.dll", "cfgmgr32.dll",
    "powrprof.dll", "propsys.dll", "rpcrt4.dll", "psapi.dll", "dbghelp.dll", "iphlpapi.dll",
    "imm32.dll", "msimg32.dll", "usp10.dll", "wtsapi32.dll", "netapi32.dll", "mpr.dll",
    "urlmon.dll", "wintrust.dll", "msvcrt.dll", "ucrtbase.dll", "dnsapi.dll", "winspool.drv",
    "hid.dll", "dinput8.dll", "xinput1_4.dll", "mf.dll", "mfplat.dll", "mfreadwrite.dll",
    "windowscodecs.dll", "shcore.dll", "oleacc.dll", "credui.dll", "normaliz.dll", "mswsock.dll",
    "combase.dll", "runtimeobject.dll", "coremessaging.dll", "wevtapi.dll", "winusb.dll",
    "dbgeng.dll", "authz.dll", "netutils.dll", "srvcli.dll", "wkscli.dll", "samcli.dll",
    "rstrtmgr.dll", "msi.dll", "taskschd.dll", "comsvcs.dll", "pdh.dll", "winsta.dll",
    "dhcpcsvc.dll", "wlanapi.dll", "fwpuclnt.dll", "mscms.dll", "icm32.dll", "avrt.dll",
    "mmdevapi.dll", "ksuser.dll", "dsound.dll", "winsqlite3.dll", "bluetoothapis.dll",
    "bcryptprimitives.dll", "uiautomationcore.dll", "dbgcore.dll", "cryptbase.dll",
}
# The Visual C++ runtime: never assume it is installed.
VC_RUNTIME_PREFIXES = ("msvcp", "vcruntime", "concrt", "vccorlib", "vcomp", "mfc", "ucrtbased")


def _rva_to_offset(rva: int, sections: list[tuple[int, int, int, int]]) -> int | None:
    for vaddr, vsize, raw_ptr, raw_size in sections:
        if vaddr <= rva < vaddr + max(vsize, raw_size):
            return rva - vaddr + raw_ptr
    return None


def _cstring(data: bytes, off: int) -> str:
    end = data.index(b"\0", off)
    return data[off:end].decode("ascii", "replace")


def imports_of(path: Path) -> tuple[list[str], list[str]]:
    """(imports, delay-load imports) of a PE file: DLL names, lower-cased, de-duplicated."""
    data = path.read_bytes()
    if data[:2] != b"MZ":
        raise ValueError("not a PE file (no MZ)")
    pe = struct.unpack_from("<I", data, 0x3C)[0]
    if data[pe:pe + 4] != b"PE\0\0":
        raise ValueError("not a PE file (no PE signature)")
    n_sections = struct.unpack_from("<H", data, pe + 6)[0]
    opt_size = struct.unpack_from("<H", data, pe + 20)[0]
    opt = pe + 24
    magic = struct.unpack_from("<H", data, opt)[0]
    dd = opt + (112 if magic == 0x20B else 96)  # PE32+ vs PE32 data directories
    n_dirs = struct.unpack_from("<I", data, dd - 4)[0]
    dirs = [struct.unpack_from("<II", data, dd + 8 * i) for i in range(n_dirs)]
    sec = opt + opt_size
    sections = []
    for i in range(n_sections):
        vsize, vaddr, raw_size, raw_ptr = struct.unpack_from("<IIII", data, sec + 40 * i + 8)
        sections.append((vaddr, vsize, raw_ptr, raw_size))

    names: list[str] = []
    delayed: list[str] = []
    # Import table: 20-byte descriptors, name RVA at +12, terminated by a zero descriptor.
    if n_dirs > 1 and dirs[1][0]:
        off = _rva_to_offset(dirs[1][0], sections)
        while off is not None:
            desc = struct.unpack_from("<IIIII", data, off)
            if not any(desc):
                break
            noff = _rva_to_offset(desc[3], sections)
            if noff is not None:
                names.append(_cstring(data, noff))
            off += 20
    # Delay-load table: 32-byte descriptors, name RVA at +4.
    if n_dirs > 13 and dirs[13][0]:
        off = _rva_to_offset(dirs[13][0], sections)
        while off is not None:
            desc = struct.unpack_from("<8I", data, off)
            if not any(desc):
                break
            noff = _rva_to_offset(desc[1], sections)
            if noff is not None:
                delayed.append(_cstring(data, noff))
            off += 32
    return sorted({n.lower() for n in names}), sorted({n.lower() for n in delayed})


def is_windows(name: str) -> bool:
    if name.startswith(VC_RUNTIME_PREFIXES):
        return False
    return name in WINDOWS_DLLS or name.startswith(("api-ms-win-", "ext-ms-"))


def main(argv: list[str]) -> int:
    if len(argv) != 2 or not Path(argv[1]).is_dir():
        print(__doc__.strip().splitlines()[2].strip())
        return 2
    root = Path(argv[1])
    modules = sorted(p for p in root.rglob("*") if p.suffix.lower() in (".exe", ".dll") and p.is_file())
    bundled = {p.name.lower() for p in modules}
    missing: dict[str, list[str]] = {}
    lazy: dict[str, list[str]] = {}
    for m in modules:
        try:
            deps, delayed = imports_of(m)
        except (ValueError, struct.error, IndexError) as e:
            print(f"check-imports: cannot read {m.relative_to(root)}: {e}")
            return 2
        name = str(m.relative_to(root))
        extra = f"  [delay-load: {', '.join(delayed)}]" if delayed else ""
        print(f"  {name}: {', '.join(deps) or '(no imports)'}{extra}")
        for d in deps:
            if d not in bundled and not is_windows(d):
                missing.setdefault(d, []).append(name)
        for d in delayed:
            if d not in bundled and not is_windows(d):
                lazy.setdefault(d, []).append(name)
    for d, users in sorted(lazy.items()):
        print(f"check-imports: warning — delay-load {d} (by {', '.join(users)}) is not bundled; "
              "fine only if that code path never runs on Windows")
    if missing:
        print(f"check-imports: FAIL — {len(missing)} DLL(s) imported but neither bundled nor part of Windows:")
        for d, users in sorted(missing.items()):
            print(f"  {d}  (needed by {', '.join(users)})")
        return 1
    print(f"check-imports: OK — {len(modules)} modules, every import is bundled or part of Windows")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
