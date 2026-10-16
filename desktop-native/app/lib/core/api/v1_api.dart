// The client's whole server surface, typed. One method per endpoint the native app calls:
// the /api/desktop/v1/ endpoints plus the existing endpoints it uses as they are
// (architecture §4.3-B/C). Wire shapes: desktop-native/contracts/v1/README.md.
//
// Implementations:
//  * HttpV1Api    (app-core, lib/core/api/http_v1_api.dart) — dart:io, one HttpClient.
//  * FixtureV1Api (this folder) — in-memory, fixture-backed; tests and offline dev.
//
// Every method throws only [ApiException] subtypes:
//  * [ApiError]        — the server answered with a non-2xx status (except 426);
//  * [UpdateRequired]  — HTTP 426 from the version gate (or a lockdown `desktop_update_required`);
//  * [NetworkError]    — no answer at all (DNS, connect, TLS, timeout, reset, bad JSON).
import 'dart:typed_data';

import '../models/models.dart';

/// Base type of every failure a [V1Api] call can raise.
sealed class ApiException implements Exception {
  const ApiException();

  /// Worth retrying later with the same idempotency key (design §1.5 retry policy):
  /// network errors, 408, 429 and 5xx.
  bool get isTransient;
}

/// The server answered with an error status. [body] is the parsed error envelope.
final class ApiError extends ApiException {
  const ApiError({required this.status, required this.body, this.retryAfter});

  final int status;
  final ApiErrorBody body;

  /// From the `Retry-After` header (429/503), if any.
  final Duration? retryAfter;

  /// `code` (or, for lockdown refusals, `reason`): `module_not_expired`, `code_incorrect`,
  /// `not_visible`, `token_not_valid`, `desktop_session_replaced`, …
  String? get code => body.kind;

  /// 409 `module_not_expired`: retry after this many ms (+250 ms margin, design §1.7).
  int? get retryAfterMs => body.retryAfterMs ?? retryAfter?.inMilliseconds;

  bool get isUnauthorized => status == 401;
  bool get isLockdownRefusal => body.reason != null && (body.desktopRequired ?? false);

  @override
  bool get isTransient => status == 408 || status == 429 || status >= 500;

  @override
  String toString() => 'ApiError($status, ${code ?? '-'}: ${body.detail ?? ''})';
}

/// HTTP 426: this build is below the Windows release policy's minimum.
final class UpdateRequired extends ApiException {
  const UpdateRequired({this.minimumVersion, this.latestVersion, required this.updateUrl, this.detail});

  factory UpdateRequired.fromBody(ApiErrorBody b) => UpdateRequired(
        minimumVersion: b.minimumVersion,
        latestVersion: b.latestVersion,
        updateUrl: b.updateUrl ?? '',
        detail: b.detail,
      );

  final String? minimumVersion;
  final String? latestVersion;
  final String updateUrl;
  final String? detail;

  @override
  bool get isTransient => false;

  @override
  String toString() => 'UpdateRequired(min $minimumVersion, latest $latestVersion)';
}

/// No usable answer: offline, DNS, connect/TLS failure, timeout, reset, or an unparsable body.
final class NetworkError extends ApiException {
  const NetworkError(this.message, {this.cause, this.timedOut = false});

  final String message;
  final Object? cause;
  final bool timedOut;

  @override
  bool get isTransient => true;

  @override
  String toString() => 'NetworkError($message${timedOut ? ', timed out' : ''})';
}

/// Result of `GET home` with `If-None-Match`.
class HomeFetch {
  const HomeFetch.fresh(HomeResponse this.home, this.etag) : notModified = false;
  const HomeFetch.notModified(this.etag)
      : home = null,
        notModified = true;

  /// Null when [notModified] (render the cached copy).
  final HomeResponse? home;

  /// The response `ETag` to store and send next time.
  final String? etag;
  final bool notModified;
}

/// The `Idempotency-Key` formats (design §1.5). Build keys ONLY through these.
abstract final class IdempotencyKeys {
  static String start(int attemptId) => 'start.$attemptId';
  static String sync(int attemptId, int moduleId, int seq) => 'sync.$attemptId.$moduleId.$seq';
  static String submit(int attemptId, int moduleId) => 'submit.$attemptId.$moduleId';
  static String offscreen(int attemptId, String eventUuid) => 'off.$attemptId.$eventUuid';
  static String report(String uuid) => 'report.$uuid';
}

