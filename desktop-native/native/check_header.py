#!/usr/bin/env python3
"""Check that mastersat_native.dll's exports match include/mastersat_native.h, the C contract.

Two independent views of the Rust crate are compared with the hand-written header:
  1. cbindgen's C rendering of every `extern "C"` function (names, return and parameter types);
  2. the symbols actually exported by the built library (macOS: `nm -gU` on the dylib;
     Windows: `dumpbin /exports` on the DLL when run from a VS developer prompt).
`cargo test` already enforces the same with tests/header_contract.rs; this adds cbindgen's and the
linker's opinion. Standard library only. Exit 0 = in sync.

usage: python3 check_header.py [--lib PATH]   (default: target/debug/libmastersat_native.dylib)
"""
import os
import re
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CRATE = os.path.join(HERE, "crates", "mastersat-native")
HEADER = os.path.join(HERE, "include", "mastersat_native.h")


def strip_comments(src):
    src = re.sub(r"/\*.*?\*/", " ", src, flags=re.S)
    src = re.sub(r"//[^\n]*", "", src)
    # Preprocessor lines (#include, #define MS_API …) are not declarations.
    return "\n".join(l for l in src.splitlines() if not l.lstrip().startswith("#"))


# cbindgen (with usize_is_size_t) spells Rust's isize `ptrdiff_t`; the header says `intptr_t`.
# Both are the signed pointer-sized integer on every target this library builds for.
ALIASES = {"ptrdiff_t": "intptr_t"}


def norm_type(t, drop_name):
    toks = [ALIASES.get(x, x) for x in t.replace("*", " * ").split()]
    if drop_name and len(toks) >= 2 and toks[-1] != "*" and re.fullmatch(r"\w+", toks[-1]):
        toks.pop()
    return " ".join(toks)


def functions(src, prefix=""):
    """{name: (ret, [params])} for every `<prefix> ret ms_name(params);` declaration."""
    out = {}
    pat = re.compile(re.escape(prefix) + r"\s*([^;{}()#]*?)\b(ms_\w+)\s*\(([^)]*)\)\s*;", re.S)
    for m in pat.finditer(strip_comments(src)):
        ret, name, params = m.group(1), m.group(2), m.group(3).strip()
        plist = [] if params in ("", "void") else [norm_type(p, True) for p in params.split(",")]
        out[name] = (norm_type(ret, False), plist)
    return out


def main():
    lib = os.path.join(HERE, "target", "debug", "libmastersat_native.dylib")
    if "--lib" in sys.argv:
        lib = sys.argv[sys.argv.index("--lib") + 1]
    header = functions(open(HEADER, encoding="utf-8").read(), prefix="MS_API")
    problems = []
    print(f"header: {len(header)} functions")

    cbindgen = shutil.which("cbindgen")
    if cbindgen:
        rendered = subprocess.run(
            [cbindgen, "--quiet", "--config", "cbindgen.toml", "--crate", "mastersat-native", "--lang", "c"],
            cwd=CRATE, check=True, capture_output=True, text=True,
        ).stdout
        rust = functions(rendered)
        for name in sorted(set(header) | set(rust)):
            if name not in rust:
                problems.append(f"cbindgen: {name} is in the header but not exported by the crate")
            elif name not in header:
                problems.append(f"cbindgen: {name} is exported but not in the header")
            elif header[name] != rust[name]:
                problems.append(f"cbindgen: {name}: header {header[name]} != crate {rust[name]}")
        print(f"cbindgen: {len(rust)} functions compared")
    else:
        print("cbindgen: not installed (cargo install cbindgen) - skipped")

    if os.path.exists(lib):
        if lib.endswith(".dylib") and shutil.which("nm"):
            out = subprocess.run(["nm", "-gU", lib], check=True, capture_output=True, text=True).stdout
            syms = {l.split()[-1].lstrip("_") for l in out.splitlines() if re.search(r"\s_ms_\w+$", l)}
        elif lib.lower().endswith(".dll") and shutil.which("dumpbin"):
            out = subprocess.run(["dumpbin", "/exports", lib], check=True, capture_output=True, text=True).stdout
            syms = set(re.findall(r"\b(ms_\w+)\b", out))
        else:
            syms = None
        if syms is not None:
            for name in sorted(set(header) - syms):
                problems.append(f"exports: {name} is not exported by {os.path.basename(lib)}")
            for name in sorted(syms - set(header)):
                problems.append(f"exports: {name} is exported by {os.path.basename(lib)} but not in the header")
            print(f"exports: {len(syms)} ms_* symbols in {os.path.basename(lib)}")
        else:
            print("exports: no symbol tool for this library type - skipped")
    else:
        print(f"exports: {lib} not built (cargo build) - skipped")

    for p in problems:
        print("MISMATCH", p)
    print("header and crate are in sync" if not problems else f"{len(problems)} mismatch(es)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
