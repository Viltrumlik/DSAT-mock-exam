// FixtureV1Api — an in-memory server built from desktop-native/contracts/v1, for tests and
// offline development (`flutter run -d macos` with no network). It keeps simple state so
// whole flows work: open → start → sync → submit(M1) → submit(M2) → result (scoring, then
// completed), pause/resume, and the midterm prepare → challenge → session → open → sync →
// submit (409 until the deadline) → offscreen → result handshake.
//
// Every response is built as JSON and parsed through the real models, so a response this
// fake can produce is a response the client can parse.
import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';

import '../models/models.dart';
import 'fixtures/v1_fixtures.g.dart';
import 'v1_api.dart';

/// One recorded call (for assertions in tests).
class FixtureCall {
  const FixtureCall(this.method, this.args);
  final String method;
  final Map<String, Object?> args;

  @override
  String toString() => 'FixtureCall($method, $args)';
}

/// The teacher code the fixture midterm accepts.
const fixtureMidtermCode = '482913';

class FixtureV1Api implements V1Api {
  FixtureV1Api({
    DateTime Function()? now,
    this.scoringPolls = 1,
    this.latency = Duration.zero,
    this.requireLockdownToken = true,
  }) : _now = now ?? (() => DateTime.now().toUtc());

  final DateTime Function() _now;

  /// How many `result` calls answer SCORING before the attempt is COMPLETED.
  int scoringPolls;

  /// Artificial delay before every answer (zero = next microtask).
  Duration latency;

  /// Midterm calls check `X-Lockdown-Session` like `MIDTERM_DESKTOP_REQUIRED=True`.
  bool requireLockdownToken;

  /// When true every call fails with [NetworkError] (simulates no connection).
  bool offline = false;

  final List<FixtureCall> calls = [];
  final List<ApiException> _failQueue = [];

  /// The next call(s) fail with these errors, in order, before any state change.
  void failNext(ApiException error) => _failQueue.add(error);

  // ------------------------------------------------------------------------------------------
  // Fixture access
  // ------------------------------------------------------------------------------------------

  static Map<String, Object?> fixture(String file) {
    final text = v1FixtureFiles[file];
    if (text == null) throw ArgumentError('No fixture $file');
    return (jsonDecode(text) as Map).cast<String, Object?>();
  }

  static Uint8List? fixtureMedia(String key) {
    final b64 = v1FixtureMediaBase64[key];
    return b64 == null ? null : base64Decode(b64);
  }

  static Map<String, Object?> _copy(Map<String, Object?> m) =>
      (jsonDecode(jsonEncode(m)) as Map).cast<String, Object?>();

  // ------------------------------------------------------------------------------------------
  // State
  // ------------------------------------------------------------------------------------------

  final Map<int, _Attempt> _attempts = {};
  final Map<String, Map<String, Object?>> _idem = {}; // "<kind>.<attempt>.<key>" → outcome json
  final Map<String, List<Map<String, Object?>>> _annotations = {};
  final Map<String, int> _reportsByKey = {};
  final Map<String, int> _reportsByQuestion = {};
  int _nextReportId = 311;
  int _nextAttemptId = 9200;
  int _tokenSerial = 0;
  String _currentRefresh = 'eyJhbGciOiJIUzI1NiJ9.fixture-refresh.sig';

  /// Server-side state of an attempt (tests).
  AttemptState? stateOf(int attemptId) => _attempts[attemptId]?.state;

  /// The answers the server holds for a module (tests).
  Map<int, String> serverAnswers(int attemptId, int moduleId) =>
      Map.unmodifiable(_attempts[attemptId]?.answers[moduleId] ?? const <int, String>{});

  /// The flags the server holds for a module (tests).
  Set<int> serverFlags(int attemptId, int moduleId) =>
      Set.unmodifiable(_attempts[attemptId]?.flagged[moduleId] ?? const <int>{});

  /// Annotation rows written through [annotationWrite], by `ref/target/container`.
  Map<String, List<Map<String, Object?>>> get writtenAnnotations => Map.unmodifiable(_annotations);

  // ------------------------------------------------------------------------------------------
  // Plumbing
  // ------------------------------------------------------------------------------------------

  Future<T> _call<T>(String method, Map<String, Object?> args, T Function() body) async {
    calls.add(FixtureCall(method, args));
    if (latency > Duration.zero) {
      await Future<void>.delayed(latency);
    } else {
      await Future<void>.value();
    }
    if (offline) throw const NetworkError('offline (fixture)');
    if (_failQueue.isNotEmpty) throw _failQueue.removeAt(0);
    return body();
  }

  DateTime get now => _now().toUtc();

  Never _error(int status, Map<String, Object?> body) {
    final parsed = ApiErrorBody.fromJson(JsonReader.of(body));
    if (status == 426) throw UpdateRequired.fromBody(parsed);
    throw ApiError(status: status, body: parsed);
  }

  Never _notVisible() => _error(404, {'code': 'not_visible', 'detail': 'This test is not available to you.'});

  _Attempt _attempt(int id, AttemptKind kind) {
    final a = _attempts[id];
    if (a == null || a.kind != kind) _notVisible();
    return a;
  }

