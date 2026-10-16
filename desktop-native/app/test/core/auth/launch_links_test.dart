// mastersat:// links: windows-host's channel protocol (the app takes links and ignores them).
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/core/auth/launch_links.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test("the runner's messages: 'open' {url}, a bare 'link', and 'activate'", () async {
    const channel = MethodChannel('test/launch-links');
    final links = LaunchLinks(channel: channel);
    addTearDown(links.dispose);
    final got = <String>[];
    var activations = 0;
    links.links.listen(got.add);
    links.activations.listen((_) => activations++);

    final messenger = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    Future<void> send(String method, Object? args) => messenger.handlePlatformMessage(
        channel.name, const StandardMethodCodec().encodeMethodCall(MethodCall(method, args)), (_) {});
    await send('open', {'url': 'mastersat://auth?code=1'});
    await send('link', 'mastersat://auth?code=2');
    await send('activate', null);
    await send('unknown', 'x');
    await Future<void>.delayed(Duration.zero);
    expect(got, ['mastersat://auth?code=1', 'mastersat://auth?code=2']);
    expect(activations, 1);
  });

  test('takePending returns the queued links; with no native half it is empty', () async {
    const channel = MethodChannel('test/launch-pending');
    final messenger = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(channel, (call) async {
      if (call.method == 'takePending') return <Object?>['mastersat://auth?code=a', 7, null];
      return null;
    });
    addTearDown(() => messenger.setMockMethodCallHandler(channel, null));
    final links = LaunchLinks(channel: channel);
    addTearDown(links.dispose);
    expect(await links.takePending(), ['mastersat://auth?code=a']);

    final bare = LaunchLinks(channel: const MethodChannel('test/no-native-half'));
    addTearDown(bare.dispose);
    expect(await bare.takePending(), isEmpty);
    await bare.focusWindow(); // no throw
  });
}
