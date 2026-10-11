// Tests for the Dart half of the MasterSAT patches (see NOTICE). The native
// half is covered by windows/test (policy) and the Windows CI job (build).

import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ms_webview2/ms_webview2.dart';

const MethodChannel _pluginChannel = MethodChannel('mastersat/ms_webview2');

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late TestDefaultBinaryMessenger messenger;
  late List<MethodCall> instanceLog;
  MockStreamHandlerEventSink? eventSink;

  void mockNativeSide({Object? Function(MethodCall call)? onInstanceCall}) {
    messenger.setMockMethodCallHandler(_pluginChannel, (call) async {
      if (call.method == 'initialize') return <String, dynamic>{'textureId': 7};
      return null;
    });
    messenger.setMockMethodCallHandler(const MethodChannel('mastersat/ms_webview2/7'), (call) async {
      instanceLog.add(call);
      return onInstanceCall?.call(call);
    });
    messenger.setMockStreamHandler(
      const EventChannel('mastersat/ms_webview2/7/events'),
      MockStreamHandler.inline(
        onListen: (arguments, events) {
          eventSink = events;
        },
        onCancel: (arguments) {
          eventSink = null;
        },
      ),
    );
  }

  setUp(() {
    messenger = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    instanceLog = <MethodCall>[];
    eventSink = null;
  });

  tearDown(() {
    messenger.setMockMethodCallHandler(_pluginChannel, null);
  });

  group('channels', () {
    test('use the mastersat/ms_webview2 names, never the upstream ones', () async {
      mockNativeSide();
      final controller = WebviewController();
      await controller.initialize();
      expect(eventSink, isNotNull);
      await controller.loadUrl('https://island.mastersat.example/content.html');
      expect(instanceLog.single.method, 'loadUrl');
      await controller.dispose();
    });
  });

  group('new methods', () {
    late WebviewController controller;

    setUp(() async {
      mockNativeSide(
        onInstanceCall: (call) => call.method == 'capturePreview' ? Uint8List.fromList([0x89, 0x50, 0x4E, 0x47]) : null,
      );
      controller = WebviewController();
      await controller.initialize();
    });

    tearDown(() async => controller.dispose());

    test('capturePreview returns the PNG bytes', () async {
      final png = await controller.capturePreview();
      expect(png, [0x89, 0x50, 0x4E, 0x47]);
      expect(instanceLog.single, isMethodCall('capturePreview', arguments: null));
    });

    test('setVisible sends the flag', () async {
      await controller.setVisible(false);
      await controller.setVisible(true);
      expect(instanceLog, [isMethodCall('setVisible', arguments: false), isMethodCall('setVisible', arguments: true)]);
    });

    test('setAllowedResourceHosts sends the host list', () async {
      await controller.setAllowedResourceHosts(['www.desmos.com', '*.desmos.com']);
      expect(instanceLog.single, isMethodCall('setAllowedResourceHosts', arguments: ['www.desmos.com', '*.desmos.com']));
    });

    test('new methods are no-ops after dispose', () async {
      await controller.dispose();
      expect(await controller.capturePreview(), isNull);
      await controller.setVisible(false);
      await controller.setAllowedResourceHosts(const []);
      expect(instanceLog, isEmpty);
    });
  });

  group('new events', () {
    late WebviewController controller;

    setUp(() async {
      mockNativeSide();
      controller = WebviewController();
      await controller.initialize();
    });

    tearDown(() async => controller.dispose());

    test('webMessageReceived feeds both the raw and the decoded stream', () async {
      final raw = controller.webMessageRaw.first;
      final decoded = controller.webMessage.first;
      eventSink!.success({'type': 'webMessageReceived', 'value': '{"v":1,"t":"ready"}'});
      expect(await raw, '{"v":1,"t":"ready"}');
      expect(await decoded, {'v': 1, 't': 'ready'});
    });

    test('invalid JSON still reaches the raw stream', () async {
      final raw = controller.webMessageRaw.first;
      final errors = <Object>[];
      final sub = controller.webMessage.listen((_) {}, onError: errors.add);
      eventSink!.success({'type': 'webMessageReceived', 'value': 'not json'});
      expect(await raw, 'not json');
      await Future<void>.delayed(Duration.zero);
      expect(errors, hasLength(1));
      await sub.cancel();
    });

    test('processFailed maps the kind and flags a browser exit', () async {
      final failures = controller.onProcessFailed.take(3).toList();
      eventSink!.success({
        'type': 'processFailed',
        'value': {'kind': 0, 'reason': 2, 'exitCode': -1},
      });
      eventSink!.success({
        'type': 'processFailed',
        'value': {'kind': 1, 'reason': -1, 'exitCode': 0},
      });
      eventSink!.success({
        'type': 'processFailed',
        'value': {'kind': 99, 'reason': -1, 'exitCode': 0},
      });
      final list = await failures;
      expect(list[0].kind, WebviewProcessFailedKind.browserProcessExited);
      expect(list[0].browserExited, isTrue);
      expect(list[0].reason, 2);
      expect(list[0].exitCode, -1);
      expect(list[1].kind, WebviewProcessFailedKind.renderProcessExited);
      expect(list[1].browserExited, isFalse);
      expect(list[2].kind, WebviewProcessFailedKind.unknown);
    });

    test('blocked feeds onBlocked', () async {
      final blocked = controller.onBlocked.first;
      eventSink!.success({
        'type': 'blocked',
        'value': {'what': 'navigation', 'uri': 'https://evil.example/'},
      });
      final event = await blocked;
      expect(event.what, 'navigation');
      expect(event.uri, 'https://evil.example/');
    });
  });

  test('WebviewProcessFailedKind matches COREWEBVIEW2_PROCESS_FAILED_KIND', () {
    expect(WebviewProcessFailedKind.browserProcessExited.index, 0);
    expect(WebviewProcessFailedKind.renderProcessExited.index, 1);
    expect(WebviewProcessFailedKind.renderProcessUnresponsive.index, 2);
    expect(WebviewProcessFailedKind.frameRenderProcessExited.index, 3);
    expect(WebviewProcessFailedKind.utilityProcessExited.index, 4);
    expect(WebviewProcessFailedKind.sandboxHelperProcessExited.index, 5);
    expect(WebviewProcessFailedKind.gpuProcessExited.index, 6);
    expect(WebviewProcessFailedKind.ppapiPluginProcessExited.index, 7);
    expect(WebviewProcessFailedKind.unknown, WebviewProcessFailedKind.values.last);
  });

  group('cursorMapper', () {
    testWidgets('maps the page cursor before it is shown', (tester) async {
      mockNativeSide();
      final controller = WebviewController();
      await tester.runAsync(controller.initialize);

      await tester.pumpWidget(
        Directionality(
          textDirection: TextDirection.ltr,
          child: Webview(
            controller,
            cursorMapper: (c) => c == SystemMouseCursors.click ? SystemMouseCursors.basic : c,
          ),
        ),
      );
      await tester.pump();

      MouseCursor shown() => tester.widget<MouseRegion>(find.byType(MouseRegion).last).cursor;

      eventSink!.success({'type': 'cursorChanged', 'value': 'text'});
      // The event crosses real-async zones; settle them before pumping.
      await tester.runAsync(() => Future<void>.delayed(Duration.zero));
      await tester.pump();
      expect(shown(), SystemMouseCursors.text);

      eventSink!.success({'type': 'cursorChanged', 'value': 'click'});
      await tester.runAsync(() => Future<void>.delayed(Duration.zero));
      await tester.pump();
      expect(shown(), SystemMouseCursors.basic);

      await tester.pumpWidget(const SizedBox());
      await tester.runAsync(controller.dispose);
    });
  });
}