  Map<String, Object?> _media(Iterable<String> keys, Duration ttl) {
    final out = <Map<String, Object?>>[];
    final issued = now;
    for (final k in keys) {
      out.add({
        'key': k,
        'url': 'https://r2.fixtures.invalid/mastersat-media/$k?X-Amz-Expires=${ttl.inSeconds}'
            '&X-Amz-Date=${issued.millisecondsSinceEpoch}',
        'expires_at': formatTimestamp(issued.add(ttl)),
      });
    }
    return {'media': out};
  }

  static const _pastpaperTtl = Duration(hours: 6);
  static const _midtermTtl = Duration(minutes: 15);

  Map<String, Object?> _lite(_Attempt a) {
    final t = now;
    final finished = a.state.isFinished;
    int? remaining;
    DateTime? deadline;
    if (!finished) {
      if (a.state == AttemptState.notStarted) {
        remaining = a.durationsMs[0];
      } else if (a.paused) {
        remaining = a.pausedRemainingMs;
      } else if (a.deadline != null) {
        deadline = a.deadline;
        final left = a.deadline!.difference(t).inMilliseconds;
        remaining = left < 0 ? 0 : left;
      }
    }
    return {
      'id': a.id,
      'kind': a.kind.wire,
      'ref_id': a.refId,
      'state': a.state.wire,
      'version': a.version,
      'module': finished
          ? null
          : {'id': a.moduleIds[a.index], 'order': a.index + 1, 'duration_ms': a.durationsMs[a.index]},
      'module_ids': a.moduleIds,
      'timing': {
        'server_now': formatTimestamp(t),
        'deadline_at': formatTimestampOrNull(deadline),
        'remaining_ms': remaining,
        'paused': a.paused,
      },
      'results_ready': a.state == AttemptState.completed,
      'score': a.kind == AttemptKind.pastpaper ? a.score : null,
      'midterm': a.kind == AttemptKind.midterm
          ? {
              'offscreen_violations': a.violations,
              'offscreen_limit': 3,
              'offscreen_grace_seconds': 3,
              'terminated_reason': a.terminatedReason,
              'desktop_required': true,
              'late_grace_seconds': 300,
            }
          : null,
    };
  }

  /// Runs [compute] once per idempotency key; a replay returns the stored outcome with a
  /// FRESH attempt (the v1 idempotency rule).
  Map<String, Object?> _idempotent(_Attempt a, String key, Map<String, Object?> Function() compute) {
    final scoped = '${a.kind.wire}.${a.id}.$key';
    final stored = _idem[scoped] ?? (_idem[scoped] = compute());
    return {...stored, 'schema': 1, 'attempt': _lite(a)};
  }

  void _merge(_Attempt a, int moduleId, Map<int, String> answers, List<int> flagged) {
    final target = a.answers.putIfAbsent(moduleId, () => {});
    answers.forEach((qid, v) {
      if (v.isEmpty) {
        target.remove(qid);
      } else {
        target[qid] = v;
      }
    });
    a.flagged[moduleId] = flagged.toSet();
    a.version++;
  }

  // ------------------------------------------------------------------------------------------
  // Auth
  // ------------------------------------------------------------------------------------------

  /// The login the fixture answers 403 `password_not_set` (an lc-up account on its first
  /// phone + four digits sign-in).
  static const passwordNotSetLogin = 'nopass';

  /// The password the fixture refuses (401); any other non-empty one signs in.
  static const wrongPassword = 'wrong';

  /// Any non-empty login signs in with any password but [wrongPassword]; [passwordNotSetLogin]
  /// is refused as the server refuses an lc-up claim. The password is never recorded in [calls].
  @override
  Future<AuthTokens> authLogin(AuthLoginRequest body) => _call('authLogin', {'identifier': body.identifier}, () {
        if (body.identifier.trim().isEmpty || body.password.isEmpty || body.password == wrongPassword) {
          _error(401, fixture('auth_login.response.invalid.json'));
        }
        if (body.identifier.trim().toLowerCase() == passwordNotSetLogin) {
          _error(403, fixture('auth_login.response.password_not_set.json'));
        }
        final json = fixture('auth_login.response.json');
        _currentRefresh = json['refresh']! as String;
        return AuthTokens.fromJson(JsonReader.of(json));
      });

  @override
  Future<AuthTokens> authRefresh(RefreshRequest body) => _call('authRefresh', body.toJson(), () {
        if (body.refresh != _currentRefresh) _error(401, fixture('error.401.json'));
        _tokenSerial++;
        _currentRefresh = 'eyJhbGciOiJIUzI1NiJ9.fixture-refresh-r$_tokenSerial.sig';
        return AuthTokens(access: 'eyJhbGciOiJIUzI1NiJ9.fixture-access-r$_tokenSerial.sig', refresh: _currentRefresh);
      });

  // ------------------------------------------------------------------------------------------
  // Home
  // ------------------------------------------------------------------------------------------