/// Request paths (relative to the API origin, e.g. `https://mastersat.uz`).
abstract final class V1Paths {
  static const v1 = '/api/desktop/v1';
  static const home = '$v1/home';
  static String pastpaperOpen(int practiceTestId) => '$v1/pastpapers/$practiceTestId/open';
  static String pastpaperStart(int attemptId) => '$v1/pastpapers/attempts/$attemptId/start';
  static String pastpaperSync(int attemptId) => '$v1/pastpapers/attempts/$attemptId/sync';
  static String pastpaperSubmit(int attemptId) => '$v1/pastpapers/attempts/$attemptId/submit';
  static String pastpaperPause(int attemptId) => '$v1/pastpapers/attempts/$attemptId/pause';
  static String pastpaperResume(int attemptId) => '$v1/pastpapers/attempts/$attemptId/resume';
  static String pastpaperResult(int attemptId, [Map<int, String> have = const {}]) =>
      '$v1/pastpapers/attempts/$attemptId/result${haveQuery(have)}';
  static String midtermPrepare(int midtermId) => '$v1/midterms/$midtermId/prepare';
  static String midtermOpen(int attemptId) => '$v1/midterms/attempts/$attemptId/open';
  static String midtermSync(int attemptId) => '$v1/midterms/attempts/$attemptId/sync';
  static String midtermSubmit(int attemptId) => '$v1/midterms/attempts/$attemptId/submit';
  static String midtermOffscreen(int attemptId) => '$v1/midterms/attempts/$attemptId/offscreen';
  static String midtermResult(int attemptId) => '$v1/midterms/attempts/$attemptId/result';
  static String media(AttemptKind kind, int attemptId) => '$v1/attempts/${kind.wire}/$attemptId/media';

  // Existing endpoints, used as they are.
  static const authLogin = '/api/desktop/auth/login/';
  static const authRefresh = '/api/auth/refresh/';
  static String midtermChallenge(int attemptId) => '/api/midterms/attempts/$attemptId/desktop_challenge/';
  static String midtermSession(int attemptId) => '/api/midterms/attempts/$attemptId/desktop_session/';
  static const annotationWrite = '/api/annotations/write/';
  static const questionReport = '/api/question-reports/reports/';
  static String pastpaperReportPdf(int attemptId) => '/api/classes/pastpapers/attempts/$attemptId/report/pdf/';
  static String pastpaperCertificatePdf(int attemptId) =>
      '/api/classes/pastpapers/attempts/$attemptId/certificate/pdf/';
  static String midtermErrorReportPdf(int attemptId) => '/api/midterms/attempts/$attemptId/error-report/pdf/';
  static String midtermCertificatePdf(String code) =>
      '/api/classes/certificates/midterm/${Uri.encodeComponent(code)}/download/';

  /// `?have=301:sha256:…,302:sha256:…` (empty string when [have] is empty).
  static String haveQuery(Map<int, String> have) {
    if (have.isEmpty) return '';
    final v = have.entries.map((e) => '${e.key}:${e.value}').join(',');
    return '?have=${Uri.encodeQueryComponent(v)}';
  }
}

/// Header names.
abstract final class V1Headers {
  static const client = 'X-MasterSAT-Client';
  static const idempotencyKey = 'Idempotency-Key';
  static const lockdownSession = 'X-Lockdown-Session';
  static const ifNoneMatch = 'If-None-Match';
  static const etag = 'ETag';

  /// `windows/<semver>` — what `is_native_client` and the version gate read.
  static String clientValue(String appVersion) => 'windows/$appVersion';
}

/// The typed server surface. Implementations attach auth, client and idempotency headers.
abstract class V1Api {
  // ---- auth (existing endpoints) ----------------------------------------------------------

  /// `POST /api/desktop/auth/login/` — the sign-in form: login + password for the token pair.
  /// 401 wrong login or password, 403 `password_not_set` or another refusal, 429 slow down.
  Future<AuthTokens> authLogin(AuthLoginRequest body);

  /// `POST /api/auth/refresh/` — rotates: always store the returned refresh token.
  Future<AuthTokens> authRefresh(RefreshRequest body);

  // ---- home -------------------------------------------------------------------------------

  /// `GET home` with optional `If-None-Match` (304 → [HomeFetch.notModified]).
  Future<HomeFetch> home({String? ifNoneMatch});

