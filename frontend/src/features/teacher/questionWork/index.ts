/**
 * Instant checking on a teacher's question surface: one pane, mounted twice. Teacher pages
 * import from here rather than reaching at the files, the same way they do with `../ui`.
 */
export { QuestionWorkPane } from "./QuestionWorkPane";
export { useQuestionCheck, type QuestionCheck } from "./useQuestionCheck";
export {
  answerKeyFromAssessmentQuestion,
  answerKeyFromReviewQuestion,
  judgeAnswer,
  EMPTY_ANSWER_KEY,
  type AnswerKey,
  type AnswerCompare,
  type Verdict,
} from "./answerKey";