  @override
  Future<HomeFetch> home({String? ifNoneMatch}) => _call('home', {'if_none_match': ifNoneMatch}, () {
        final json = _copy(fixture('home.response.json'));
        final rows = (json['pastpapers']! as List).cast<Map<String, Object?>>();
        for (final row in rows) {
          final paperId = row['id']! as int;
          final mine = _attempts.values.where((a) => a.kind == AttemptKind.pastpaper && a.refId == paperId).toList()
            ..sort((x, y) => x.id.compareTo(y.id));
          if (mine.isEmpty) continue;
          final state = (row['state']! as Map).cast<String, Object?>();
          final history = (row['history']! as List).cast<Map<String, Object?>>();
          final open = mine.lastWhere((a) => !a.state.isFinished, orElse: () => mine.first);
          for (final a in mine.where((a) => a.state == AttemptState.completed)) {
            history.insert(0, {
              'attempt_id': a.id,
              'score': a.score,
              'completed_at': formatTimestampOrNull(a.completedAt),
            });
          }
          final completed = mine.where((a) => a.state == AttemptState.completed).toList();
          if (!open.state.isFinished) {
            state['status'] = 'progress';
            state['open_attempt_id'] = open.id;
            state['open_state'] = open.state.wire;
          } else {
            state['status'] = completed.isEmpty ? state['status'] : 'completed';
            state['open_attempt_id'] = null;
            state['open_state'] = null;
          }
          if (completed.isNotEmpty) {
            final last = completed.last;
            state['last_attempt_id'] = last.id;
            state['last_score'] = last.score;
            state['last_completed_at'] = formatTimestampOrNull(last.completedAt);
            state['sittings'] = (state['sittings']! as int) + completed.length;
          }
        }
        for (final row in (json['midterms']! as List).cast<Map<String, Object?>>()) {
          final a = _attempts.values
              .where((a) => a.kind == AttemptKind.midterm && a.refId == row['midterm_id'])
              .fold<_Attempt?>(null, (prev, a) => a);
          if (a == null) continue;
          row['attempt_id'] = a.id;
          row['state'] = a.state.wire;
          row['submitted'] = a.state.isFinished;
        }
        json['server_now'] = formatTimestamp(now);
        final etag = '"sha256:${sha256.convert(utf8.encode(jsonEncode(json..remove('server_now'))))}"';
        json['server_now'] = formatTimestamp(now);
        if (ifNoneMatch != null && ifNoneMatch == etag) return HomeFetch.notModified(etag);
        return HomeFetch.fresh(HomeResponse.fromJson(JsonReader.of(json)), etag);
      });

  // ------------------------------------------------------------------------------------------
  // Past papers
  // ------------------------------------------------------------------------------------------

  static const _pastpaperSources = {52: 'pastpaper_open.response.json', 51: 'pastpaper_open.response.resume.json'};

  _Attempt _newPastpaper(int practiceTestId) {
    final file = _pastpaperSources[practiceTestId];
    if (file == null) _notVisible();
    final src = fixture(file);
    final lite = (src['attempt']! as Map).cast<String, Object?>();
    final modules = (src['modules']! as List).cast<Map<String, Object?>>();
    final reuseId = lite['id']! as int;
    final id = _attempts.containsKey(reuseId) ? _nextAttemptId++ : reuseId;
    final a = _Attempt(
      id: id,
      kind: AttemptKind.pastpaper,
      refId: practiceTestId,
      moduleIds: [for (final m in modules) m['id']! as int],
      durationsMs: [for (final m in modules) (m['time_limit_minutes']! as int) * 60000],
      source: src,
    );
    final state = AttemptState.fromWire(lite['state']! as String);
    if (state.isActive && id == reuseId) {
      // Resume fixture: keep its saved answers/flags/annotations and its remaining time.
      a.state = state;
      a.index = (lite['module']! as Map)['order']! as int == 2 ? 1 : 0;
      final remaining = ((lite['timing']! as Map)['remaining_ms'] as int?) ?? a.durationsMs[a.index];
      a.deadline = now.add(Duration(milliseconds: remaining));
      a.version = lite['version']! as int;
      final answers = (src['answers']! as Map).cast<String, Object?>();
      answers.forEach((mid, m) {
        a.answers[int.parse(mid)] = {
          for (final e in (m! as Map).cast<String, Object?>().entries) int.parse(e.key): e.value! as String,
        };
      });
      final flagged = (src['flagged']! as Map).cast<String, Object?>();
      flagged.forEach((mid, l) => a.flagged[int.parse(mid)] = (l! as List).cast<int>().toSet());
      a.annotations = (src['annotations']! as List).cast<Map<String, Object?>>();
    }
    _attempts[id] = a;
    return a;
  }

  void _startModule(_Attempt a, int index, [DateTime? anchor]) {
    a.index = index;
    a.state = index == 0 ? AttemptState.module1Active : AttemptState.module2Active;
    a.deadline = (anchor ?? now).add(Duration(milliseconds: a.durationsMs[index]));
    a.paused = false;
    a.pausedRemainingMs = null;
    a.version++;
  }

