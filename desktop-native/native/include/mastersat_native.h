/*
 * mastersat_native.h — the C ABI of mastersat_native.dll (Rust cdylib, crate
 * `mastersat-native`, desktop-native/native/). Architecture §5.
 *
 * THIS FILE IS THE CONTRACT. The Rust crate implements exactly these symbols
 * (`#[no_mangle] pub extern "C"`), the Windows runner (windows/runner/main.cpp)
 * links the import library and calls ms_startup + ms_init, and Dart binds the
 * same module through dart:ffi (lib/native/ffi_native_bridge.dart) — on Windows
 * `DynamicLibrary.open("mastersat_native.dll")` returns the module the runner
 * already loaded, so C++ and Dart share one set of Rust statics (the window
 * handle, the lock state, the precheck captured at lock time).
 * On macOS (development only) the same crate builds as libmastersat_native.dylib
 * using lockdown.rs's non-Windows stubs; Windows-only calls return
 * MS_ERR_UNSUPPORTED or the documented stub value.
 *
 * ---------------------------------------------------------------------------
 * CONVENTIONS
 * ---------------------------------------------------------------------------
 * Strings   : every `const char*` input is UTF-8, NUL-terminated, borrowed for
 *             the duration of the call only. Invalid UTF-8 or NULL where a
 *             value is required -> MS_ERR_ARG.
 * Outputs   : `char** out_*` receive a NEW UTF-8, NUL-terminated string
 *             allocated by Rust. The caller MUST release it with ms_free().
 *             `uint8_t** out_* + size_t* out_len` receive a NEW byte buffer;
 *             release it with ms_free_bytes(ptr, len). On any error every
 *             output pointer is set to NULL (and lengths to 0), so freeing is
 *             only needed after MS_OK.
 * Returns   : int32_t status — MS_OK (0) or a negative MS_ERR_*; functions
 *             documented as returning a boolean return 1/0 and never fail.
 * Errors    : after a failing call, ms_last_error() returns a description of
 *             the most recent error ON THE CALLING THREAD (thread-local).
 * Panics    : never cross the boundary; a caught panic returns MS_ERR_PANIC.
 * Threads   : every function may be called from any thread unless noted.
 *             Window operations (lock enter/exit, keep-awake) are marshalled to
 *             the window's thread internally. Calls are cheap except where
 *             marked SLOW — call those off the UI isolate (Isolate.run).
 * JSON      : JSON outputs are compact (no whitespace) and their exact bytes
 *             matter where noted (the precheck is signed byte-for-byte).
 *
 * Deliberate refinements of architecture §5 (this header wins):
 *  - ms_lock_enter captures the precheck JSON at engage time and returns it;
 *    ms_prove signs THAT captured string and returns the whole proof object
 *    (exactly the body of POST desktop_session/ minus `nonce`), so Dart can
 *    never sign a precheck that differs from the one sent. Same contract as
 *    the Tauri app's lockdown_enter/lockdown_prove.
 *  - Byte buffers use ms_free_bytes(ptr, len); strings use ms_free(ptr).
 *  - Added: ms_version, ms_last_error, ms_register_protocol,
 *    ms_uninstall_legacy, ms_update_progress.
 */
#ifndef MASTERSAT_NATIVE_H
#define MASTERSAT_NATIVE_H

#include <stddef.h>
#include <stdint.h>

#ifdef _WIN32
#  ifdef MASTERSAT_NATIVE_BUILD
#    define MS_API __declspec(dllexport)
#  else
#    define MS_API __declspec(dllimport)
#  endif
#else
#  define MS_API __attribute__((visibility("default")))
#endif

