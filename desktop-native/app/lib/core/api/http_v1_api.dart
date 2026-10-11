// HttpV1Api — the real [V1Api] over the process-wide [HttpTransport].
//
// Every request carries `X-MasterSAT-Client: windows/<version>` and `Accept: application/json`;
// authenticated ones carry `Authorization: Bearer <access>`; writes that need one carry
// `Idempotency-Key`; midterm calls after the handshake carry `X-Lockdown-Session`.
//
// Status mapping (v1_api.dart):
//  * 2xx → parsed model (a model that fails to parse is a [NetworkError]: the answer is unusable);
//  * 304 on `home` → [HomeFetch.notModified];
//  * 401 on an authenticated call → ask [AccessTokenSource] to refresh ONCE, then resend the
//    identical request (same idempotency key — the 401 came from the auth layer, before the
//    view ran); a second 401 is an [ApiError];
//  * 426, or a lockdown refusal with reason `desktop_update_required` → [UpdateRequired];
//  * any other status ≥ 300 → [ApiError] with the parsed envelope and `Retry-After`.
import 'dart:convert';
import 'dart:typed_data';

import '../http/api_config.dart';
import '../http/http_transport.dart';
import '../models/models.dart';
import 'v1_api.dart';

/// What [AccessTokenSource.recoverFromUnauthorized] managed.
enum RecoverOutcome {
  /// A different, fresh access token is available: resend the request.
  retry,

  /// The refresh could not reach the server (or it failed transiently): the session is kept,
  /// and the caller gets a transient [NetworkError] to retry later.
  unreachable,

  /// The server definitely refused the refresh token: the session is over.
  denied,
}

/// Supplies the access token and recovers from a 401 (implemented by AuthController).
abstract class AccessTokenSource {
  /// The current access token, or null when signed out.
  String? get accessToken;

  /// Called after a 401 on a request sent with [usedAccess]. Refreshes at most once for any
  /// number of concurrent callers (a second refresh would present a token the first retired).
  Future<RecoverOutcome> recoverFromUnauthorized(String? usedAccess);
}

class HttpV1Api implements V1Api {
  HttpV1Api({required this.transport, required this.config, this.tokens, this.onUpdateRequired, this.onServerNow});

  final Transport transport;
  final ApiConfig config;

  /// Set after construction (AuthController itself calls [authRefresh] on this object).
  AccessTokenSource? tokens;

  /// Told about every [UpdateRequired] (any endpoint can answer 426), so the app can show the
  /// blocking update card wherever the student is.
  void Function(UpdateRequired)? onUpdateRequired;

  /// Told the server's `Date` header of every answer (feeds [ServerClock] for Home labels).
  void Function(DateTime serverNow)? onServerNow;

  // ------------------------------------------------------------------------------------------
  // Plumbing
  // ------------------------------------------------------------------------------------------

  Map<String, String> _headers({
    String? access,
    bool hasBody = false,
    String? idempotencyKey,
    String? lockdownSession,
    String? ifNoneMatch,
    String accept = 'application/json',
  }) =>
      {
        V1Headers.client: config.clientHeader,
        'Accept': accept,
        if (hasBody) 'Content-Type': 'application/json; charset=utf-8',
        if (access != null) 'Authorization': 'Bearer $access',
        V1Headers.idempotencyKey: ?idempotencyKey,
        V1Headers.lockdownSession: ?lockdownSession,
        V1Headers.ifNoneMatch: ?ifNoneMatch,
      };