  Map<String, Object?> _bundle(_Attempt a, Map<int, String> have, {required bool liveOnly}) {
    final src = a.source;
    final modules = <Map<String, Object?>>[];
    final mediaKeys = <String>[];
    for (final m in a.moduleContent()) {
      final mid = m['id']! as int;
      if (liveOnly && mid != a.moduleIds[a.index]) continue;
      final copy = _copy(m);
      final qs = (m['questions'] as List?)?.cast<Map<String, Object?>>() ?? const [];
      for (final q in qs) {
        if (q['question_image_key'] != null) mediaKeys.add(q['question_image_key']! as String);
        final opts = (q['options'] as Map?)?.cast<String, Object?>();
        for (final o in opts?.values ?? const <Object?>[]) {
          final k = (o! as Map)['image_key'];
          if (k != null) mediaKeys.add(k as String);
        }
      }
      if (have[mid] != null && have[mid] == m['content_hash']) {
        copy['unchanged'] = true;
        copy['questions'] = null;
      }
      modules.add(copy);
    }
    return {
      'schema': 1,
      'attempt': _lite(a),
      'test': src['test'],
      'modules': modules,
      'answers': {
        for (final m in modules)
          '${m['id']}': {for (final e in (a.answers[m['id']] ?? const {}).entries) '${e.key}': e.value},
      },
      'flagged': {
        for (final m in modules) '${m['id']}': (a.flagged[m['id']] ?? const <int>{}).toList()..sort(),
      },
      ..._media(mediaKeys, liveOnly ? _midtermTtl : _pastpaperTtl),
      'annotations': a.annotations,
    };
  }

  @override
  Future<ExamBundle> pastpaperOpen(int practiceTestId, PastpaperOpenRequest body) =>
      _call('pastpaperOpen', {'practice_test_id': practiceTestId, ...body.toJson()}, () {
        final existing = _attempts.values
            .where((a) => a.kind == AttemptKind.pastpaper && a.refId == practiceTestId && !a.state.isFinished)
            .toList();
        final a = existing.isNotEmpty ? existing.last : _newPastpaper(practiceTestId);
        if (body.start && a.state == AttemptState.notStarted) _startModule(a, 0);
        return ExamBundle.fromJson(JsonReader.of(_bundle(a, body.have, liveOnly: false)));
      });

  @override
  Future<AttemptEnvelope> pastpaperStart(int attemptId, {required String idempotencyKey}) =>
      _call('pastpaperStart', {'attempt_id': attemptId, 'key': idempotencyKey}, () {
        final a = _attempt(attemptId, AttemptKind.pastpaper);
        final out = _idempotent(a, idempotencyKey, () {
          if (a.state == AttemptState.notStarted) _startModule(a, 0);
          return {};
        });
        return AttemptEnvelope.fromJson(JsonReader.of({'schema': 1, 'attempt': out['attempt']}));
      });

  @override
  Future<WriteOutcome> pastpaperSync(int attemptId, SyncRequest body, {required String idempotencyKey}) =>
      _call('pastpaperSync', {'attempt_id': attemptId, 'key': idempotencyKey, ...body.toJson()}, () {
        final a = _attempt(attemptId, AttemptKind.pastpaper);
        final out = _idempotent(a, idempotencyKey, () {
          if (a.state.isActive && a.moduleIds[a.index] == body.moduleId) {
            _merge(a, body.moduleId, body.answers, body.flagged);
            return {'applied': true, 'reason': null};
          }
          return {'applied': false, 'reason': 'module_not_active'};
        });
        return WriteOutcome.fromJson(JsonReader.of(out));
      });

  @override
  Future<SubmitOutcome> pastpaperSubmit(int attemptId, SyncRequest body, {required String idempotencyKey}) =>
      _call('pastpaperSubmit', {'attempt_id': attemptId, 'key': idempotencyKey, ...body.toJson()}, () {
        final a = _attempt(attemptId, AttemptKind.pastpaper);
        final out = _idempotent(a, idempotencyKey, () {
          if (!(a.state.isActive && a.moduleIds[a.index] == body.moduleId)) {
            return {
              'applied': false,
              'reason': 'module_not_active',
              'transitioned_to': null,
              'next_module': null,
              'media': <Object?>[],
              'result': null,
            };
          }
          _merge(a, body.moduleId, body.answers, body.flagged);
          if (a.index == 0) {
            _startModule(a, 1);
            return {
              'applied': true,
              'reason': null,
              'transitioned_to': AttemptState.module2Active.wire,
              'next_module': null,
              'media': <Object?>[],
              'result': null,
            };
          }
          a.state = AttemptState.scoring;
          a.deadline = null;
          a.resultPolls = 0;
          a.version++;
          return {
            'applied': true,
            'reason': null,
            'transitioned_to': AttemptState.scoring.wire,
            'next_module': null,
            'media': <Object?>[],
            'result': {'poll_after_ms': 2000},
          };
        });
        return SubmitOutcome.fromJson(JsonReader.of(out));
      });

  @override
  Future<AttemptEnvelope> pastpaperPause(int attemptId) => _call('pastpaperPause', {'attempt_id': attemptId}, () {
        final a = _attempt(attemptId, AttemptKind.pastpaper);
        if (!a.state.isActive) _stateConflict(a);
        if (!a.paused) {
          final left = a.deadline!.difference(now).inMilliseconds;
          a.pausedRemainingMs = left < 0 ? 0 : left;
          a.paused = true;
          a.deadline = null;
          a.version++;
        }
        return AttemptEnvelope.fromJson(JsonReader.of({'schema': 1, 'attempt': _lite(a)}));
      });