  // ---- past papers ------------------------------------------------------------------------

  /// `POST pastpapers/{practice_test_id}/open` — resume, restore ABANDONED, or create.
  Future<ExamBundle> pastpaperOpen(int practiceTestId, PastpaperOpenRequest body);

  /// `POST pastpapers/attempts/{id}/start` — after the Welcome screen. Key: [IdempotencyKeys.start].
  Future<AttemptEnvelope> pastpaperStart(int attemptId, {required String idempotencyKey});

  /// `POST pastpapers/attempts/{id}/sync` — background safety copy. Key: [IdempotencyKeys.sync].
  Future<WriteOutcome> pastpaperSync(int attemptId, SyncRequest body, {required String idempotencyKey});

  /// `POST pastpapers/attempts/{id}/submit` — module end. Key: [IdempotencyKeys.submit].
  Future<SubmitOutcome> pastpaperSubmit(int attemptId, SyncRequest body, {required String idempotencyKey});

  /// `POST pastpapers/attempts/{id}/pause` — needs a connection.
  Future<AttemptEnvelope> pastpaperPause(int attemptId);

  /// `POST pastpapers/attempts/{id}/resume`.
  Future<AttemptEnvelope> pastpaperResume(int attemptId);

  /// `GET pastpapers/attempts/{id}/result?have=` — SCORING → poll again after `poll_after_ms`.
  Future<PastpaperResult> pastpaperResult(int attemptId, {Map<int, String> have = const {}});

  // ---- midterms ---------------------------------------------------------------------------

  /// `POST midterms/{midterm_id}/prepare` — gate, create-or-resume, optional code check.
  /// A wrong code throws [ApiError] 403 `code_incorrect`.
  Future<MidtermPrepareResponse> midtermPrepare(int midtermId, MidtermPrepareRequest body);

  /// `POST /api/midterms/attempts/{id}/desktop_challenge/` (existing).
  Future<LockdownChallenge> midtermChallenge(int attemptId);

  /// `POST /api/midterms/attempts/{id}/desktop_session/` (existing).
  Future<LockdownSession> midtermSession(int attemptId, LockdownSessionRequest body);

  /// `POST midterms/attempts/{id}/open` — live module only.
  Future<ExamBundle> midtermOpen(int attemptId, MidtermOpenRequest body, {required String lockdownSession});

  /// `POST midterms/attempts/{id}/sync` — heartbeat every 15 s + change-triggered.
  Future<WriteOutcome> midtermSync(
    int attemptId,
    SyncRequest body, {
    required String lockdownSession,
    required String idempotencyKey,
  });

  /// `POST midterms/attempts/{id}/submit` — at deadline + 750 ms. Early: [ApiError] 409
  /// `module_not_expired` with [ApiError.retryAfterMs].
  Future<SubmitOutcome> midtermSubmit(
    int attemptId,
    SyncRequest body, {
    required String lockdownSession,
    required String idempotencyKey,
  });

  /// `POST midterms/attempts/{id}/offscreen` — one strike per key ([IdempotencyKeys.offscreen]).
  Future<OffscreenOutcome> midtermOffscreen(
    int attemptId,
    OffscreenRequest body, {
    required String lockdownSession,
    required String idempotencyKey,
  });

  /// `GET midterms/attempts/{id}/result`.
  Future<MidtermResult> midtermResult(int attemptId);

  // ---- media ------------------------------------------------------------------------------

  /// `GET attempts/{kind}/{id}/media` — fresh signed URLs (midterm needs [lockdownSession]).
  Future<MediaResponse> media(AttemptKind kind, int attemptId, {String? lockdownSession});

  // ---- low-priority lane (existing endpoints) ---------------------------------------------

  /// `PUT /api/annotations/write/` → 204.
  Future<void> annotationWrite(AnnotationWriteRequest body);

  /// `POST /api/question-reports/reports/`. Key: [IdempotencyKeys.report].
  Future<QuestionReportResponse> questionReport(QuestionReportRequest body, {required String idempotencyKey});

  // ---- documents (existing endpoints; PDF bytes) ------------------------------------------

  Future<Uint8List> pastpaperReportPdf(int attemptId);
  Future<Uint8List> pastpaperCertificatePdf(int attemptId);
  Future<Uint8List> midtermErrorReportPdf(int attemptId);
  Future<Uint8List> midtermCertificatePdf(String code);
}