  Future<TransportResponse> _send(
    String method,
    String path, {
    Object? body,
    bool auth = true,
    String? idempotencyKey,
    String? lockdownSession,
    String? ifNoneMatch,
    String accept = 'application/json',
    Duration? timeout,
    Set<int> okStatuses = const {},
  }) async {
    final bytes = body == null ? null : utf8.encode(jsonEncode(body));
    final deadline = timeout ?? (method == 'GET' ? config.readTimeout : config.writeTimeout);
    TransportRequest build(String? access) => TransportRequest(
          method: method,
          url: config.resolve(path),
          headers: _headers(
            access: access,
            hasBody: bytes != null,
            idempotencyKey: idempotencyKey,
            lockdownSession: lockdownSession,
            ifNoneMatch: ifNoneMatch,
            accept: accept,
          ),
          body: bytes,
          timeout: deadline,
        );

    final source = auth ? tokens : null;
    final used = source?.accessToken;
    var resp = await _deliver(build(used));
    if (resp.status == 401 && source != null && used != null) {
      // The 401 came from the auth layer, before any view ran, so resending the identical
      // request (same Idempotency-Key) after a refresh is safe.
      switch (await source.recoverFromUnauthorized(used)) {
        case RecoverOutcome.retry:
          resp = await _deliver(build(source.accessToken));
        case RecoverOutcome.unreachable:
          throw const NetworkError('Could not refresh the session.');
        case RecoverOutcome.denied:
          break; // the 401 below ends the call; AuthController has signed out
      }
    }
    final s = resp.status;
    if ((s >= 200 && s < 300) || okStatuses.contains(s)) return resp;
    final error = _errorFor(resp);
    if (error is UpdateRequired) onUpdateRequired?.call(error);
    throw error;
  }

  Future<TransportResponse> _deliver(TransportRequest request) async {
    final resp = await transport.send(request);
    final date = resp.header('date');
    final sink = onServerNow;
    if (date != null && sink != null) {
      try {
        sink(HttpDateParser.parse(date));
      } on FormatException {
        // An unparsable Date header is ignored.
      }
    }
    return resp;
  }

  ApiException _errorFor(TransportResponse resp) {
    final body = _errorBody(resp);
    if (resp.status == 426) return UpdateRequired.fromBody(body);
    if (resp.status == 403 && body.reason == 'desktop_update_required') return UpdateRequired.fromBody(body);
    return ApiError(status: resp.status, body: body, retryAfter: parseRetryAfter(resp.header('retry-after')));
  }

  static ApiErrorBody _errorBody(TransportResponse resp) {
    if (resp.body.isEmpty) return ApiErrorBody(detail: 'HTTP ${resp.status}');
    try {
      final decoded = jsonDecode(utf8.decode(resp.body));
      if (decoded is Map) return ApiErrorBody.fromJson(JsonReader.of(decoded));
      return ApiErrorBody(detail: decoded.toString());
    } on FormatException {
      final text = utf8.decode(resp.body, allowMalformed: true).trim();
      return ApiErrorBody(detail: text.length > 300 ? '${text.substring(0, 300)}…' : text);
    }
  }

  /// `Retry-After`: delta-seconds or an HTTP date.
  static Duration? parseRetryAfter(String? value, {DateTime? now}) {
    if (value == null) return null;
    final v = value.trim();
    final secs = int.tryParse(v);
    if (secs != null) return Duration(seconds: secs < 0 ? 0 : secs);
    try {
      final at = HttpDateParser.parse(v);
      final d = at.difference((now ?? DateTime.now()).toUtc());
      return d.isNegative ? Duration.zero : d;
    } on FormatException {
      return null;
    }
  }

  static T _parse<T>(TransportResponse resp, T Function(JsonReader r) parse) {
    try {
      final decoded = jsonDecode(utf8.decode(resp.body));
      return parse(JsonReader.of(decoded));
    } on FormatException catch (e) {
      throw NetworkError('The server sent an answer the app could not read.', cause: e);
    }
  }

  Future<T> _json<T>(
    String method,
    String path,
    T Function(JsonReader r) parse, {
    Object? body,
    bool auth = true,
    String? idempotencyKey,
    String? lockdownSession,
    Duration? timeout,
  }) async {
    final resp = await _send(
      method,
      path,
      body: body,
      auth: auth,
      idempotencyKey: idempotencyKey,
      lockdownSession: lockdownSession,
      timeout: timeout,
    );
    return _parse(resp, parse);
  }

  Future<Uint8List> _bytes(String path) async {
    final resp = await _send('GET', path, accept: 'application/pdf', timeout: config.longTimeout);
    return resp.body;
  }

  static const _emptyBody = <String, Object?>{};