  @override
  Future<AttemptEnvelope> pastpaperResume(int attemptId) => _call('pastpaperResume', {'attempt_id': attemptId}, () {
        final a = _attempt(attemptId, AttemptKind.pastpaper);
        if (!a.state.isActive) _stateConflict(a);
        if (a.paused) {
          a.deadline = now.add(Duration(milliseconds: a.pausedRemainingMs ?? 0));
          a.paused = false;
          a.pausedRemainingMs = null;
          a.version++;
        }
        return AttemptEnvelope.fromJson(JsonReader.of({'schema': 1, 'attempt': _lite(a)}));
      });

  Never _stateConflict(_Attempt a) => _error(409, {
        'code': 'state_conflict',
        'detail': 'The attempt is no longer in that state.',
        'attempt': _lite(a),
      });

  static final Map<int, String> _answerKey = () {
    final key = <int, String>{};
    for (final f in ['pastpaper_result.response.completed.json', 'pastpaper_result.response.completed_cached.json']) {
      for (final q in (fixture(f)['questions']! as List).cast<Map<String, Object?>>()) {
        key[q['id']! as int] = q['correct_answers']! as String;
      }
    }
    // The fixture midterm's key (midterm results never expose per-question rows).
    key.addAll({3001: 'C', 3002: '6', 3003: 'B', 3004: 'B', 3011: 'B', 3012: '12', 3013: 'A'});
    return key;
  }();

  static bool _isCorrect(String? answer, String accepted) {
    if (answer == null || answer.isEmpty) return false;
    return accepted.split(',').map((s) => s.trim()).contains(answer.trim());
  }

  static int _scaled800(int correct, int total) => total == 0 ? 200 : 200 + ((correct / total * 600) / 10).round() * 10;

  void _complete(_Attempt a) {
    var correct = 0;
    var total = 0;
    for (final m in a.moduleContent()) {
      for (final q in ((m['questions'] as List?) ?? const []).cast<Map<String, Object?>>()) {
        total++;
        final id = q['id']! as int;
        if (_isCorrect(a.answers[m['id']]?[id], _answerKey[id] ?? '')) correct++;
      }
    }
    a.state = AttemptState.completed;
    a.score = _scaled800(correct, total);
    a.completedAt = now;
    a.version++;
  }

  @override
  Future<PastpaperResult> pastpaperResult(int attemptId, {Map<int, String> have = const {}}) =>
      _call('pastpaperResult', {'attempt_id': attemptId, 'have': stringKeys(have)}, () {
        final a = _attempts[attemptId];
        if (a == null) {
          final cached = fixture('pastpaper_result.response.completed_cached.json');
          if (cached['attempt_id'] == attemptId) return PastpaperResult.fromJson(JsonReader.of(cached));
          _notVisible();
        }
        if (a.kind != AttemptKind.pastpaper) _notVisible();
        if (a.state == AttemptState.scoring) {
          a.resultPolls++;
          if (a.resultPolls > scoringPolls) _complete(a);
        }
        if (a.state == AttemptState.scoring) {
          return PastpaperResult.fromJson(JsonReader.of(
              {'schema': 1, 'attempt_id': a.id, 'state': 'SCORING', 'poll_after_ms': 2000}));
        }
        if (a.state != AttemptState.completed) _stateConflict(a);
        return PastpaperResult.fromJson(JsonReader.of(_resultJson(a, have)));
      });

  Map<String, Object?> _resultJson(_Attempt a, Map<int, String> have) {
    final rows = <Map<String, Object?>>[];
    final modules = <Map<String, Object?>>[];
    final content = <String, Object?>{};
    final mediaKeys = <String>[];
    for (final m in a.moduleContent()) {
      final mid = m['id']! as int;
      final qs = ((m['questions'] as List?) ?? const []).cast<Map<String, Object?>>();
      var correct = 0;
      for (final q in qs) {
        final id = q['id']! as int;
        final ans = a.answers[mid]?[id];
        final ok = _isCorrect(ans, _answerKey[id] ?? '');
        if (ok) correct++;
        rows.add({
          'id': id,
          'module_id': mid,
          'order': q['order'],
          'student_answer': (ans == null || ans.isEmpty) ? null : ans,
          'correct_answers': _answerKey[id] ?? '',
          'is_correct': ok,
          'was_flagged': a.flagged[mid]?.contains(id) ?? false,
        });
        if (q['question_image_key'] != null) mediaKeys.add(q['question_image_key']! as String);
      }
      modules.add({'order': m['order'], 'module_id': mid, 'correct': correct, 'total': qs.length});
      final cached = have[mid] != null && have[mid] == m['content_hash'];
      content['$mid'] = {'content_hash': m['content_hash'], 'questions': cached ? null : qs};
    }
    final answered = rows.where((r) => r['student_answer'] != null).length;
    final correct = rows.where((r) => r['is_correct'] == true).length;
    final previous = _attempts.values
        .where((x) => x.kind == AttemptKind.pastpaper && x.refId == a.refId && x.id != a.id && x.score != null)
        .map((x) => x.score!)
        .fold<int?>(null, (p, s) => s);
    return {
      'schema': 1,
      'attempt_id': a.id,
      'practice_test_id': a.refId,
      'state': 'COMPLETED',
      'poll_after_ms': null,
      'score': a.score,
      'previous_score': previous,
      'score_delta': previous == null ? null : a.score! - previous,
      'completed_at': formatTimestampOrNull(a.completedAt),
      'totals': {
        'questions': rows.length,
        'answered': answered,
        'correct': correct,
        'incorrect': answered - correct,
        'skipped': rows.length - answered,
      },
      'modules': modules,
      'questions': rows,
      'content': content,
      ..._media(mediaKeys, _pastpaperTtl),
    };
  }

