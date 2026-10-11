// MasterSAT: one running app per user session (architecture §6, "Single
// instance and deep links").
//
// The first launch owns the named mutex Local\MasterSAT.Exam. A second launch
// finds the running window by its class name, lets it take the foreground
// (AllowSetForegroundWindow), hands it its mastersat:// link with WM_COPYDATA
// and exits. The running window passes the link to Dart through
// MethodChannel("mastersat/launch").
#ifndef RUNNER_SINGLE_INSTANCE_H_
#define RUNNER_SINGLE_INSTANCE_H_

#include <windows.h>

#include <optional>
#include <string>

class SingleInstance {
 public:
  SingleInstance() = default;
  ~SingleInstance();
  SingleInstance(const SingleInstance&) = delete;
  SingleInstance& operator=(const SingleInstance&) = delete;

  // True when this process is the first instance (or the mutex could not be
  // created at all: never block a student over it).
  bool Acquire();

  // Sends |url| (or a bare "activate" when there is none) to the running
  // window, waiting up to |timeout_ms| for it to appear (it may still be
  // starting). Returns false when no window answered.
  static bool ForwardToRunning(const std::optional<std::string>& url,
                               DWORD timeout_ms = 5000);

 private:
  HANDLE mutex_ = nullptr;
};

#endif  // RUNNER_SINGLE_INSTANCE_H_
