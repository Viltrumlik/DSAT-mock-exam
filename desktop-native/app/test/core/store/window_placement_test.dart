// The window's place is remembered per student through MethodChannel('mastersat/window') when
// the runner speaks it; without a native half nothing breaks.
import 'package:fake_async/fake_async.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/core/store/settings_store.dart';
import 'package:mastersat_app/core/store/user_store.dart';
import 'package:mastersat_app/core/store/window_placement_sync.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final messenger = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;

  Future<void> fromNative(MethodChannel channel, String method, Object? args) => messenger.handlePlatformMessage(
      channel.name, const StandardMethodCodec().encodeMethodCall(MethodCall(method, args)), (_) {});

  test('restores the saved placement and saves moves (debounced)', () {
    fakeAsync((fa) {
      const channel = MethodChannel('test/window');
      final toNative = <MethodCall>[];
      messenger.setMockMethodCallHandler(channel, (call) async {
        toNative.add(call);
        return null;
      });
      late UserStore store;
      UserStore.memory(77).then((s) => store = s);
      fa.flushMicrotasks();
      const saved = WindowPlacement(x: 10, y: 20, width: 1280, height: 820);
      store.settings.setWindowPlacement(saved);
      fa.flushMicrotasks();

      final sync = WindowPlacementSync(channel: channel);
      sync.attach(store.settings);
      fa.flushMicrotasks();
      expect(toNative.single.method, 'restorePlacement');
      expect(toNative.single.arguments, saved.toJson());

      fromNative(channel, 'placementChanged', {'x': 50, 'y': 60, 'width': 1400, 'height': 900, 'maximized': false});
      fromNative(channel, 'placementChanged', {'x': 55, 'y': 60, 'width': 1400, 'height': 900, 'maximized': true});
      fa.flushMicrotasks();
      expect(store.settings.windowPlacement, saved, reason: 'debounced');
      fa.elapse(const Duration(milliseconds: 600));
      expect(store.settings.windowPlacement, const WindowPlacement(x: 55, y: 60, width: 1400, height: 900, maximized: true));

      fromNative(channel, 'placementChanged', 'garbage');
      fa.elapse(const Duration(seconds: 1));
      expect(store.settings.windowPlacement!.x, 55);

      sync.dispose();
      messenger.setMockMethodCallHandler(channel, null);
      store.close();
      fa.flushMicrotasks();
    });
  });

  test('with no native half, attach does nothing and nothing throws', () async {
    final store = await UserStore.memory(5);
    addTearDown(store.close);
    await store.settings.setWindowPlacement(const WindowPlacement(x: 1, y: 2, width: 3, height: 4));
    final sync = WindowPlacementSync(channel: const MethodChannel('test/window-none'));
    await sync.attach(store.settings);
    sync.detach();
    sync.dispose();
  });
}