  // ------------------------------------------------------------------------------------------
  // Midterms
  // ------------------------------------------------------------------------------------------

  static const _midtermId = 14;

  _Attempt _midtermAttempt(int midtermId) {
    if (midtermId != _midtermId) _notVisible();
    final existing = _attempts.values.where((a) => a.kind == AttemptKind.midterm && a.refId == midtermId);
    if (existing.isNotEmpty) return existing.last;
    final open = fixture('midterm_open.response.json');
    final next = (fixture('midterm_submit.response.json')['next_module']! as Map).cast<String, Object?>();
    final m1 = ((open['modules']! as List).first as Map).cast<String, Object?>();
    final a = _Attempt(
      id: 5521,
      kind: AttemptKind.midterm,
      refId: midtermId,
      moduleIds: [m1['id']! as int, next['id']! as int],
      durationsMs: [(m1['time_limit_minutes']! as int) * 60000, (next['time_limit_minutes']! as int) * 60000],
      source: {...open, 'modules': [m1, next]},
    );
    _attempts[a.id] = a;
    return a;
  }

  void _checkToken(_Attempt a, String? token) {
    if (!requireLockdownToken) return;
    if (a.lockdownToken == null || token == null || token.isEmpty) {
      _error(403, {
        'detail': 'This midterm can only be taken in the MasterSAT app for Windows.',
        'reason': 'desktop_required',
        'desktop_required': true,
      });
    }
    if (token != a.lockdownToken) {
      _error(403, fixture('error.403.lockdown.json'));
    }
  }

  @override
  Future<MidtermPrepareResponse> midtermPrepare(int midtermId, MidtermPrepareRequest body) =>
      _call('midtermPrepare', {'midterm_id': midtermId, ...body.toJson()}, () {
        final a = _midtermAttempt(midtermId);
        if (body.code != null) {
          if (body.code != fixtureMidtermCode) {
            _error(403, fixture('midterm_prepare.response.code_incorrect.json'));
          }
          a.codeVerified = true;
        }
        final rules = fixture('midterm_prepare.response.json')['rules'];
        return MidtermPrepareResponse.fromJson(JsonReader.of({
          'schema': 1,
          'attempt': _lite(a),
          'requires_code': true,
          'code_verified': a.codeVerified,
          'rules': rules,
        }));
      });

  @override
  Future<LockdownChallenge> midtermChallenge(int attemptId) =>
      _call('midtermChallenge', {'attempt_id': attemptId}, () {
        final a = _attempt(attemptId, AttemptKind.midterm);
        if (a.state.isFinished) {
          _error(409, {'detail': 'This midterm is no longer running.', 'reason': 'desktop_not_live',
                       'desktop_required': true});
        }
        _tokenSerial++;
        a.nonce = 'n0nce-${a.id}-$_tokenSerial';
        a.nonceExpires = now.add(const Duration(seconds: 60));
        return LockdownChallenge(nonce: a.nonce!, expiresIn: 60);
      });

  @override
  Future<LockdownSession> midtermSession(int attemptId, LockdownSessionRequest body) =>
      _call('midtermSession', {'attempt_id': attemptId, ...body.toJson()}, () {
        final a = _attempt(attemptId, AttemptKind.midterm);
        final fresh = a.nonce != null && body.nonce == a.nonce && !now.isAfter(a.nonceExpires!);
        a.nonce = null; // spent on any answer, right or wrong
        if (!fresh) {
          _error(403, {'detail': "The app's check expired. Try again.", 'reason': 'desktop_challenge_invalid',
                       'desktop_required': true});
        }
        if (body.mac.isEmpty || body.precheck.isEmpty) {
          _error(403, {
            'detail': 'The app could not prove it is locked down. Restart the MasterSAT app and try again.',
            'reason': 'desktop_proof_invalid',
            'desktop_required': true,
          });
        }
        _tokenSerial++;
        a.lockdownToken = 'ls-${a.id}-$_tokenSerial';
        return LockdownSession(lockdownSession: a.lockdownToken!, required: true);
      });

