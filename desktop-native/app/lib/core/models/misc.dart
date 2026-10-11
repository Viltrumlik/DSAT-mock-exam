// Existing endpoints the app uses as they are (architecture §4.3-C), the media re-sign
// endpoint, and the error envelope.
import 'attempt.dart';
import 'content.dart';
import 'json.dart';

/// `POST /api/desktop/auth/exchange/` body (PKCE hand-off from the browser).
class AuthExchangeRequest {
  const AuthExchangeRequest({required this.code, required this.verifier});

  factory AuthExchangeRequest.fromJson(JsonReader r) =>
      AuthExchangeRequest(code: r.string('code'), verifier: r.string('verifier'));

  final String code;
  final String verifier;

  Map<String, Object?> toJson() => {'code': code, 'verifier': verifier};
}

/// Tokens in the body (exchange: with `ok:true`; refresh: rotated pair).
class AuthTokens {
  const AuthTokens({this.ok, required this.access, required this.refresh});

  factory AuthTokens.fromJson(JsonReader r) =>
      AuthTokens(ok: r.booleanOrNull('ok'), access: r.string('access'), refresh: r.string('refresh'));

  /// Present (true) on exchange only.
  final bool? ok;
  final String access;
  final String refresh;

  Map<String, Object?> toJson() => {if (ok != null) 'ok': ok, 'access': access, 'refresh': refresh};
}

/// `POST /api/auth/refresh/` body. Never cut a refresh short: the server rotates inside it.
class RefreshRequest {
  const RefreshRequest({required this.refresh});

  factory RefreshRequest.fromJson(JsonReader r) => RefreshRequest(refresh: r.string('refresh'));

  final String refresh;

  Map<String, Object?> toJson() => {'refresh': refresh};
}

/// `POST /api/midterms/attempts/{id}/desktop_challenge/` → one-time nonce (60 s).
class LockdownChallenge {
  const LockdownChallenge({required this.nonce, required this.expiresIn});

  factory LockdownChallenge.fromJson(JsonReader r) =>
      LockdownChallenge(nonce: r.string('nonce'), expiresIn: r.integer('expires_in'));

  final String nonce;

  /// Seconds.
  final int expiresIn;

  Map<String, Object?> toJson() => {'nonce': nonce, 'expires_in': expiresIn};
}

/// `POST /api/midterms/attempts/{id}/desktop_session/` body — the signed proof.
class LockdownSessionRequest {
  const LockdownSessionRequest({
    required this.nonce,
    required this.keyId,
    required this.mac,
    required this.appVersion,
    required this.precheck,
  });

  factory LockdownSessionRequest.fromJson(JsonReader r) => LockdownSessionRequest(
        nonce: r.string('nonce'),
        keyId: r.string('key_id'),
        mac: r.string('mac'),
        appVersion: r.string('app_version'),
        precheck: r.string('precheck'),
      );

  final String nonce;
  final String keyId;

  /// HMAC-SHA256 hex from `ms_prove`.
  final String mac;
  final String appVersion;

  /// `ms_precheck_json()` VERBATIM — the MAC covers these exact bytes; never re-serialise.
  final String precheck;

  Map<String, Object?> toJson() =>
      {'nonce': nonce, 'key_id': keyId, 'mac': mac, 'app_version': appVersion, 'precheck': precheck};
}

/// The session token every midterm call then sends as `X-Lockdown-Session` (memory only).
class LockdownSession {
  const LockdownSession({required this.lockdownSession, required this.required});

  factory LockdownSession.fromJson(JsonReader r) =>
      LockdownSession(lockdownSession: r.string('lockdown_session'), required: r.boolean('required'));

  final String lockdownSession;
  final bool required;

  Map<String, Object?> toJson() => {'lockdown_session': lockdownSession, 'required': required};
}

/// `PUT /api/annotations/write/` body → 204. Past papers: ref = `"<attempt_id>"`; midterms: `"mt-<id>"`.
class AnnotationWriteRequest {
  const AnnotationWriteRequest({
    this.scope = 'exam',
    required this.ref,
    required this.targetId,
    required this.container,
    required this.data,
  });

  factory AnnotationWriteRequest.fromJson(JsonReader r) => AnnotationWriteRequest(
        scope: r.string('scope'),
        ref: r.string('ref'),
        targetId: r.integer('target_id'),
        container: AnnotationContainer.fromWire(r.string('container'), '${r.path}.container'),
        data: r.objects('data', Annotation.fromJson),
      );

  static String refFor(AttemptKind kind, int attemptId) =>
      kind == AttemptKind.midterm ? 'mt-$attemptId' : '$attemptId';

  final String scope;
  final String ref;
  final int targetId;
  final AnnotationContainer container;
  final List<Annotation> data;

  Map<String, Object?> toJson() => {
        'scope': scope,
        'ref': ref,
        'target_id': targetId,
        'container': container.wire,
        'data': data.map((a) => a.toJson()).toList(),
      };
}

/// Report-a-problem categories (website ReportProblemModal).
enum ReportCategory {
  wrongAnswer('wrong_answer'),
  answerKey('answer_key'),
  typoUnclear('typo_unclear'),
  imageFigure('image_figure'),
  other('other');

