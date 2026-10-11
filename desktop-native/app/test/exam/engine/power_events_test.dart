// The Windows runner's power/clock events arrive on MethodChannel('mastersat/power') (windows-host
// sends them from WM_POWERBROADCAST / WM_TIMECHANGE); this proves the Dart end of that wire.
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/exam/engine/power_events.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  Future<ByteData?> send(String method) {
    const codec = StandardMethodCodec();
    return TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.handlePlatformMessage(
      PowerEvents.channelName,
      codec.encodeMethodCall(MethodCall(method)),
      (_) {},
    ).then((_) => null);
  }

  test('resumed, suspending and timeChanged from the runner become events, in order', () async {
    final power = PowerEvents();
    final got = <PowerEvent>[];
    final sub = power.events.listen(got.add);
    await send('suspending');
    await send('resumed');
    await send('timeChanged');
    await Future<void>.delayed(Duration.zero);
    expect(got, [PowerEvent.suspending, PowerEvent.resumed, PowerEvent.timeChanged]);
    await sub.cancel();
    await power.dispose();
  });

  test('an unknown method is refused, not turned into an event', () async {
    final power = PowerEvents();
    final got = <PowerEvent>[];
    final sub = power.events.listen(got.add);
    await expectLater(power.handleCall(const MethodCall('lidClosed')), throwsA(isA<MissingPluginException>()));
    await Future<void>.delayed(Duration.zero);
    expect(got, isEmpty);
    await sub.cancel();
    await power.dispose();
  });

  test('after dispose the channel has no handler (a late event goes nowhere, nothing throws)', () async {
    final power = PowerEvents();
    final got = <PowerEvent>[];
    power.events.listen(got.add);
    await power.dispose();
    await send('resumed');
    await Future<void>.delayed(Duration.zero);
    expect(got, isEmpty);
  });
}