#ifdef __cplusplus
extern "C" {
#endif

/* ------------------------------------------------------------------------- */
/* Status codes                                                              */
/* ------------------------------------------------------------------------- */
#define MS_OK                0
#define MS_ERR_ARG          -1  /* NULL / invalid UTF-8 / malformed argument        */
#define MS_ERR_NOT_INIT     -2  /* ms_init has not run in this process             */
#define MS_ERR_NOT_LOCKED   -3  /* ms_prove outside an engaged lockdown            */
#define MS_ERR_PRECHECK     -4  /* the machine fails the pre-check (lock refused)  */
#define MS_ERR_CRYPTO       -5  /* AES-GCM tag mismatch, DPAPI failure, bad blob   */
#define MS_ERR_OS           -6  /* a Win32 / OS call failed (see ms_last_error)    */
#define MS_ERR_UNSUPPORTED  -7  /* not available on this platform (macOS stubs)    */
#define MS_ERR_NO_KEY       -8  /* this build has no DESKTOP_PROOF_KEY embedded    */
#define MS_ERR_NOT_FOUND    -9  /* e.g. ms_close_app: no such running process      */
#define MS_ERR_BUSY        -10  /* an update download is already running           */
#define MS_ERR_PANIC       -99  /* a Rust panic was caught at the boundary         */

/* ------------------------------------------------------------------------- */
/* Memory + diagnostics                                                      */
/* ------------------------------------------------------------------------- */

/* Free a string returned through any `char** out_*`. NULL is a no-op. */
MS_API void ms_free(char* ptr);

/* Free a byte buffer returned through `uint8_t** out_*`; `len` is the length
 * that was returned with it. NULL is a no-op. */
MS_API void ms_free_bytes(uint8_t* ptr, size_t len);

/* The crate version, e.g. "0.2.0". STATIC string: do NOT free. */
MS_API const char* ms_version(void);

/* Description of the last error on this thread, or NULL if none. Free with
 * ms_free. */
MS_API char* ms_last_error(void);

/* ------------------------------------------------------------------------- */
/* Process start (called by windows/runner/main.cpp, never by Dart)          */
/* ------------------------------------------------------------------------- */

/* FIRST call in wWinMain, before anything else (Velopack requirement).
 * argv: the process arguments as UTF-8 (argv[0] = exe path).
 * Runs `VelopackApp::build().run()`: on an install/update/uninstall hook it
 * writes/removes HKCU\Software\Classes\mastersat and EXITS THE PROCESS (does not
 * return). Otherwise returns MS_OK and normal startup continues.
 * Thread: the main thread, once. */
MS_API int32_t ms_startup(int32_t argc, const char* const* argv);

/* Store the top-level window handle (HWND as intptr_t) and the app version
 * (the VERSION file, also signed inside every proof), install the low-level
 * keyboard guard (lockdown::init_keyboard_guard — idle until a lock engages) and
 * start the 1 s watchdog thread. Idempotent (a second call only updates hwnd).
 * Thread: the window's thread, after the window exists, before the Flutter
 * engine runs Dart. */
MS_API int32_t ms_init(intptr_t hwnd, const char* app_version);

/* (Re)write HKCU\Software\Classes\mastersat so `mastersat://` opens
 * `"<exe_path>" "%1"`. Called on every launch (self-repair). Windows only;
 * macOS returns MS_ERR_UNSUPPORTED. */
MS_API int32_t ms_register_protocol(const char* exe_path);

/* Find the 0.1.x Tauri/NSIS per-user install (HKCU uninstall entry whose
 * DisplayName is "MasterSAT") and run its uninstaller silently. SLOW (waits for
 * the uninstaller, max 60 s). Writes {"found":bool,"ran":bool,"exit_code":int|null}.
 * Re-register the protocol (ms_register_protocol) AFTER this returns. */
MS_API int32_t ms_uninstall_legacy(char** out_json);

/* ------------------------------------------------------------------------- */
/* Lockdown (wraps desktop/src-tauri/crates/lockdown, unchanged)              */
/* ------------------------------------------------------------------------- */

/* lockdown::precheck(), serialised once:
 *   {"ok":bool,"displays":int,"remote":bool,"vm":bool,
 *    "apps":[{"exe":"telegram.exe","name":"Telegram","closable":true}]}
 * For the pre-check screen. SLOW-ish (process enumeration, ~50 ms). */
MS_API int32_t ms_precheck_json(char** out_json);

/* lockdown::close_app(exe) with the same allow-list (only exes the precheck
 * lists as closable). `exe` is the image name, e.g. "telegram.exe".
 * MS_ERR_NOT_FOUND if it is not running; MS_ERR_ARG if not on the list. */
MS_API int32_t ms_close_app(const char* exe);

/* Run a fresh precheck; if !ok -> MS_ERR_PRECHECK (and *out_precheck_json is the
 * failing report, still to be freed). If ok: lockdown::engage(hwnd)
 * (WDA_EXCLUDEFROMCAPTURE, keyboard guard active), borderless fullscreen on the
 * window's monitor, HWND_TOPMOST, heartbeat clock reset, and the precheck JSON
 * is CAPTURED — *out_precheck_json receives that exact string (the one
 * ms_prove signs and the server receives). Requires ms_init (MS_ERR_NOT_INIT). */
MS_API int32_t ms_lock_enter(char** out_precheck_json);

/* lockdown::release(hwnd), restore the window placement saved by
 * ms_lock_enter, clear the captured precheck. Safe when not locked (MS_OK). */
MS_API int32_t ms_lock_exit(void);

/* Liveness ping from the Dart UI isolate (every 3 s while locked).
 * Returns 1 = still locked; 0 = not locked (never engaged, exited, or the
 * watchdog released after 10 s without a heartbeat). Same contract as the
 * Tauri app's lockdown_heartbeat -> bool. Never fails. */
MS_API int32_t ms_heartbeat(void);

/* 1 if the student is away right now: the foreground window does not belong
 * to this process (checked by process id) OR more than one monitor is
 * attached; else 0. Polled 4x/s during lockdown. macOS stub: 0. Never fails. */
MS_API int32_t ms_away_now(void);

/* lockdown::battery() as {"percent":int|null,"charging":bool,"has_battery":bool},
 * or the JSON literal null when Windows does not know. */
MS_API int32_t ms_battery_json(char** out_json);

/* Sign the server's challenge (proof::sign with the embedded DESKTOP_PROOF_KEY)
 * over the precheck captured by ms_lock_enter. Only while locked
 * (MS_ERR_NOT_LOCKED otherwise); MS_ERR_NO_KEY if the build has no key.
 * Writes {"key_id":"…","mac":"<hex>","app_version":"…","precheck":"<captured JSON>"}
 * — the body of POST /api/midterms/attempts/{id}/desktop_session/ minus `nonce`. */
MS_API int32_t ms_prove(int64_t attempt_id, const char* nonce, char** out_proof_json);

/* ------------------------------------------------------------------------- */
/* Sign-in                                                                   */
/* ------------------------------------------------------------------------- */

/* A fresh PKCE pair: verifier = 43+ chars of base64url randomness (32 bytes
 * from the OS CSPRNG); challenge = proof::pkce_challenge(verifier) (S256). */
MS_API int32_t ms_pkce_new(char** out_verifier, char** out_challenge);

/* ------------------------------------------------------------------------- */
/* Data at rest                                                              */
/* ------------------------------------------------------------------------- */

/* AES-256-GCM with the per-user data key (random 32 bytes, wrapped with DPAPI
 * current-user scope in %LOCALAPPDATA%\MasterSAT\key.bin; created on first use).
 * Sealed format: 12-byte nonce || ciphertext || 16-byte tag. Used for past-paper
 * content, cached images and journal payloads. */
MS_API int32_t ms_seal(const uint8_t* plain, size_t plain_len, uint8_t** out, size_t* out_len);
MS_API int32_t ms_open(const uint8_t* sealed, size_t sealed_len, uint8_t** out, size_t* out_len);

/* DPAPI CryptProtectData / CryptUnprotectData, current-user scope (tokens in
 * auth.bin). macOS stub: MS_ERR_UNSUPPORTED. */
MS_API int32_t ms_protect(const uint8_t* plain, size_t plain_len, uint8_t** out, size_t* out_len);
MS_API int32_t ms_unprotect(const uint8_t* blob, size_t blob_len, uint8_t** out, size_t* out_len);

/* ------------------------------------------------------------------------- */
/* Network + power                                                           */
/* ------------------------------------------------------------------------- */

/* System proxy for `url` via WinHTTP (WinHttpGetIEProxyConfigForCurrentUser +
 * WinHttpGetProxyForUrl, so PAC/WPAD work), in dart:io HttpClient.findProxy
 * format: "DIRECT" or "PROXY host:port; PROXY host2:port; DIRECT".
 * Cached 5 minutes per host inside the DLL; the first lookup of a host may be
 * SLOW (WPAD). macOS stub: "DIRECT". */
MS_API int32_t ms_proxy_for(const char* url, char** out_proxy);

/* SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED |
 * ES_DISPLAY_REQUIRED) while on != 0; ES_CONTINUOUS alone when 0. Used during
 * any running test (lockdown.rs stays unchanged). */
MS_API int32_t ms_keep_awake(int32_t on);

/* ------------------------------------------------------------------------- */
/* Updates (Velopack UpdateManager)                                          */
/* ------------------------------------------------------------------------- */

/* Check the feed (e.g. https://mastersat.uz/downloads/desktop/ with channel
 * "stable" | "beta"). SLOW (network). Writes
 *   {"available":bool,"version":"0.3.0"|null,"is_delta":bool,"bytes":int|null}. */
MS_API int32_t ms_update_check(const char* feed_url, const char* channel, char** out_json);

/* Download the update found by the last ms_update_check. SLOW (blocks until
 * done; call from a background isolate). MS_ERR_BUSY if already running. */
MS_API int32_t ms_update_download(void);

/* Download progress 0..100 while ms_update_download runs; -1 when idle. */
MS_API int32_t ms_update_progress(void);

/* Apply the downloaded update and restart the app. Does not return on
 * success. Never call during a test or lockdown (Home only). */
MS_API int32_t ms_update_apply_restart(void);

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* MASTERSAT_NATIVE_H */