  // ------------------------------------------------------------------------------------------
  // Auth
  // ------------------------------------------------------------------------------------------

  @override
  Future<AuthTokens> authExchange(AuthExchangeRequest body) =>
      _json('POST', V1Paths.authExchange, AuthTokens.fromJson, body: body.toJson(), auth: false);

  @override
  Future<AuthTokens> authRefresh(RefreshRequest body) => _json(
        'POST',
        V1Paths.authRefresh,
        AuthTokens.fromJson,
        body: body.toJson(),
        auth: false,
        timeout: config.refreshTimeout,
      );

  // ------------------------------------------------------------------------------------------
  // Home
  // ------------------------------------------------------------------------------------------

  @override
  Future<HomeFetch> home({String? ifNoneMatch}) async {
    final resp = await _send('GET', V1Paths.home, ifNoneMatch: ifNoneMatch, okStatuses: const {304});
    final etag = resp.header(V1Headers.etag);
    if (resp.status == 304) return HomeFetch.notModified(etag ?? ifNoneMatch);
    return HomeFetch.fresh(_parse(resp, HomeResponse.fromJson), etag);
  }

  // ------------------------------------------------------------------------------------------
  // Past papers
  // ------------------------------------------------------------------------------------------

  @override
  Future<ExamBundle> pastpaperOpen(int practiceTestId, PastpaperOpenRequest body) => _json(
        'POST',
        V1Paths.pastpaperOpen(practiceTestId),
        ExamBundle.fromJson,
        body: body.toJson(),
        timeout: config.longTimeout,
      );

  @override
  Future<AttemptEnvelope> pastpaperStart(int attemptId, {required String idempotencyKey}) => _json(
        'POST',
        V1Paths.pastpaperStart(attemptId),
        AttemptEnvelope.fromJson,
        body: _emptyBody,
        idempotencyKey: idempotencyKey,
      );

  @override
  Future<WriteOutcome> pastpaperSync(int attemptId, SyncRequest body, {required String idempotencyKey}) => _json(
        'POST',
        V1Paths.pastpaperSync(attemptId),
        WriteOutcome.fromJson,
        body: body.toJson(),
        idempotencyKey: idempotencyKey,
      );

  @override
  Future<SubmitOutcome> pastpaperSubmit(int attemptId, SyncRequest body, {required String idempotencyKey}) => _json(
        'POST',
        V1Paths.pastpaperSubmit(attemptId),
        SubmitOutcome.fromJson,
        body: body.toJson(),
        idempotencyKey: idempotencyKey,
      );

  @override
  Future<AttemptEnvelope> pastpaperPause(int attemptId) =>
      _json('POST', V1Paths.pastpaperPause(attemptId), AttemptEnvelope.fromJson, body: _emptyBody);

  @override
  Future<AttemptEnvelope> pastpaperResume(int attemptId) =>
      _json('POST', V1Paths.pastpaperResume(attemptId), AttemptEnvelope.fromJson, body: _emptyBody);

  @override
  Future<PastpaperResult> pastpaperResult(int attemptId, {Map<int, String> have = const {}}) => _json(
        'GET',
        V1Paths.pastpaperResult(attemptId, have),
        PastpaperResult.fromJson,
        timeout: config.longTimeout,
      );

  // ------------------------------------------------------------------------------------------
  // Midterms
  // ------------------------------------------------------------------------------------------

  @override
  Future<MidtermPrepareResponse> midtermPrepare(int midtermId, MidtermPrepareRequest body) =>
      _json('POST', V1Paths.midtermPrepare(midtermId), MidtermPrepareResponse.fromJson, body: body.toJson());

  @override
  Future<LockdownChallenge> midtermChallenge(int attemptId) =>
      _json('POST', V1Paths.midtermChallenge(attemptId), LockdownChallenge.fromJson, body: _emptyBody);

  @override
  Future<LockdownSession> midtermSession(int attemptId, LockdownSessionRequest body) =>
      _json('POST', V1Paths.midtermSession(attemptId), LockdownSession.fromJson, body: body.toJson());