  @override
  Future<ExamBundle> midtermOpen(int attemptId, MidtermOpenRequest body, {required String lockdownSession}) =>
      _call('midtermOpen', {'attempt_id': attemptId, ...body.toJson()}, () {
        final a = _attempt(attemptId, AttemptKind.midterm);
        _checkToken(a, lockdownSession);
        if (!a.codeVerified) _error(403, {'code': 'code_required', 'detail': 'Enter the code from your teacher.'});
        if (a.state.isFinished) _stateConflict(a);
        if (a.state == AttemptState.notStarted) _startModule(a, 0);
        return ExamBundle.fromJson(JsonReader.of(_bundle(a, body.have, liveOnly: true)));
      });

  bool _withinGrace(DateTime? deadline) =>
      deadline == null || !now.isAfter(deadline.add(const Duration(seconds: 300)));

  @override
  Future<WriteOutcome> midtermSync(
    int attemptId,
    SyncRequest body, {
    required String lockdownSession,
    required String idempotencyKey,
  }) =>
      _call('midtermSync', {'attempt_id': attemptId, 'key': idempotencyKey, ...body.toJson()}, () {
        final a = _attempt(attemptId, AttemptKind.midterm);
        _checkToken(a, lockdownSession);
        final out = _idempotent(a, idempotencyKey, () {
          final live = a.state.isActive && a.moduleIds[a.index] == body.moduleId;
          final previous = a.state == AttemptState.module2Active && body.moduleId == a.moduleIds[0];
          if (live && _withinGrace(a.deadline)) {
            _merge(a, body.moduleId, body.answers, body.flagged);
            return {'applied': true, 'reason': null};
          }
          if (previous && _withinGrace(a.module1Deadline)) {
            _merge(a, body.moduleId, body.answers, body.flagged);
            return {'applied': true, 'reason': null};
          }
          if (live || previous) return {'applied': false, 'reason': 'late'};
          return {'applied': false, 'reason': 'module_not_active'};
        });
        return WriteOutcome.fromJson(JsonReader.of(out));
      });

  @override
  Future<SubmitOutcome> midtermSubmit(
    int attemptId,
    SyncRequest body, {
    required String lockdownSession,
    required String idempotencyKey,
  }) =>
      _call('midtermSubmit', {'attempt_id': attemptId, 'key': idempotencyKey, ...body.toJson()}, () {
        final a = _attempt(attemptId, AttemptKind.midterm);
        _checkToken(a, lockdownSession);
        final live = a.state.isActive && a.moduleIds[a.index] == body.moduleId;
        // The early-submit check runs BEFORE the idempotency layer: never cached.
        if (live && a.violations < 3 && a.deadline != null && now.isBefore(a.deadline!)) {
          _error(409, {
            'code': 'module_not_expired',
            'detail': 'This module is still running.',
            'retry_after_ms': a.deadline!.difference(now).inMilliseconds,
            'attempt': _lite(a),
          });
        }
        final out = _idempotent(a, idempotencyKey, () {
          if (!live) {
            return {
              'applied': false,
              'reason': 'module_not_active',
              'transitioned_to': null,
              'next_module': null,
              'media': <Object?>[],
              'result': null,
            };
          }
          final applied = _withinGrace(a.deadline);
          if (applied) _merge(a, body.moduleId, body.answers, body.flagged);
          if (a.index == 0) {
            a.module1Deadline = a.deadline;
            final cap = a.deadline!.add(const Duration(seconds: 300));
            _startModule(a, 1, now.isBefore(cap) ? now : cap);
            final next = _bundle(a, const {}, liveOnly: true);
            return {
              'applied': applied,
              'reason': applied ? null : 'late',
              'transitioned_to': AttemptState.module2Active.wire,
              'next_module': (next['modules']! as List).first,
              'media': next['media'],
              'result': null,
            };
          }
          a.state = AttemptState.scoring;
          a.deadline = null;
          a.resultPolls = 0;
          a.version++;
          return {
            'applied': applied,
            'reason': applied ? null : 'late',
            'transitioned_to': AttemptState.scoring.wire,
            'next_module': null,
            'media': <Object?>[],
            'result': {'poll_after_ms': 2000},
          };
        });
        return SubmitOutcome.fromJson(JsonReader.of(out));
      });

  @override
  Future<OffscreenOutcome> midtermOffscreen(
    int attemptId,
    OffscreenRequest body, {
    required String lockdownSession,
    required String idempotencyKey,
  }) =>
      _call('midtermOffscreen', {'attempt_id': attemptId, 'key': idempotencyKey, ...body.toJson()}, () {
        final a = _attempt(attemptId, AttemptKind.midterm);
        _checkToken(a, lockdownSession);
        final out = _idempotent(a, idempotencyKey, () {
          var terminated = false;
          if (a.state.isActive) {
            a.violations++;
            a.version++;
            if (a.violations >= 3) {
              a.state = AttemptState.scoring;
              a.deadline = null;
              a.terminatedReason = 'OFFSCREEN';
              a.resultPolls = 0;
              terminated = true;
            }
          }
          return {
            'violations': a.violations,
            'limit': 3,
            'grace_seconds': terminated || !a.state.isActive ? 0 : 3,
            'terminated': terminated,
          };
        });
        return OffscreenOutcome.fromJson(JsonReader.of(out));
      });