  const ReportCategory(this.wire);
  final String wire;
  static ReportCategory fromWire(String s, [String path = r'$']) => enumFromWire(values, s, (v) => v.wire, path);
}

/// `POST /api/question-reports/reports/` body.
class QuestionReportRequest {
  const QuestionReportRequest({
    this.system = 'exam',
    required this.questionId,
    required this.category,
    required this.message,
    this.attemptId,
  });

  factory QuestionReportRequest.fromJson(JsonReader r) => QuestionReportRequest(
        system: r.string('system'),
        questionId: r.integer('question_id'),
        category: ReportCategory.fromWire(r.string('category'), '${r.path}.category'),
        message: r.string('message'),
        attemptId: r.integerOrNull('attempt_id'),
      );

  final String system;
  final int questionId;
  final ReportCategory category;
  final String message;
  final int? attemptId;

  Map<String, Object?> toJson() => {
        'system': system,
        'question_id': questionId,
        'category': category.wire,
        'message': message,
        'attempt_id': attemptId,
      };
}

/// 201 `{id, status}` or 200 `{id, deduped:true}`.
class QuestionReportResponse {
  const QuestionReportResponse({required this.id, this.status, this.deduped = false});

  factory QuestionReportResponse.fromJson(JsonReader r) => QuestionReportResponse(
        id: r.integer('id'),
        status: r.stringOrNull('status'),
        deduped: r.booleanOrNull('deduped') ?? false,
      );

  final int id;
  final String? status;
  final bool deduped;

  Map<String, Object?> toJson() => {'id': id, if (status != null) 'status': status, if (deduped) 'deduped': true};
}

/// `GET attempts/{pastpaper|midterm}/{id}/media` — fresh signed URLs for that attempt only.
class MediaResponse {
  const MediaResponse({this.schema = 1, required this.attemptId, required this.kind, required this.media});

  factory MediaResponse.fromJson(JsonReader r) => MediaResponse(
        schema: r.integer('schema'),
        attemptId: r.integer('attempt_id'),
        kind: AttemptKind.fromWire(r.string('kind'), '${r.path}.kind'),
        media: r.objects('media', MediaRef.fromJson),
      );

  final int schema;
  final int attemptId;
  final AttemptKind kind;
  final List<MediaRef> media;

  Map<String, Object?> toJson() =>
      {'schema': schema, 'attempt_id': attemptId, 'kind': kind.wire, 'media': media.map((m) => m.toJson()).toList()};
}

/// The error envelope: `{"code": "...", "detail": "...", ...}`. Lockdown refusals keep their
/// legacy shape (`reason`, `desktop_required`, no `code`); DRF 429s carry only `detail`.
/// Unknown keys are preserved in [extra] so nothing is lost.
class ApiErrorBody {
  const ApiErrorBody({
    this.code,
    this.detail,
    this.reason,
    this.desktopRequired,
    this.retryAfterMs,
    this.attempt,
    this.minimumVersion,
    this.latestVersion,
    this.updateUrl,
    this.extra = const {},
  });

  static const _known = {
    'code',
    'detail',
    'reason',
    'desktop_required',
    'retry_after_ms',
    'attempt',
    'minimum_version',
    'latest_version',
    'update_url',
  };

  factory ApiErrorBody.fromJson(JsonReader r) => ApiErrorBody(
        code: r.stringOrNull('code'),
        detail: r.stringOrNull('detail'),
        reason: r.stringOrNull('reason'),
        desktopRequired: r.booleanOrNull('desktop_required'),
        retryAfterMs: r.integerOrNull('retry_after_ms'),
        attempt: r.objectOrNull('attempt')?.let(AttemptLite.fromJson),
        minimumVersion: r.stringOrNull('minimum_version'),
        latestVersion: r.stringOrNull('latest_version'),
        updateUrl: r.stringOrNull('update_url'),
        extra: {for (final e in r.json.entries) if (!_known.contains(e.key)) e.key: e.value},
      );

  /// e.g. `module_not_expired`, `code_incorrect`, `not_visible`, `update_required`, `token_not_valid`.
  final String? code;
  final String? detail;

  /// Lockdown refusal reason (`desktop_session_replaced`, `desktop_required`, …).
  final String? reason;
  final bool? desktopRequired;

  /// 409 `module_not_expired`: retry after this many ms (+250).
  final int? retryAfterMs;

  /// 409s carry the current AttemptLite.
  final AttemptLite? attempt;
  final String? minimumVersion;
  final String? latestVersion;
  final String? updateUrl;
  final Map<String, Object?> extra;

  /// The best machine-readable discriminator: `code`, else the lockdown `reason`.
  String? get kind => code ?? reason;

  Map<String, Object?> toJson() => {
        if (detail != null) 'detail': detail,
        if (code != null) 'code': code,
        if (reason != null) 'reason': reason,
        if (desktopRequired != null) 'desktop_required': desktopRequired,
        if (retryAfterMs != null) 'retry_after_ms': retryAfterMs,
        if (attempt != null) 'attempt': attempt!.toJson(),
        if (minimumVersion != null) 'minimum_version': minimumVersion,
        if (latestVersion != null) 'latest_version': latestVersion,
        if (updateUrl != null) 'update_url': updateUrl,
        ...extra,
      };
}
