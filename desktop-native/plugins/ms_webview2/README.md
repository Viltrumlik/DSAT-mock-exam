# ms_webview2

MasterSAT's patched copy of
[webview_flutter_windows](https://github.com/omar-hanafy/webview_flutter_windows)
1.3.0 (BSD-3, see `LICENSE`). WebView2 is drawn into a Flutter `Texture`, so
native Flutter widgets can float over web content.

It hosts the exam app's two web islands (the question card and Desmos) and
nothing else. The lockdown lives in native code: see `NOTICE` for the origin
and the full patch list.

Use it through `lib/island/texture_island_host.dart` in the app, never
directly from feature code.

```dart
final controller = WebviewController();
await controller.initialize();
await controller.setAllowedResourceHosts(const []); // content island
await controller.addVirtualHostNameMapping(
    'island.mastersat.example', islandDir, WebviewHostResourceAccessKind.denyCors);
await controller.loadUrl('https://island.mastersat.example/content.html');
controller.webMessageRaw.listen(handle);
```

Requirements: Windows 10 1809+, the WebView2 runtime (the Velopack installer
installs it), Flutter >= 3.44.

Tests:

```sh
flutter test                                   # Dart side (any OS)
cmake -S windows/test -B build/native_tests    # native policy/util tests (Windows)
cmake --build build/native_tests --config Release
ctest --test-dir build/native_tests -C Release --output-on-failure
```
