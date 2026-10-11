// Conversions between the wire models (lib/core/models) and the generated island protocol
// types (protocol.dart). Hand-written; keep it tiny.
import '../core/models/models.dart';
import 'protocol.dart';

extension AnnotationToIsland on Annotation {
  IslandAnnotation toIsland() =>
      IslandAnnotation(start: start, end: end, kind: kind.wire, color: color?.wire, underline: underline?.wire);
}

extension IslandAnnotationToModel on IslandAnnotation {
  Annotation toModel() => Annotation(
        start: start,
        end: end,
        kind: AnnotationKind.fromWire(kind),
        color: HighlightColor.fromWireOrNull(color),
        underline: UnderlineStyle.fromWireOrNull(underline),
      );
}

/// The three containers for `question.show.annotations`.
IslandAnnotationSet islandAnnotationSet(Map<AnnotationContainer, List<Annotation>> byContainer) =>
    IslandAnnotationSet(
      passage: [for (final a in byContainer[AnnotationContainer.passage] ?? const <Annotation>[]) a.toIsland()],
      question: [for (final a in byContainer[AnnotationContainer.question] ?? const <Annotation>[]) a.toIsland()],
      choices: [for (final a in byContainer[AnnotationContainer.choices] ?? const <Annotation>[]) a.toIsland()],
    );

/// `module.load` for a module: the bundle question objects, unchanged.
ModuleLoadMessage moduleLoadMessage(int moduleId, List<Question> questions) =>
    ModuleLoadMessage(moduleId: moduleId, questions: [for (final q in questions) q.toJson()]);