  @override
  Future<MidtermResult> midtermResult(int attemptId) => _call('midtermResult', {'attempt_id': attemptId}, () {
        final a = _attempts[attemptId];
        if (a == null) {
          final released = fixture('midterm_result.response.released.json');
          if (released['attempt_id'] == attemptId) return MidtermResult.fromJson(JsonReader.of(released));
          _notVisible();
        }
        if (a.kind != AttemptKind.midterm) _notVisible();
        if (a.state == AttemptState.scoring) {
          a.resultPolls++;
          if (a.resultPolls > scoringPolls) _complete(a);
        }
        if (a.state == AttemptState.scoring) {
          return MidtermResult.fromJson(
              JsonReader.of({'schema': 1, 'attempt_id': a.id, 'state': 'SCORING', 'poll_after_ms': 2000}));
        }
        if (a.state != AttemptState.completed) _stateConflict(a);
        return MidtermResult.fromJson(JsonReader.of({
          'schema': 1,
          'attempt_id': a.id,
          'state': 'COMPLETED',
          'poll_after_ms': null,
          'score_only': true,
          'released': true,
          'mock_kind': 'MIDTERM',
          'subject': 'MATH',
          'scoring_scale': 'SCALE_800',
          'total_score': a.score,
          'score_ceiling': 800,
          'certificate': null,
        }));
      });

  // ------------------------------------------------------------------------------------------
  // Media, annotations, reports, documents
  // ------------------------------------------------------------------------------------------

  @override
  Future<MediaResponse> media(AttemptKind kind, int attemptId, {String? lockdownSession}) =>
      _call('media', {'kind': kind.wire, 'attempt_id': attemptId}, () {
        final a = _attempt(attemptId, kind);
        if (kind == AttemptKind.midterm) _checkToken(a, lockdownSession);
        final b = _bundle(a, const {}, liveOnly: kind == AttemptKind.midterm);
        return MediaResponse.fromJson(
            JsonReader.of({'schema': 1, 'attempt_id': a.id, 'kind': kind.wire, 'media': b['media']}));
      });

  @override
  Future<void> annotationWrite(AnnotationWriteRequest body) => _call('annotationWrite', body.toJson(), () {
        _annotations['${body.ref}/${body.targetId}/${body.container.wire}'] =
            body.data.map((x) => x.toJson()).toList();
      });

  @override
  Future<QuestionReportResponse> questionReport(QuestionReportRequest body, {required String idempotencyKey}) =>
      _call('questionReport', {'key': idempotencyKey, ...body.toJson()}, () {
        final replay = _reportsByKey[idempotencyKey];
        if (replay != null) return QuestionReportResponse(id: replay, status: 'NEW');
        final dedupeKey = '${body.questionId}/${body.category.wire}';
        final existing = _reportsByQuestion[dedupeKey];
        if (existing != null) {
          _reportsByKey[idempotencyKey] = existing;
          return QuestionReportResponse(id: existing, deduped: true);
        }
        final id = _nextReportId++;
        _reportsByKey[idempotencyKey] = id;
        _reportsByQuestion[dedupeKey] = id;
        return QuestionReportResponse(id: id, status: 'NEW');
      });

  static final Uint8List _pdf = Uint8List.fromList(utf8.encode(
      '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\n'
      'trailer<</Root 1 0 R>>\n%%EOF\n'));

  @override
  Future<Uint8List> pastpaperReportPdf(int attemptId) => _call('pastpaperReportPdf', {'attempt_id': attemptId}, () => _pdf);

  @override
  Future<Uint8List> pastpaperCertificatePdf(int attemptId) =>
      _call('pastpaperCertificatePdf', {'attempt_id': attemptId}, () => _pdf);

  @override
  Future<Uint8List> midtermErrorReportPdf(int attemptId) =>
      _call('midtermErrorReportPdf', {'attempt_id': attemptId}, () => _pdf);

  @override
  Future<Uint8List> midtermCertificatePdf(String code) => _call('midtermCertificatePdf', {'code': code}, () => _pdf);
}

class _Attempt {
  _Attempt({
    required this.id,
    required this.kind,
    required this.refId,
    required this.moduleIds,
    required this.durationsMs,
    required this.source,
  });

  final int id;
  final AttemptKind kind;
  final int refId;
  final List<int> moduleIds;
  final List<int> durationsMs;

  /// The fixture bundle the content comes from.
  final Map<String, Object?> source;

  AttemptState state = AttemptState.notStarted;
  int version = 1;
  int index = 0;
  DateTime? deadline;
  DateTime? module1Deadline;
  bool paused = false;
  int? pausedRemainingMs;
  final Map<int, Map<int, String>> answers = {};
  final Map<int, Set<int>> flagged = {};
  List<Map<String, Object?>> annotations = const [];
  int resultPolls = 0;
  int? score;
  DateTime? completedAt;

  // Midterm.
  bool codeVerified = false;
  String? nonce;
  DateTime? nonceExpires;
  String? lockdownToken;
  int violations = 0;
  String? terminatedReason;

  List<Map<String, Object?>> moduleContent() => (source['modules']! as List).cast<Map<String, Object?>>();
}
