// The laptop battery for the past-paper runner's header, as the website does inside the app
// (frontend/src/lib/desktop/useBattery.ts: read at once, then every 30 s; null on a desktop PC;
// a failed read keeps the last reading). Midterms read it in their engine instead.
import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../native/native_bridge.dart';

class BatteryPoller implements ValueListenable<BatteryStatus?> {
  BatteryPoller(this._native, {this.period = const Duration(seconds: 30)}) {
    _read();
    _timer = Timer.periodic(period, (_) => _read());
  }

  final NativeBridge _native;
  final Duration period;
  final ValueNotifier<BatteryStatus?> _value = ValueNotifier(null);
  Timer? _timer;

  void _read() {
    try {
      final b = _native.battery();
      _value.value = (b != null && b.hasBattery) ? b : null;
    } on Object {
      // The indicator keeps its last reading.
    }
  }

  @override
  BatteryStatus? get value => _value.value;

  @override
  void addListener(VoidCallback listener) => _value.addListener(listener);

  @override
  void removeListener(VoidCallback listener) => _value.removeListener(listener);

  void dispose() {
    _timer?.cancel();
    _timer = null;
    _value.dispose();
  }
}
