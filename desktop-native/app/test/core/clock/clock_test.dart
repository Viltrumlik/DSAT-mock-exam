import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/core/clock/clock.dart';

void main() {
  test('ServerClock follows the server, not a wrong PC clock', () {
    final local = ManualClock(DateTime.utc(2026, 10, 11, 9));
    final server = ServerClock(local);
    expect(server.observed, isFalse);
    expect(server.now(), local.now());
    // The PC is 7 minutes slow.
    server.observe(DateTime.utc(2026, 10, 11, 9, 7));
    expect(server.observed, isTrue);
    expect(server.offset, const Duration(minutes: 7));
    local.advance(const Duration(seconds: 30));
    expect(server.now(), DateTime.utc(2026, 10, 11, 9, 7, 30));
    // An observation is anchored to when the answer arrived.
    server.observe(DateTime.utc(2026, 10, 11, 9, 0), receivedAt: DateTime.utc(2026, 10, 11, 9, 0));
    expect(server.offset, Duration.zero);
  });

  test('clocks are UTC', () {
    expect(const SystemClock().now().isUtc, isTrue);
    expect(FunctionClock(() => DateTime(2026)).now().isUtc, isTrue);
    expect(ManualClock(DateTime(2026)).now().isUtc, isTrue);
  });
}
