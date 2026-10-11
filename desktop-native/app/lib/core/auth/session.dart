// The signed-in session as stored (sealed) in auth.bin, plus the bits of a JWT the client
// reads WITHOUT verifying it (only to schedule refreshes — the server verifies).
import 'dart:convert';

import 'package:flutter/foundation.dart';

/// Simple JWT `exp` / `user_id` reader. Returns null for anything that is not a JWT.
abstract final class Jwt {
  static Map<String, Object?>? payload(String token) {
    final parts = token.split('.');
    if (parts.length != 3) return null;
    try {
      final normalised = base64Url.normalize(parts[1]);
      final decoded = jsonDecode(utf8.decode(base64Url.decode(normalised)));
      return decoded is Map ? decoded.cast<String, Object?>() : null;
    } catch (_) {
      return null;
    }
  }

  /// The `exp` claim as UTC, or null.
  static DateTime? expiry(String token) {
    final exp = payload(token)?['exp'];
    if (exp is num) return DateTime.fromMillisecondsSinceEpoch((exp * 1000).round(), isUtc: true);
    return null;
  }

  /// SimpleJWT's `user_id` claim, or null.
  static int? userId(String token) {
    final v = payload(token)?['user_id'];
    if (v is int) return v;
    if (v is String) return int.tryParse(v);
    return null;
  }
}

/// The server's ACCESS_TOKEN_LIFETIME (backend/config/settings.py SIMPLE_JWT: 3 h). Used only
/// when a token carries no readable `exp`.
const Duration assumedAccessLifetime = Duration(hours: 3);

@immutable
class AuthSession {
  const AuthSession({
    required this.access,
    required this.refresh,
    required this.obtainedAt,
    this.userId,
    this.displayName,
  });

  factory AuthSession.fromJson(Map<String, Object?> j) => AuthSession(
        access: j['access']! as String,
        refresh: j['refresh']! as String,
        obtainedAt: DateTime.parse(j['obtained_at']! as String).toUtc(),
        userId: (j['user_id'] as num?)?.toInt(),
        displayName: j['display_name'] as String?,
      );

  final String access;
  final String refresh;

  /// When this access token was issued to us (fallback for expiry).
  final DateTime obtainedAt;

  /// The student id (from the JWT or the first `home`); keys the per-user cache database.
  final int? userId;

  /// The student's name, for diagnostics and the offline greeting.
  final String? displayName;

  /// When the access token stops working.
  DateTime get accessExpiresAt => Jwt.expiry(access) ?? obtainedAt.add(assumedAccessLifetime);

  AuthSession copyWith({String? access, String? refresh, DateTime? obtainedAt, int? userId, String? displayName}) =>
      AuthSession(
        access: access ?? this.access,
        refresh: refresh ?? this.refresh,
        obtainedAt: obtainedAt ?? this.obtainedAt,
        userId: userId ?? this.userId,
        displayName: displayName ?? this.displayName,
      );

  Map<String, Object?> toJson() => {
        'access': access,
        'refresh': refresh,
        'obtained_at': obtainedAt.toUtc().toIso8601String(),
        'user_id': userId,
        'display_name': displayName,
      };
}