  @override
  Future<ExamBundle> midtermOpen(int attemptId, MidtermOpenRequest body, {required String lockdownSession}) => _json(
        'POST',
        V1Paths.midtermOpen(attemptId),
        ExamBundle.fromJson,
        body: body.toJson(),
        lockdownSession: lockdownSession,
        timeout: config.longTimeout,
      );

  @override
  Future<WriteOutcome> midtermSync(
    int attemptId,
    SyncRequest body, {
    required String lockdownSession,
    required String idempotencyKey,
  }) =>
      _json(
        'POST',
        V1Paths.midtermSync(attemptId),
        WriteOutcome.fromJson,
        body: body.toJson(),
        lockdownSession: lockdownSession,
        idempotencyKey: idempotencyKey,
      );

  @override
  Future<SubmitOutcome> midtermSubmit(
    int attemptId,
    SyncRequest body, {
    required String lockdownSession,
    required String idempotencyKey,
  }) =>
      _json(
        'POST',
        V1Paths.midtermSubmit(attemptId),
        SubmitOutcome.fromJson,
        body: body.toJson(),
        lockdownSession: lockdownSession,
        idempotencyKey: idempotencyKey,
        timeout: config.longTimeout,
      );

  @override
  Future<OffscreenOutcome> midtermOffscreen(
    int attemptId,
    OffscreenRequest body, {
    required String lockdownSession,
    required String idempotencyKey,
  }) =>
      _json(
        'POST',
        V1Paths.midtermOffscreen(attemptId),
        OffscreenOutcome.fromJson,
        body: body.toJson(),
        lockdownSession: lockdownSession,
        idempotencyKey: idempotencyKey,
      );

  @override
  Future<MidtermResult> midtermResult(int attemptId) =>
      _json('GET', V1Paths.midtermResult(attemptId), MidtermResult.fromJson, timeout: config.longTimeout);

  // ------------------------------------------------------------------------------------------
  // Media, low-priority lane, documents
  // ------------------------------------------------------------------------------------------

  @override
  Future<MediaResponse> media(AttemptKind kind, int attemptId, {String? lockdownSession}) =>
      _json('GET', V1Paths.media(kind, attemptId), MediaResponse.fromJson, lockdownSession: lockdownSession);

  @override
  Future<void> annotationWrite(AnnotationWriteRequest body) async {
    await _send('PUT', V1Paths.annotationWrite, body: body.toJson());
  }

  @override
  Future<QuestionReportResponse> questionReport(QuestionReportRequest body, {required String idempotencyKey}) =>
      _json(
        'POST',
        V1Paths.questionReport,
        QuestionReportResponse.fromJson,
        body: body.toJson(),
        idempotencyKey: idempotencyKey,
      );

  @override
  Future<Uint8List> pastpaperReportPdf(int attemptId) => _bytes(V1Paths.pastpaperReportPdf(attemptId));

  @override
  Future<Uint8List> pastpaperCertificatePdf(int attemptId) => _bytes(V1Paths.pastpaperCertificatePdf(attemptId));

  @override
  Future<Uint8List> midtermErrorReportPdf(int attemptId) => _bytes(V1Paths.midtermErrorReportPdf(attemptId));

  @override
  Future<Uint8List> midtermCertificatePdf(String code) => _bytes(V1Paths.midtermCertificatePdf(code));
}

/// RFC 7231 IMF-fixdate parsing for `Retry-After`.
abstract final class HttpDateParser {
  static const _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /// `Sun, 06 Nov 1994 08:49:37 GMT`.
  static DateTime parse(String s) {
    final m = RegExp(r'^\w{3}, (\d{2}) (\w{3}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$').firstMatch(s.trim());
    if (m == null) throw FormatException('Not an HTTP date', s);
    final month = _months.indexOf(m.group(2)!) + 1;
    if (month == 0) throw FormatException('Bad month', s);
    return DateTime.utc(
      int.parse(m.group(3)!),
      month,
      int.parse(m.group(1)!),
      int.parse(m.group(4)!),
      int.parse(m.group(5)!),
      int.parse(m.group(6)!),
    );
  }
}
