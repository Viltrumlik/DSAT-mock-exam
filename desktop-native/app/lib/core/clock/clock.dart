// Time for the app shell: an injectable wall clock (tests use [ManualClock] or fake_async),
// and [ServerClock], which estimates the server's "now" from the `server_now` of the last
// response so labels like "starts in 2h 5m" do not depend on a wrong PC clock.
//
// The exam's countdown does NOT use this: the engine drives it from a monotonic Stopwatch
// re-anchored on every response's `timing` block (design_data_server.md §1.8).

/// Wall-clock source. Always UTC.
abstract class Clock {
  const Clock();
  DateTime now();
}

/// The real clock.
class SystemClock extends Clock {
  const SystemClock();

  @override
  DateTime now() => DateTime.now().toUtc();
}

/// A clock tests move by hand. Under fake_async use [FunctionClock] reading the fake clock.
class ManualClock extends Clock {
  ManualClock(DateTime start) : _now = start.toUtc();

  DateTime _now;

  @override
  DateTime now() => _now;

  void set(DateTime t) => _now = t.toUtc();
  void advance(Duration d) => _now = _now.add(d);
}

/// A clock backed by a closure (e.g. `() => fakeAsync.getClock(start).now()`).
class FunctionClock extends Clock {
  const FunctionClock(this._read);
  final DateTime Function() _read;

  @override
  DateTime now() => _read().toUtc();
}

/// Server "now" ≈ local now + (server_now − local time when that response arrived).
class ServerClock {
  ServerClock(this._local);

  final Clock _local;
  Duration _offset = Duration.zero;
  bool _observed = false;

  /// Whether a server timestamp has been seen yet.
  bool get observed => _observed;

  /// Server minus local, from the latest observation.
  Duration get offset => _offset;

  /// Records a response's `server_now`, received at [receivedAt] (default: now).
  void observe(DateTime serverNow, {DateTime? receivedAt}) {
    final local = (receivedAt ?? _local.now()).toUtc();
    _offset = serverNow.toUtc().difference(local);
    _observed = true;
  }

  DateTime now() => _local.now().add(_offset);
}
