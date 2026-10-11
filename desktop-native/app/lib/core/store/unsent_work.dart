// "Unsent items" — work saved on this computer that the server has not acknowledged yet
// (answers in the exam outbox, queued off-screen events, highlights, reports).
//
// Sign-out and "Delete data on this computer" are blocked while any remain (design §1.12:
// after sign-out the tokens that could send them are gone). The exam engine owns the outbox,
// so it REGISTERS a counter here; this registry only asks.
//
//   final unregister = services.unsentWork.register('exam outbox', () => outbox.pendingCount());
import 'dart:async';

import 'package:flutter/foundation.dart';

typedef UnsentCounter = FutureOr<int> Function();

/// The answer to "is anything unsent?".
@immutable
class UnsentSummary {
  const UnsentSummary(this.bySource);

  static const none = UnsentSummary({});

  /// source name → pending count (only non-zero sources).
  final Map<String, int> bySource;

  int get total => bySource.values.fold(0, (a, b) => a + b);
  bool get isEmpty => total == 0;

  Map<String, Object?> toJson() => {'total': total, 'by_source': bySource};
}

class UnsentWork {
  final Map<String, UnsentCounter> _counters = {};

  /// Registers (or replaces) the counter for [source]; returns a function that removes it.
  VoidCallback register(String source, UnsentCounter counter) {
    _counters[source] = counter;
    return () {
      if (identical(_counters[source], counter)) _counters.remove(source);
    };
  }

  Iterable<String> get sources => _counters.keys;

  /// Asks every counter. A counter that throws counts as 1 — when in doubt, do not let the
  /// student delete what might be their only copy.
  Future<UnsentSummary> check() async {
    final out = <String, int>{};
    for (final e in _counters.entries.toList()) {
      int n;
      try {
        n = await e.value();
      } catch (_) {
        n = 1;
      }
      if (n > 0) out[e.key] = n;
    }
    return UnsentSummary(out);
  }
}
