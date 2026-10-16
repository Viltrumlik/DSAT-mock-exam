// Model name (as written in contracts/v1/manifest.json "model") → parser + encoder.
// The contract round-trip test and FixtureV1Api use it; adding a fixture with a new model
// name fails the round-trip test until the model is registered here.
import 'attempt.dart';
import 'content.dart';
import 'home.dart';
import 'json.dart';
import 'misc.dart';
import 'results.dart';
import 'writes.dart';

/// A parse/encode pair for one wire model.
class ContractModel<T> {
  const ContractModel(this.name, this.parse, this.encode);

  final String name;
  final T Function(JsonReader r) parse;
  final Map<String, Object?> Function(T value) encode;

  T decode(Object? json) => parse(JsonReader.of(json));

  /// parse → encode; equal to the input iff the model covers every key of it.
  Map<String, Object?> roundTrip(Object? json) => encode(decode(json));

  /// Encodes a value of this model held as [Object] (call this, not [encode], through a
  /// `ContractModel<Object>` reference: reading [encode] there fails the covariance check).
  Map<String, Object?> encodeAny(Object value) => encode(value as T);
}

final Map<String, ContractModel<Object>> contractModels = {
  for (final m in <ContractModel<Object>>[
    ContractModel<HomeResponse>('HomeResponse', HomeResponse.fromJson, (v) => v.toJson()),
    ContractModel<PastpaperOpenRequest>('PastpaperOpenRequest', PastpaperOpenRequest.fromJson, (v) => v.toJson()),
    ContractModel<MidtermOpenRequest>('MidtermOpenRequest', MidtermOpenRequest.fromJson, (v) => v.toJson()),
    ContractModel<ExamBundle>('ExamBundle', ExamBundle.fromJson, (v) => v.toJson()),
    ContractModel<AttemptEnvelope>('AttemptEnvelope', AttemptEnvelope.fromJson, (v) => v.toJson()),
    ContractModel<SyncRequest>('SyncRequest', SyncRequest.fromJson, (v) => v.toJson()),
    ContractModel<WriteOutcome>('WriteOutcome', WriteOutcome.fromJson, (v) => v.toJson()),
    ContractModel<SubmitOutcome>('SubmitOutcome', SubmitOutcome.fromJson, (v) => v.toJson()),
    ContractModel<PastpaperResult>('PastpaperResult', PastpaperResult.fromJson, (v) => v.toJson()),
    ContractModel<MidtermPrepareRequest>('MidtermPrepareRequest', MidtermPrepareRequest.fromJson, (v) => v.toJson()),
    ContractModel<MidtermPrepareResponse>(
        'MidtermPrepareResponse', MidtermPrepareResponse.fromJson, (v) => v.toJson()),
    ContractModel<LockdownChallenge>('LockdownChallenge', LockdownChallenge.fromJson, (v) => v.toJson()),
    ContractModel<LockdownSessionRequest>(
        'LockdownSessionRequest', LockdownSessionRequest.fromJson, (v) => v.toJson()),
    ContractModel<LockdownSession>('LockdownSession', LockdownSession.fromJson, (v) => v.toJson()),
    ContractModel<OffscreenRequest>('OffscreenRequest', OffscreenRequest.fromJson, (v) => v.toJson()),
    ContractModel<OffscreenOutcome>('OffscreenOutcome', OffscreenOutcome.fromJson, (v) => v.toJson()),
    ContractModel<MidtermResult>('MidtermResult', MidtermResult.fromJson, (v) => v.toJson()),
    ContractModel<MediaResponse>('MediaResponse', MediaResponse.fromJson, (v) => v.toJson()),
    ContractModel<AuthLoginRequest>('AuthLoginRequest', AuthLoginRequest.fromJson, (v) => v.toJson()),
    ContractModel<AuthTokens>('AuthTokens', AuthTokens.fromJson, (v) => v.toJson()),
    ContractModel<RefreshRequest>('RefreshRequest', RefreshRequest.fromJson, (v) => v.toJson()),
    ContractModel<AnnotationWriteRequest>(
        'AnnotationWriteRequest', AnnotationWriteRequest.fromJson, (v) => v.toJson()),
    ContractModel<QuestionReportRequest>('QuestionReportRequest', QuestionReportRequest.fromJson, (v) => v.toJson()),
    ContractModel<QuestionReportResponse>(
        'QuestionReportResponse', QuestionReportResponse.fromJson, (v) => v.toJson()),
    ContractModel<ApiErrorBody>('ApiErrorBody', ApiErrorBody.fromJson, (v) => v.toJson()),
  ])
    m.name: m,
};
