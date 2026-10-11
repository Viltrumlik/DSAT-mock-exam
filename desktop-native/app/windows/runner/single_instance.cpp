// MasterSAT: see single_instance.h.
#include "single_instance.h"

#include "launch_policy.h"

SingleInstance::~SingleInstance() {
  if (mutex_ != nullptr) {
    CloseHandle(mutex_);
  }
}

bool SingleInstance::Acquire() {
  mutex_ = CreateMutexW(nullptr, FALSE, launch_policy::kInstanceMutexName);
  if (mutex_ == nullptr) {
    return true;
  }
  return GetLastError() != ERROR_ALREADY_EXISTS;
}

// static
bool SingleInstance::ForwardToRunning(const std::optional<std::string>& url,
                                      DWORD timeout_ms) {
  const ULONGLONG deadline = GetTickCount64() + timeout_ms;
  for (;;) {
    HWND running = FindWindowW(launch_policy::kWindowClassName, nullptr);
    if (running != nullptr) {
      DWORD pid = 0;
      GetWindowThreadProcessId(running, &pid);
      if (pid != 0) {
        AllowSetForegroundWindow(pid);
      }
      COPYDATASTRUCT data{};
      data.dwData = launch_policy::kCopyDataMagic;
      if (url.has_value()) {
        data.cbData = static_cast<DWORD>(url->size());
        data.lpData = const_cast<char*>(url->data());
      }
      DWORD_PTR answer = 0;
      const LRESULT sent = SendMessageTimeoutW(
          running, WM_COPYDATA, 0, reinterpret_cast<LPARAM>(&data),
          SMTO_ABORTIFHUNG | SMTO_BLOCK, 5000, &answer);
      return sent != 0 && answer != 0;
    }
    if (GetTickCount64() >= deadline) {
      return false;
    }
    Sleep(100);
  }
}
