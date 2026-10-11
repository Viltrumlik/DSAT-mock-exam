// Website modules the island imports UNCHANGED (architecture.md §3, "Reusing website code").
// Every path here is in parity-manifest.json; `npm run parity` fails when one changes.
//
//   features/testing-simulation/tools/highlight/annotations.ts   offsets, merge rules, painting
//   features/testing-simulation/utils/richContent.ts             renderExamHtml (KaTeX pipeline)
//   features/testing-simulation/utils/options.ts                 parseOptions
//   features/testing-simulation/utils/questionKind.ts            isStudentProducedResponse
//   features/testing-simulation/utils/image.ts                   resolveImageUrl
//   components/MathText.tsx (prepareRichText) + lib/mathRender.ts, via richContent.ts
//
// SafeHtml.tsx's one job for the island (DOMPurify.sanitize with default options before the
// HTML reaches the DOM) is reproduced in ported/safeHtml.ts.
export {
  addHighlight,
  addUnderline,
  annotationsAt,
  applyAnnotations,
  boundingRange,
  clearAnnotations,
  computeSegments,
  markFromEvent,
  mergeAnnotations,
  offsetsOfMark,
  rangeToOffsets,
  removeRange,
  type Annotation,
  type AnnotationKind,
  type HighlightColor,
  type OffsetRange,
  type UnderlineStyle,
} from "@website/features/testing-simulation/tools/highlight/annotations";
export { renderExamHtml } from "@website/features/testing-simulation/utils/richContent";
export { parseOptions, type ParsedOption } from "@website/features/testing-simulation/utils/options";
export { isStudentProducedResponse } from "@website/features/testing-simulation/utils/questionKind";
export { resolveImageUrl } from "@website/features/testing-simulation/utils/image";
export type { ExamQuestion } from "@website/features/testing-simulation/types";
