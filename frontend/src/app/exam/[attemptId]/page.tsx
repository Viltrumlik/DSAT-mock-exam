"use client";
import React, { useState, useEffect, useRef, memo, useCallback, Suspense } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { isAxiosError } from 'axios';
import { examsStudentApi } from "@/features/examsStudent/api";
import {
  type ExamQuestion,
  type TestAttempt,
  InvalidTestAttemptPayloadError,
  normalizeFlaggedList,
  normalizeSavedAnswersForForm,
  parseAttemptBootstrapHints,
  parseExamLocalDraft,
  parseTestAttempt,
} from "@/features/examsStudent/testAttemptSchema";
import AuthGuard from '@/components/AuthGuard';
import { useAuthCriticalGate } from "@/hooks/useAuthCriticalGate";
import { platformSubjectIsMath, platformSubjectIsReadingWriting } from '@/lib/permissions';
import { renderMath } from '@/lib/mathRender';
import { Bookmark, ChevronDown, Highlighter, ZoomIn, Calculator, ChevronUp, X, Eye, EyeOff, MinusCircle, Info, Eye as EyeIcon, Play, Pause, ChevronLeft, ChevronRight, AlertCircle, BookOpen, Trash2, MoreVertical, Save } from 'lucide-react';
// SafeHtml is correct here — the text-highlighting feature stores annotated HTML
// with <mark> spans in state. MathText's allowlist strips <mark> unconditionally.
// Do NOT replace with MathText until highlight storage is redesigned to use
// character offsets. See SafeHtml.tsx "Long-term Architectural Positioning".
import SafeHtml from '@/components/SafeHtml';
// Fix for image URL if it's relative
const getImageUrl = (path: string | null | undefined) => {
    if (!path) return undefined;
    if (path.startsWith('http')) return path;
    const baseUrl = process.env.NEXT_PUBLIC_API_URL?.replace('/api', '') || '';
    return `${baseUrl}${path}`;
};

const examsPublicApi = examsStudentApi;

/** `/exams/attempts/` payload may not use strict DB enum strings for `practice_test_details.subject`. */
function attemptPtSubjectIsRW(attempt: TestAttempt | null | undefined) {
    return platformSubjectIsReadingWriting(attempt?.practice_test_details?.subject);
}
function attemptPtSubjectIsMath(attempt: TestAttempt | null | undefined) {
    return platformSubjectIsMath(attempt?.practice_test_details?.subject);
}

function randomIdemSegment(): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
        return crypto.randomUUID();
    }
    return String(Date.now());
}

function optionEntryImage(val: unknown): string | undefined {
    if (val && typeof val === "object" && "image" in val && typeof (val as { image?: unknown }).image === "string") {
        return (val as { image: string }).image;
    }
    return undefined;
}

function optionEntryText(val: unknown): string {
    if (typeof val === "string") return val;
    if (val && typeof val === "object" && "text" in val && typeof (val as { text?: unknown }).text === "string") {
        return (val as { text: string }).text;
    }
    return "";
}

function optionLetterKeys(q: ExamQuestion): string[] {
    const opts = q.options as unknown;
    if (opts && typeof opts === "object" && !Array.isArray(opts)) {
        return Object.keys(opts as Record<string, unknown>);
    }
    return ["A", "B", "C", "D"];
}

function moduleWallClockLimitSec(attempt: TestAttempt): number {
    const fromModule = attempt.current_module_details
        ? attempt.current_module_details.time_limit_minutes * 60
        : 0;
    if (attempt.module_duration_seconds != null && Number.isFinite(attempt.module_duration_seconds)) {
        return Math.max(0, Math.floor(attempt.module_duration_seconds));
    }
    return Math.max(0, Math.floor(fromModule));
}

function clampedRemainingFromServer(attempt: TestAttempt): number | null {
    if (attempt.remaining_seconds != null && Number.isFinite(attempt.remaining_seconds)) {
        return Math.max(0, Math.floor(attempt.remaining_seconds));
    }
    return null;
}

type ExamAttemptBcPayload = { t?: string; attemptId?: string; from?: string };

type QuestionPaneProps = {
  currentQuestion: ExamQuestion;
  zoomLevel: number;
  highlighterActive: boolean;
  passageHtml: string | undefined;
  handleShowPopover: (targetId: string, e?: React.MouseEvent) => void;
};

type RightPaneProps = {
  currentQuestion: ExamQuestion;
  currentQuestionIndex: number;
  attempt: TestAttempt;
  zoomLevel: number;
  highlighterActive: boolean;
  handleShowPopover: (targetId: string, e?: React.MouseEvent) => void;
  questionHighlights: Record<number, string>;
  questionPromptHighlights: Record<number, string>;
  optionHighlights: Record<string, string>;
  answers: Record<string, string>;
  setAnswers: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  eliminatedOptions: Record<string, string[]>;
  setEliminatedOptions: React.Dispatch<React.SetStateAction<Record<string, string[]>>>;
  isEliminationMode: boolean;
  setIsEliminationMode: React.Dispatch<React.SetStateAction<boolean>>;
  flagged: number[];
  setFlagged: React.Dispatch<React.SetStateAction<number[]>>;
  showCalculator: boolean;
};

const formatFraction = (ans: string | undefined | null) => {
    if (!ans) return 'Omit';
    if (ans.includes('/')) {
        const parts = ans.split('/');
        if (parts.length === 2) {
            return `$$ \\frac{${parts[0]}}{${parts[1]}} $$`;
        }
    }
    return ans;
};

const SprFraction = ({ text }: { text: string }) => {
    if (!text) return null;
    if (text.includes('/')) {
        const [num, den] = text.split('/');
        return (
            <div className="inline-flex flex-col items-center justify-center leading-none align-middle font-black mx-1 transition-all">
                <span className="border-b-[2.5px] border-slate-900 px-[2px] pb-[1px]">{num}</span>
                <span className="px-[2px] pt-[1px]">{den}</span>
            </div>
        );
    }
    return <span>{text}</span>;
};

const QuestionPane = memo(({ currentQuestion, zoomLevel, highlighterActive, passageHtml, handleShowPopover }: QuestionPaneProps) => {
    // Fix for image URL if it's relative
    return (
        <div
            className="w-1/2 p-10 overflow-y-auto border-r border-slate-200"
            style={{ fontSize: `${16 * zoomLevel}px` }}
            onMouseUp={(e) => highlighterActive && handleShowPopover('passage', e)}
        >
            <div
                id="passage-content"
                className={`prose prose-slate max-w-none leading-relaxed font-sans text-slate-800 ${highlighterActive ? 'cursor-text' : ''}`}
            >
                {currentQuestion.question_image && (
                    <div className="mb-6 rounded-lg overflow-hidden border border-slate-100 bg-slate-50 flex justify-center p-4">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={getImageUrl(currentQuestion.question_image)} alt="Question figure" className="max-w-full h-auto max-h-[400px] object-contain" />
                    </div>
                )}
                <SafeHtml
                    id="passage-text-container"
                    className="leading-relaxed font-[Georgia] font-medium mathjax-process"
                    html={passageHtml || currentQuestion.question_text?.replace(/\n/g, "<br/>") || "Question text goes here..."}
                />
            </div>
        </div>
    );
});

QuestionPane.displayName = 'QuestionPane';

const RightPane = memo(({
    currentQuestion,
    currentQuestionIndex,
    attempt,
    zoomLevel,
    highlighterActive,
    handleShowPopover,
    questionHighlights,
    questionPromptHighlights,
    optionHighlights,
    answers,
    setAnswers,
    eliminatedOptions,
    setEliminatedOptions,
    isEliminationMode,
    setIsEliminationMode,
    flagged,
    setFlagged,
    showCalculator,
}: RightPaneProps) => {

    const toggleFlag = useCallback(() => {
        const qId = currentQuestion.id;
        setFlagged((prev: number[]) => prev.includes(qId) ? prev.filter(id => id !== qId) : [...prev, qId]);
    }, [currentQuestion.id, setFlagged]);

    const handleOptionSelect = useCallback((optionKey: string) => {
        setAnswers((prev) => ({ ...prev, [currentQuestion.id]: optionKey }));
    }, [currentQuestion.id, setAnswers]);

    const toggleElimination = useCallback((optionKey: string) => {
        const qId = currentQuestion.id;

        // Deselect if currently selected as answer
        setAnswers((prev) => {
            if (prev[qId] === optionKey) {
                const next = { ...prev };
                delete next[qId];
                return next;
            }
            return prev;
        });

        setEliminatedOptions((prev) => {
            const current = prev[qId] ?? [];
            if (current.includes(optionKey)) {
                return { ...prev, [qId]: current.filter((o: string) => o !== optionKey) };
            } else {
                return { ...prev, [qId]: [...current, optionKey] };
            }
        });
    }, [currentQuestion.id, setEliminatedOptions, setAnswers]);

    return (
        <div
            className={`overflow-y-auto bg-white pb-8 ${((attemptPtSubjectIsRW(attempt) && !showCalculator) || currentQuestion.is_math_input) ? 'w-1/2' : 'w-full'} flex justify-center transition-transform duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)] ${(showCalculator && !currentQuestion.is_math_input) ? 'translate-x-[12vw] translate-y-0' : 'translate-x-0 translate-y-0'} ${
                attemptPtSubjectIsRW(attempt) || currentQuestion.is_math_input
                    ? 'p-10' : ''
            }`}
            style={{ fontSize: `${15 * zoomLevel}px` }}
        >
            <div className={
                attemptPtSubjectIsRW(attempt)
                    ? 'w-full px-10' // English equalized 50/50 proportion
                    : (attemptPtSubjectIsMath(attempt) && !currentQuestion.is_math_input && !showCalculator
                        ? 'w-full max-w-2xl px-10 py-10' // Plain Math
                        : 'w-full max-w-3xl') // Math SPR or Math with Calculator
            }>
                {/* Question header bar: number + Mark for Review */}
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-6">
                        <div className="bg-slate-900 text-white px-3 py-1.5 rounded-md flex items-center justify-center">
                            <span className="text-sm font-bold tracking-tight">{currentQuestionIndex + 1}</span>
                        </div>
                        <button
                            onClick={toggleFlag}
                            className={`flex items-center text-xs font-bold transition-colors ${flagged.includes(currentQuestion.id) ? 'text-slate-900' : 'text-slate-500 hover:text-slate-900'}`}
                        >
                            <div className="w-5 h-5 mr-1.5 border border-slate-400 rounded-sm flex items-center justify-center">
                                <Bookmark className={`w-3.5 h-3.5 ${flagged.includes(currentQuestion.id) ? 'text-slate-900 fill-slate-900' : 'text-slate-400'}`} />
                            </div>
                            Mark for Review
                        </button>
                    </div>

                    <button
                        onClick={() => setIsEliminationMode(!isEliminationMode)}
                        className={`flex items-center justify-center gap-1 p-1 px-1.5 border-2 rounded-md transition-all ${isEliminationMode ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-300 text-slate-600 hover:border-slate-400'}`}
                        title="Eliminate Answer"
                    >
                        <div className="relative">
                            <span className="text-[10px] font-black italic tracking-tighter">ABC</span>
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-[1.5px] bg-current rotate-[15deg]" />
                        </div>
                    </button>
                </div>
                <div className="w-full h-[3px] mb-8 opacity-100" style={{ background: 'repeating-linear-gradient(to right, #b91c1c 0, #b91c1c 48px, transparent 48px, transparent 54px, #ca8a04 54px, #ca8a04 102px, transparent 102px, transparent 108px, #15803d 108px, #15803d 156px, transparent 156px, transparent 162px, #0f172a 162px, #0f172a 210px, transparent 210px, transparent 216px)' }} />

                {/* Image above question text */}
                {currentQuestion.question_image && attemptPtSubjectIsMath(attempt) && (
                    <div className="mb-6 flex justify-center">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={getImageUrl(currentQuestion.question_image)}
                            alt="Question figure"
                            className="max-w-full h-auto max-h-[320px] object-contain border border-slate-100 rounded-lg bg-slate-50 p-2"
                        />
                    </div>
                )}

                {/* Prompt (Question Context) - Hidden for Math as requested */}
                {currentQuestion.question_prompt && !currentQuestion.is_math_input && (
                    <SafeHtml
                        id="question-prompt-content"
                        className={`mb-8 font-[Georgia] font-medium text-slate-900 leading-relaxed mathjax-process ${highlighterActive ? 'cursor-text' : ''}`}
                        style={{ fontSize: `${16 * zoomLevel * 1.2}px` }}
                        onMouseUp={(e: React.MouseEvent<HTMLDivElement>) => highlighterActive && handleShowPopover('question-prompt', e)}
                        html={questionPromptHighlights[currentQuestion.id] || currentQuestion.question_prompt.replace(/\n/g, "<br/>")}
                    />
                )}

                {attemptPtSubjectIsMath(attempt) && (
                    <SafeHtml
                        id="question-content"
                        className={`mb-8 font-[Georgia] font-medium text-slate-900 leading-relaxed mathjax-process ${highlighterActive ? 'cursor-text' : ''}`}
                        style={{ fontSize: `${16 * zoomLevel * 1.2}px` }}
                        onMouseUp={(e: React.MouseEvent<HTMLDivElement>) => highlighterActive && handleShowPopover('question', e)}
                        html={questionHighlights[currentQuestion.id] || currentQuestion.question_text?.replace(/\n/g, "<br/>") || "Question text goes here..."}
                    />
                )}

                {/* SPR input */}
                {currentQuestion.is_math_input ? (
                    <div className="mt-6">
                        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-2">Your Answer</p>
                        <input
                            type="text"
                            placeholder="Enter your answer"
                            maxLength={5}
                            className="w-full max-w-xs text-xl font-[Georgia] font-bold p-3 px-4 border-2 border-slate-300 rounded-lg hover:border-slate-400 focus:border-blue-600 focus:outline outline-2 outline-blue-600 outline-offset-1 transition-all shadow-sm text-center tracking-widest"
                            value={answers[currentQuestion.id] || ''}
                            onChange={(e) => {
                                const val = e.target.value.slice(0, 5);
                                if (/^[-0-9./]*$/.test(val)) {
                                    handleOptionSelect(val);
                                }
                            }}
                        />
                        <div className="mt-3 flex items-center justify-start gap-2 max-w-xs">
                            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Recorded Answer:</span>
                            <span className="text-sm font-[Georgia] font-black text-slate-900 bg-slate-100 px-2 py-0.5 rounded border border-slate-200 min-w-[30px] min-h-[30px] flex items-center justify-center text-center">
                                <SprFraction text={answers[currentQuestion.id] || ''} />
                            </span>
                        </div>
                    </div>
                ) : (
                    /* Multiple choice options */
                    <div className="space-y-4 w-full">
                        {(currentQuestion.options ? Object.entries(currentQuestion.options) : [['A', ''], ['B', ''], ['C', ''], ['D', '']]).map(([key, val]) => {
                            const isSelected = answers[currentQuestion.id] === key;
                            const isEliminated = (eliminatedOptions[currentQuestion.id] || []).includes(key);
                            return (
                                <div key={key} className="relative group flex items-center gap-3">
                                    <button
                                        onClick={() => !isEliminated && handleOptionSelect(key)}
                                        className={`flex-1 flex p-3 px-4 rounded-xl border-2 transition-all min-h-[50px] items-center ${
                                            isSelected
                                                ? 'border-blue-600 outline outline-2 outline-blue-600 outline-offset-1 bg-blue-50/20'
                                                : isEliminated
                                                    ? 'border-slate-100 opacity-50 cursor-not-allowed grayscale'
                                                    : 'border-slate-300 hover:border-slate-400 bg-white'
                                        }`}
                                    >
                                        <div className={`w-7 h-7 rounded-full border-2 flex items-center justify-center font-[Georgia] font-bold text-sm shrink-0 ${
                                            isSelected ? 'border-blue-600 bg-blue-600 text-white' : isEliminated ? 'border-slate-300 text-slate-400' : 'border-slate-400 text-slate-800'
                                        }`}>
                                            {key}
                                        </div>
                                        <div className={`ml-4 text-left font-[Georgia] text-[15px] text-slate-800 w-full ${isEliminated ? 'line-through decoration-slate-400' : ''}`}>
                                            <div
                                                key={`option-inner-${key}-${isEliminated}`}
                                                id={`option-content-${key}`}
                                                className={`w-full mathjax-process ${highlighterActive ? 'cursor-text' : ''}`}
                                                onMouseUp={(e) => highlighterActive && handleShowPopover(`option-${key}`, e)}
                                            >
                                                {optionEntryImage(val) ? (
                                                    <div className="py-2">
                                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                                        <img 
                                                            src={getImageUrl(optionEntryImage(val))} 
                                                            alt={`Option ${key}`} 
                                                            className="max-w-full h-auto max-h-[200px] object-contain rounded-lg border border-slate-100 shadow-sm" 
                                                        />
                                                    </div>
                                                ) : (
                                                    <SafeHtml html={(optionHighlights[key] ?? optionEntryText(val).replace(/\n/g, "<br/>")) || ""} />
                                                )}
                                            </div>
                                        </div>
                                    </button>

                                    {isEliminationMode && (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); toggleElimination(key); }}
                                            className={`w-9 h-9 rounded-lg border-2 flex items-center justify-center transition-all shrink-0 ${
                                                isEliminated
                                                    ? 'bg-red-50 border-red-300 text-red-600 shadow-sm'
                                                    : 'border-slate-200 text-slate-400 hover:border-red-400 hover:text-red-500'
                                            }`}
                                            title={isEliminated ? 'Restore' : 'Eliminate'}
                                        >
                                            <div className="relative">
                                                <span className="text-[11px] font-black">{key}</span>
                                                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-0.5 bg-current rotate-45" />
                                            </div>
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
});

RightPane.displayName = 'RightPane';

function ExamPlayerInner() {
    const { attemptId } = useParams();
    const router = useRouter();
    const searchParams = useSearchParams();
    const mockFlow = searchParams.get('mockFlow') === '1';
    const [midtermMode, setMidtermMode] = useState(() => searchParams.get('midterm') === '1');
    const [attempt, setAttempt] = useState<TestAttempt | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [reloadNonce, setReloadNonce] = useState(0);
    const [transitioning, setTransitioning] = useState(false);
    const [isOnline, setIsOnline] = useState(() => (typeof navigator !== "undefined" ? navigator.onLine : true));
    
    // SAFE STATE UPDATE: Enforces version_number checks to prevent stale background polls
    // from overwriting fresh state set by manual mutations like submitModule.
    const mergeAttemptFromServer = useCallback((data: TestAttempt) => {
        setAttempt((prev) => {
            if (!prev) return data;
            const prevV = prev.version_number;
            const newV = data.version_number;

            // Critical guard: never overwrite with an older version.
            if (newV < prevV) {
                return prev;
            }

            // Critical guard: never overwrite with an older module order.
            const prevOrder =
                prev.current_module_details?.module_order != null
                    ? Number(prev.current_module_details.module_order)
                    : 0;
            const newOrder =
                data.current_module_details?.module_order != null
                    ? Number(data.current_module_details.module_order)
                    : 0;
            // Only apply the module-order regression guard when both sides have a real module.
            // Legit states like SCORING/COMPLETED will have no active module (order=0).
            if (prevOrder > 0 && newOrder > 0 && newOrder < prevOrder && !data.is_completed) {
                return prev;
            }

            return data;
        });
    }, []);

    const prevModuleOrderRef = useRef<number | null>(null);
    const serverOffsetMsRef = useRef<number>(0);
    const scoringPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const activePollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const submitLockRef = useRef<boolean>(false);
    const multiTabRef = useRef<{ bc?: BroadcastChannel; id: string } | null>(null);
    const [multiTabBlocked, setMultiTabBlocked] = useState(false);

    const { assertCriticalAuth, criticalAuthReady } = useAuthCriticalGate();
    const assertCritRef = useRef(assertCriticalAuth);
    assertCritRef.current = assertCriticalAuth;

    const [timeLeft, setTimeLeft] = useState<number>(0);
    const [timerReady, setTimerReady] = useState(false);
    const lastAnswersModuleIdRef = useRef<number | null>(null);
    const lastRenderedSecRef = useRef<number>(-1);
    const virtualModuleStartMsRef = useRef<number>(0);
    const timeLeftRef = useRef<number>(0);
    const wasTimerPausedRef = useRef(false);
    const moduleTimerSubmitDoneRef = useRef(false);

    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);

    const [answers, setAnswers] = useState<Record<string, string>>({});
    const [flagged, setFlagged] = useState<number[]>([]);

    const [showNavigation, setShowNavigation] = useState(false);
    const [eliminatedOptions, setEliminatedOptions] = useState<Record<string, string[]>>({});
    const [zoomLevel, setZoomLevel] = useState(1.0);
    const [showCalculator, setShowCalculator] = useState(false);
    const [calcSize, setCalcSize] = useState({ w: 450, h: 600 });
    const [showMoreMenu, setShowMoreMenu] = useState(false);
    const [showDirections, setShowDirections] = useState(false);
    const [calculatorPos, setCalculatorPos] = useState({ x: typeof window !== 'undefined' ? window.innerWidth - 480 : 100, y: 100 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
    const [highlighterActive, setHighlighterActive] = useState(false);
    const [isEliminationMode, setIsEliminationMode] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [showTimer, setShowTimer] = useState(true);
    const [passageHighlights, setPassageHighlights] = useState<Record<number, string>>({});
    const [questionHighlights, setQuestionHighlights] = useState<Record<number, string>>({});
    const [questionPromptHighlights, setQuestionPromptHighlights] = useState<Record<number, string>>({});
    const [optionHighlights, setOptionHighlights] = useState<Record<string, string>>({});
    const [annotationPopover, setAnnotationPopover] = useState<{
        visible: boolean;
        x: number;
        y: number;
        range?: Range | null;
        targetId?: string;
        markElement?: HTMLElement | null;
    }>({ visible: false, x: 0, y: 0 });

    const [isFullscreen, setIsFullscreen] = useState(false);
    const [fullscreenWarningCountdown, setFullscreenWarningCountdown] = useState<number | null>(null);
    const [showAnswerPreview, setShowAnswerPreview] = useState(false);
    const [showReferenceSheet, setShowReferenceSheet] = useState(false);
    const [referencePos, setReferencePos] = useState({ x: 150, y: 150 });
    const [isRefDragging, setIsRefDragging] = useState(false);
    const [refDragOffset, setRefDragOffset] = useState({ x: 0, y: 0 });
    const [isNavigating, setIsNavigating] = useState(false);
    const [showFiveMinuteWarning, setShowFiveMinuteWarning] = useState(false);
    const [warningShownForModule, setWarningShownForModule] = useState<number | null>(null);
    const [pauseResumeError, setPauseResumeError] = useState<string | null>(null);
    const warningTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const current_module_details = attempt?.current_module_details ?? null;
    const questions: ExamQuestion[] = current_module_details?.questions ?? [];
    const currentQuestion = questions[currentQuestionIndex];

    useEffect(() => {
        if (typeof window === "undefined") return;
        const onOnline = () => setIsOnline(true);
        const onOffline = () => setIsOnline(false);
        window.addEventListener("online", onOnline);
        window.addEventListener("offline", onOffline);
        return () => {
            window.removeEventListener("online", onOnline);
            window.removeEventListener("offline", onOffline);
        };
    }, []);

    // Bootstrap: if we just created/resumed an attempt, use that payload immediately for faster first paint.
    useEffect(() => {
        if (typeof window === "undefined") return;
        const key = `mastersat.attempt.bootstrap.${String(attemptId || "")}`;
        const raw = sessionStorage.getItem(key);
        if (!raw) return;
        let json: unknown;
        try {
            json = JSON.parse(raw) as unknown;
        } catch (e) {
            console.error("[exam] bootstrap sessionStorage JSON.parse failed; removing key", key, e);
            try {
                sessionStorage.removeItem(key);
            } catch {
                /* ignore */
            }
            return;
        }
        try {
            const boot = parseTestAttempt(json, "sessionStorage bootstrap");
            if (String(boot.id) !== String(attemptId)) return;
            sessionStorage.removeItem(key);
            mergeAttemptFromServer(boot);
            if (boot.current_module_details) setLoading(false);
        } catch (e) {
            if (e instanceof InvalidTestAttemptPayloadError) {
                console.error(e);
                try {
                    sessionStorage.removeItem(key);
                } catch {
                    /* ignore */
                }
            } else {
                console.error("[exam] bootstrap unexpected error", e);
            }
        }
    }, [attemptId, mergeAttemptFromServer]);

    useEffect(() => {
        const fetchAttempt = async () => {
            try {
                setLoadError(null);
                const attemptIdNum = Number(attemptId);
                let snapshot = await examsPublicApi.getAttemptStatus(attemptIdNum);
                mergeAttemptFromServer(snapshot);

                try {
                    const sn = snapshot.server_now ? new Date(snapshot.server_now).getTime() : NaN;
                    if (Number.isFinite(sn)) serverOffsetMsRef.current = sn - Date.now();
                } catch {
                    /* ignore */
                }

                // If the backend reports NOT_STARTED, explicitly start the engine once.
                // This guarantees "Start test -> Module 1 opens" even for legacy rows.
                if (snapshot.current_state === "NOT_STARTED") {
                    if (!assertCritRef.current()) {
                        setLoading(false);
                        return;
                    }
                    const idemKeyStorage = `mastersat.idem.startAttempt.${attemptIdNum}`;
                    const idem =
                        (typeof window !== "undefined" && sessionStorage.getItem(idemKeyStorage)) ||
                        `start.${attemptIdNum}.${randomIdemSegment()}`;
                    try {
                        sessionStorage.setItem(idemKeyStorage, idem);
                    } catch {
                        /* ignore */
                    }
                    try {
                        snapshot = await examsPublicApi.startAttemptEngine(attemptIdNum, idem);
                        mergeAttemptFromServer(snapshot);
                    } catch (startErr) {
                        // Engine start failed — fall through to a status re-fetch
                        // which may show the attempt has been started by another
                        // request, or surface a recoverable error.
                        console.error("[exam] startAttemptEngine failed", startErr);
                    }
                    snapshot = await examsPublicApi.getAttemptStatus(attemptIdNum);
                    mergeAttemptFromServer(snapshot);
                    // If we are STILL in NOT_STARTED after the engine call,
                    // retry once more with a fresh idempotency key. This unsticks
                    // attempts where the first start call hit a transient race.
                    if (snapshot.current_state === "NOT_STARTED") {
                        const retryIdem = `start.${attemptIdNum}.retry.${Date.now()}`;
                        try {
                            snapshot = await examsPublicApi.startAttemptEngine(attemptIdNum, retryIdem);
                            mergeAttemptFromServer(snapshot);
                            snapshot = await examsPublicApi.getAttemptStatus(attemptIdNum);
                            mergeAttemptFromServer(snapshot);
                        } catch (retryErr) {
                            console.error("[exam] startAttemptEngine retry failed", retryErr);
                        }
                    }
                }
                // Set uniform zoom level to 100% (1.0) for both Math and English
                setZoomLevel(1.0);

                // Route to review only when backend explicitly says COMPLETED.
                if (snapshot.is_completed && snapshot.current_state === "COMPLETED") {
                    router.push(`/review/${attemptId}`);
                    return;
                }
                if (snapshot.is_expired) {
                    // Module deadline passed before the student got back. Do
                    // NOT auto-submit with empty answers here — that nukes any
                    // unsaved work. Instead surface a calm error and let the
                    // student click Retry, which will re-fetch and either land
                    // them in MODULE_2_ACTIVE (if the backend already moved on)
                    // or let them submit manually with their current answers.
                    setLoading(false);
                    setLoadError(
                        "Your time on this module has elapsed. Click Retry to sync and continue.",
                    );
                    return;
                }

                // Self-heal: backend may briefly return active state without module payload.
                // Re-check status once more before leaving the UI stuck on the loader.
                if (
                    !snapshot.current_module_details &&
                    (snapshot.current_state === "MODULE_1_ACTIVE" ||
                        snapshot.current_state === "MODULE_2_ACTIVE")
                ) {
                    try {
                        await new Promise((r) => setTimeout(r, 450));
                        snapshot = await examsPublicApi.getAttemptStatus(attemptIdNum);
                        mergeAttemptFromServer(snapshot);
                        if (!snapshot.current_module_details) {
                            setLoadError(
                                "The attempt state loaded, but the module payload is missing. Please click Retry.",
                            );
                            return;
                        }
                    } catch (healErr) {
                        if (healErr instanceof InvalidTestAttemptPayloadError) {
                            console.error(healErr);
                            setLoadError(
                                "The attempt state loaded, but the module payload is missing. Please click Retry.",
                            );
                            return;
                        }
                        setLoadError(
                            "The attempt state loaded, but the module payload is missing. Please click Retry.",
                        );
                        return;
                    }
                }

                setLoading(false);
            } catch (err) {
                setLoading(false);
                if (err instanceof InvalidTestAttemptPayloadError) {
                    console.error(err);
                    setLoadError(
                        "The server returned an unexpected attempt shape. Please click Retry.",
                    );
                    return;
                }
                const status = isAxiosError(err) ? err.response?.status : undefined;
                const authHint =
                    err &&
                    typeof err === "object" &&
                    "__mastersatAuthRequired" in err &&
                    (err as { __mastersatAuthRequired?: boolean }).__mastersatAuthRequired;

                if (authHint || status === 401) {
                    setLoadError("Your session needs re-authentication. Please click Retry to reconnect.");
                    return;
                }
                const data = isAxiosError(err) ? err.response?.data : undefined;
                let detail = "";
                if (typeof data === "string") detail = data;
                else if (data && typeof data === "object") {
                    const o = data as Record<string, unknown>;
                    if (typeof o.detail === "string") detail = o.detail;
                    else if (typeof o.error === "string") detail = o.error;
                    else detail = JSON.stringify(data);
                }
                const msg = `Could not load the attempt.${status ? ` HTTP ${status}.` : ""}${detail ? ` ${detail}` : ""}`;
                setLoadError(msg);

                // Stale/invalid attempt id recovery: try to route back to canonical start entry.
                if (status === 404 && typeof window !== "undefined") {
                    const bootKey = `mastersat.attempt.bootstrap.${String(attemptId || "")}`;
                    const rawBoot = sessionStorage.getItem(bootKey);
                    if (rawBoot) {
                        try {
                            const hints = parseAttemptBootstrapHints(JSON.parse(rawBoot) as unknown);
                            if (hints?.practiceTestId) {
                                router.replace(`/practice-test/${hints.practiceTestId}`);
                                return;
                            }
                        } catch (e) {
                            console.error("[exam] 404 recovery: bootstrap JSON invalid", e);
                        }
                    }
                    router.replace("/");
                }
            }
        };
        fetchAttempt();
    }, [attemptId, router, reloadNonce, mergeAttemptFromServer]);

    // Hard-stop: never allow the loader to spin forever.
    useEffect(() => {
        if (!loading) return;
        const t = setTimeout(() => {
            setLoadError("Loading is taking too long. Please click Retry.");
            setLoading(false);
        }, 12_000);
        return () => clearTimeout(t);
    }, [loading]);

    // Multi-tab guard with heartbeats: block UI only when another tab is actively
    // present (last heartbeat within ~6s). If the other tab closes, the block clears.
    useEffect(() => {
        const aid = String(attemptId || "");
        if (!aid) return;
        const myId = `${aid}.${Date.now()}.${Math.random().toString(16).slice(2)}`;
        const ch = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("mastersat.examAttempt") : null;
        multiTabRef.current = { bc: ch || undefined, id: myId };

        // Track the last time we heard from any other tab.
        let lastOtherTabBeatAt = 0;
        const STALE_MS = 6000;

        const sendBeat = () => {
            try {
                ch?.postMessage({ t: "beat", attemptId: aid, from: myId });
            } catch {}
        };

        const onMessage = (ev: MessageEvent) => {
            const m = ev.data as ExamAttemptBcPayload | undefined;
            if (!m || m.attemptId !== aid) return;
            if (!m.from || m.from === myId) return;
            // Another tab is alive — record the timestamp and block.
            lastOtherTabBeatAt = Date.now();
            setMultiTabBlocked(true);
            // If the other tab is saying hello, respond so they know we're here too.
            if (m.t === "hello") sendBeat();
        };
        ch?.addEventListener("message", onMessage);

        // Announce ourselves and start heartbeats.
        try {
            ch?.postMessage({ t: "hello", attemptId: aid, from: myId });
        } catch {}
        const beatInterval = setInterval(sendBeat, 2000);

        // Periodically check if other tabs have gone stale → clear the block.
        const staleCheck = setInterval(() => {
            if (lastOtherTabBeatAt && Date.now() - lastOtherTabBeatAt > STALE_MS) {
                lastOtherTabBeatAt = 0;
                setMultiTabBlocked(false);
            }
        }, 1500);

        return () => {
            clearInterval(beatInterval);
            clearInterval(staleCheck);
            try {
                ch?.removeEventListener("message", onMessage);
            } catch {}
            try {
                ch?.close();
            } catch {}
            multiTabRef.current = null;
        };
    }, [attemptId]);

    // Resume: hydrate local answers + server saved answers (server wins)
    useEffect(() => {
        if (!attempt?.current_module_details?.id) return;
        const key = `mastersat.examDraft.${attemptId}.${attempt.current_module_details.id}`;
        let localParsed = null as ReturnType<typeof parseExamLocalDraft>;
        try {
            const ls = localStorage.getItem(key);
            if (ls) {
                const json = JSON.parse(ls) as unknown;
                localParsed = parseExamLocalDraft(json);
            }
        } catch (e) {
            console.error("[exam] exam draft JSON.parse failed", key, e);
            localParsed = null;
        }
        const localV = localParsed?.v ?? null;
        const serverV = attempt.version_number ?? null;
        if (localV != null && serverV != null && Number(localV) !== Number(serverV)) {
            // Stale draft; discard to avoid overwriting backend truth.
            localParsed = null;
            try { localStorage.removeItem(key); } catch {}
        }
        const localModId = localParsed?.moduleId ?? null;
        if (!localModId || String(localModId) !== String(attempt.current_module_details.id)) {
            // Draft belongs to a different module (or is legacy/unknown); discard.
            localParsed = null;
        }

        const serverAnswers = normalizeSavedAnswersForForm(
            attempt.current_module_saved_answers ?? undefined,
            "hydrate answers",
        );
        const serverFlagged = normalizeFlaggedList(
            attempt.current_module_flagged_questions ?? undefined,
            "hydrate flagged",
        );

        setAnswers({ ...(localParsed?.answers ?? {}), ...serverAnswers });
        setFlagged(Array.from(new Set([...(localParsed?.flagged ?? []), ...serverFlagged])));
        
        // Mark that the 'answers' state now belongs to this module
        lastAnswersModuleIdRef.current = attempt.current_module_details.id;

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [attempt?.current_module_details?.id, attempt?.version_number]);


    // Persist draft locally for refresh recovery
    useEffect(() => {
        if (!attempt?.current_module_details?.id) return;
        
        // RACE CONDITION GUARD: Only save if the answers in state actually belong to the current module.
        // During transition (M1 -> M2), attempt.id changes first, but answers={} hasn't finished yet.
        // We must NOT save M1 answers into the M2 slot.
        if (lastAnswersModuleIdRef.current !== attempt.current_module_details.id) {
            return;
        }

        const key = `mastersat.examDraft.${attemptId}.${attempt.current_module_details.id}`;
        try {
            localStorage.setItem(key, JSON.stringify({ 
                answers, 
                flagged, 
                v: attempt?.version_number ?? null,
                moduleId: attempt.current_module_details.id
            }));
        } catch {
            /* ignore */
        }
    }, [answers, flagged, attempt?.current_module_details?.id, attempt?.version_number, attemptId]);


    // SCORING polling loop
    useEffect(() => {
        if (!attemptId) return;
        if (attempt?.current_state !== "SCORING") return;
        if (scoringPollRef.current) return;

        let cancelled = false;
        let delayMs = 1200;
        const tick = async () => {
            if (cancelled) return;
            try {
                const st = await examsPublicApi.getAttemptStatus(Number(attemptId));
                if (cancelled) return; // guard against stale response after cleanup
                try {
                    const sn = st.server_now ? new Date(st.server_now).getTime() : NaN;
                    if (Number.isFinite(sn)) serverOffsetMsRef.current = sn - Date.now();
                } catch {}
                mergeAttemptFromServer(st);

                if (st.is_completed && st.current_state === "COMPLETED") {
                    // route based on existing mockFlow logic
                    const meid = searchParams.get('mockExamId');
                    const subj = st.practice_test_details?.subject;
                    if (mockFlow && meid && platformSubjectIsReadingWriting(subj)) {
                        router.push(`/mock/${meid}/break?rwAttempt=${attemptId}`);
                        return;
                    }
                    if (mockFlow && meid && platformSubjectIsMath(subj)) {
                        const rw = searchParams.get('rwAttempt');
                        const qs =
                            rw && rw.length > 0
                                ? `?rwAttempt=${encodeURIComponent(rw)}&mathAttempt=${attemptId}`
                                : `?mathAttempt=${attemptId}`;
                        router.push(`/mock/${meid}/results${qs}`);
                        return;
                    }
                    router.push(`/review/${attemptId}`);
                    return;
                }
                delayMs = 1200;
            } catch (e) {
                if (e instanceof InvalidTestAttemptPayloadError) console.error(e);
                delayMs = Math.min(30_000, Math.floor(delayMs * 1.6));
            }
            scoringPollRef.current = setTimeout(tick, delayMs);
        };
        scoringPollRef.current = setTimeout(tick, 600);
        return () => {
            cancelled = true;
            if (scoringPollRef.current) clearTimeout(scoringPollRef.current);
            scoringPollRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [attempt?.current_state, attemptId, mockFlow, router, searchParams, mergeAttemptFromServer]);

    // Active module polling: refresh backend truth + server_now offset periodically.
    // IMPORTANT: `cancelled` is checked both before AND after the await to prevent a stale
    // in-flight response from overwriting fresh Module-2 state set by handleSubmitModule.
    useEffect(() => {
        if (!attemptId) return;
        if (!attempt?.current_state) return;
        if (attempt.current_state === "SCORING" || attempt.current_state === "COMPLETED") return;
        if (activePollRef.current) return;

        let cancelled = false;
        let delayMs = 10_000;
        const tick = async () => {
            if (cancelled) return;
            try {
                const st = await examsPublicApi.getAttemptStatus(Number(attemptId));

                // Re-check after await: the submit handler may have already advanced the
                // attempt to Module 2 while this request was in-flight.  Without this guard
                // the stale Module-1 response would overwrite the fresh Module-2 state.
                if (cancelled) return;
                try {
                    const sn = st.server_now ? new Date(st.server_now).getTime() : NaN;
                    if (Number.isFinite(sn)) serverOffsetMsRef.current = sn - Date.now();
                } catch {}

                mergeAttemptFromServer(st);

                if (st.is_completed && st.current_state === "COMPLETED") {
                    router.push(`/review/${attemptId}`);
                    return;
                }
                if (st.is_expired) {
                    setLoadError("This module has expired. Please click Retry to sync.");
                    return;
                }
                delayMs = 10_000;
            } catch (e) {
                if (e instanceof InvalidTestAttemptPayloadError) console.error(e);
                delayMs = Math.min(30_000, Math.floor(delayMs * 1.6));
            }
            activePollRef.current = setTimeout(tick, delayMs);
        };

        activePollRef.current = setTimeout(tick, 5000);
        return () => {
            cancelled = true;
            if (activePollRef.current) clearTimeout(activePollRef.current);
            activePollRef.current = null;
        };
    }, [attempt?.current_state, attemptId, router, mergeAttemptFromServer]);

    useEffect(() => {
        if (searchParams.get('midterm') === '1') setMidtermMode(true);
    }, [searchParams]);

    useEffect(() => {
        if (attempt?.practice_test_details?.mock_kind === 'MIDTERM') {
            setMidtermMode(true);
        }
    }, [attempt?.practice_test_details?.mock_kind]);

    useEffect(() => {
        if (midtermMode) {
            setShowCalculator(false);
            setShowReferenceSheet(false);
        }
    }, [midtermMode]);

    useEffect(() => {
        if (mockFlow) setIsPaused(false);
    }, [mockFlow]);

    // Sync pause state from server on initial load / page reload.
    // Only applies when mockFlow is false (pastpapers support pause; mocks do not).
    // We only SET isPaused=true here (not false) to avoid fighting with the
    // button handler's optimistic toggle — the button handler owns the false→true
    // and true→false transitions during an active session.
    useEffect(() => {
        if (mockFlow) return;
        if (attempt?.is_paused) setIsPaused(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mockFlow, attempt?.id]); // Only re-run when the attempt ID changes (new load), not on every poll

    // If the backend delivers a valid active module while the transition overlay is
    // showing, dismiss the overlay early so Module 2 renders immediately.
    // NOTE: `transitioning` is intentionally NOT in the dep array — including it
    // caused the overlay to be cancelled in the same render cycle where it was set
    // (because attempt is still MODULE_1_ACTIVE at that point, satisfying the guard).
    // The functional setter form reads the live value without a stale-closure issue.
    useEffect(() => {
        const st = attempt?.current_state;
        const modOrder = Number(attempt?.current_module_details?.module_order || 0);
        if (
            (st === "MODULE_1_ACTIVE" && modOrder === 1) ||
            (st === "MODULE_2_ACTIVE" && modOrder === 2)
        ) {
            setTransitioning((prev) => (prev ? false : prev));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [attempt?.current_state, attempt?.current_module_details?.module_order]);

    // ── Persistent math rendering ────────────────────────────────────────────
    // Uses a MutationObserver to detect DOM changes and re-render KaTeX math.
    // This replaces the fragile dependency-array approach — any DOM mutation
    // (question navigation, highlights, zoom, etc.) triggers a debounced render.
    useEffect(() => {
        if (loading) return;

        let debounceTimer: ReturnType<typeof setTimeout> | null = null;
        const scheduleRender = () => {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => renderMath({ root: document.body }), 40);
        };

        // Initial render + short-delay follow-up for React two-pass commit
        renderMath({ root: document.body });
        const initTimer = setTimeout(() => renderMath({ root: document.body }), 80);

        // Watch for any DOM subtree changes (question switch, highlight, etc.)
        const observer = new MutationObserver(scheduleRender);
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true,
        });

        // Re-render when KaTeX scripts finish loading (race condition fix)
        const onKatexReady = () => scheduleRender();
        window.addEventListener("katex:ready", onKatexReady);

        return () => {
            if (debounceTimer) clearTimeout(debounceTimer);
            clearTimeout(initTimer);
            observer.disconnect();
            window.removeEventListener("katex:ready", onKatexReady);
        };
    }, [loading, attempt?.current_module_details?.id]);

    // Fullscreen behavior listeners
    useEffect(() => {
        const handleFullscreenChange = () => {
            if (!document.fullscreenElement) {
                setIsFullscreen(false);
                setFullscreenWarningCountdown(10);
            } else {
                setIsFullscreen(true);
                setFullscreenWarningCountdown(null);
            }
        };

        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
    }, []);

    // Warn countdown and kick
    useEffect(() => {
        if (fullscreenWarningCountdown === null) return;
        if (fullscreenWarningCountdown <= 0) {
            router.push('/');
            return;
        }
        const timer = setTimeout(() => {
            setFullscreenWarningCountdown(prev => prev! - 1);
        }, 1000);
        return () => clearTimeout(timer);
    }, [fullscreenWarningCountdown, router]);

    const zoomIn = () => setZoomLevel(prev => Math.min(1.5, prev + 0.1));
    const zoomOut = () => setZoomLevel(prev => Math.max(0.7, prev - 0.1));


    const handleShowPopover = useCallback((targetId: string, e?: React.MouseEvent) => {
        if (!highlighterActive) return;
        const selection = window.getSelection();
        const target = e?.target as HTMLElement;

        if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const rect = range.getBoundingClientRect();
            setAnnotationPopover({
                visible: true,
                x: rect.left + rect.width / 2,
                y: rect.top - 10,
                range: range.cloneRange(),
                targetId,
                markElement: null
            });
        } else if (target && target.tagName === 'MARK') {
            const rect = target.getBoundingClientRect();
            setAnnotationPopover({
                visible: true,
                x: rect.left + rect.width / 2,
                y: rect.top - 10,
                range: null,
                targetId,
                markElement: target
            });
        } else {
            setAnnotationPopover(prev => ({ ...prev, visible: false }));
        }
    }, [highlighterActive]);

    const applyAnnotation = (style: 'yellow' | 'blue' | 'pink' | 'underline' | 'clear') => {
        if (!currentQuestion) return;
        if (!annotationPopover.targetId) return;

        let containerId = '';
        if (annotationPopover.targetId === 'passage') containerId = 'passage-text-container';
        else if (annotationPopover.targetId === 'question') containerId = 'question-content';
        else if (annotationPopover.targetId === 'question-prompt') containerId = 'question-prompt-content';
        else if (annotationPopover.targetId.startsWith('option-')) containerId = `option-content-${annotationPopover.targetId.split('-')[1]}`;

        const container = document.getElementById(containerId);
        if (!container) return;

        if (annotationPopover.markElement) {
            const markNode = annotationPopover.markElement;
            if (style === 'clear') {
                const parent = markNode.parentNode;
                if (parent) {
                    while (markNode.firstChild) parent.insertBefore(markNode.firstChild, markNode);
                    parent.removeChild(markNode);
                }
            } else {
                markNode.className = `annot-${style}`;
                if (style === 'yellow') { markNode.style.cssText = 'background-color: #faed7d; color: #000; text-decoration: none;'; }
                if (style === 'blue') { markNode.style.cssText = 'background-color: #d0e6f5; color: #000; text-decoration: none;'; }
                if (style === 'pink') { markNode.style.cssText = 'background-color: #fae0e0; color: #000; text-decoration: none;'; }
                if (style === 'underline') {
                    markNode.style.cssText = 'background-color: transparent; text-decoration: underline; text-decoration-color: #3b82f6; text-decoration-thickness: 2px;';
                }
            }
        } else if (annotationPopover.range) {
            if (style === 'clear') return;
            const targetRange = annotationPopover.range;

            if (!container.contains(targetRange.commonAncestorContainer)) {
                setAnnotationPopover(prev => ({ ...prev, visible: false }));
                return;
            }

            const mark = document.createElement('mark');
            mark.className = `annot-${style}`;
            if (style === 'yellow') { mark.style.cssText = 'background-color: #faed7d; color: #000; text-decoration: none;'; }
            if (style === 'blue') { mark.style.cssText = 'background-color: #d0e6f5; color: #000; text-decoration: none;'; }
            if (style === 'pink') { mark.style.cssText = 'background-color: #fae0e0; color: #000; text-decoration: none;'; }
            if (style === 'underline') {
                mark.style.cssText = 'background-color: transparent; text-decoration: underline; text-decoration-color: #3b82f6; text-decoration-thickness: 2px;';
            }
            try {
                const fragment = targetRange.extractContents();
                mark.appendChild(fragment);
                targetRange.insertNode(mark);
            } catch (e) {
            }
        }

        if (annotationPopover.targetId === 'passage') {
            setPassageHighlights(prev => ({ ...prev, [currentQuestion.id]: container.innerHTML }));
        } else if (annotationPopover.targetId === 'question') {
            setQuestionHighlights(prev => ({ ...prev, [currentQuestion.id]: container.innerHTML }));
        } else if (annotationPopover.targetId === 'question-prompt') {
            setQuestionPromptHighlights(prev => ({ ...prev, [currentQuestion.id]: container.innerHTML }));
        } else if (annotationPopover.targetId.startsWith('option-')) {
            const optionId = annotationPopover.targetId.split('-')[1];
            setOptionHighlights(prev => ({ ...prev, [optionId]: container.innerHTML }));
        }

        const currentSelection = window.getSelection();
        if (currentSelection) currentSelection.removeAllRanges();
        setAnnotationPopover(prev => ({ ...prev, visible: false }));
    };

    const handleAnnotate = () => {
        // Legacy handleAnnotate removed in favor of handleShowPopover
    };

    const clearHighlights = () => {
        setQuestionHighlights(prev => {
            const newState = { ...prev };
            delete newState[currentQuestion.id];
            return newState;
        });
        setPassageHighlights(prev => {
            const newState = { ...prev };
            delete newState[currentQuestion.id];
            return newState;
        });
        setQuestionPromptHighlights(prev => {
            const newState = { ...prev };
            delete newState[currentQuestion.id];
            return newState;
        });
        setOptionHighlights((prev) => {
            const newState = { ...prev };
            for (const letter of optionLetterKeys(currentQuestion)) {
                delete newState[letter];
            }
            return newState;
        });
    };

    const handleCalcMouseDown = (e: React.MouseEvent) => {
        setIsDragging(true);
        setDragOffset({
            x: e.clientX - calculatorPos.x,
            y: e.clientY - calculatorPos.y
        });
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (isDragging) {
                setCalculatorPos({ x: e.clientX - dragOffset.x, y: e.clientY - dragOffset.y });
            }
            if (isRefDragging) {
                setReferencePos({ x: e.clientX - refDragOffset.x, y: e.clientY - refDragOffset.y });
            }
        };
        const handleMouseUp = () => {
            setIsDragging(false);
            setIsRefDragging(false);
        };

        if (isDragging || isRefDragging) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging, dragOffset, isRefDragging, refDragOffset]);

    const handleSubmitModule = useCallback(async () => {
        if (!attempt || !attempt.current_module_details) return;
        if (multiTabBlocked) return;
        if (submitLockRef.current) return;
        if (!assertCriticalAuth()) {
            return;
        }

        submitLockRef.current = true;
        setLoading(true);
        // Prevent the background polling loop from racing this submit.
        try {
            if (activePollRef.current) clearTimeout(activePollRef.current);
        } catch {}
        activePollRef.current = null;
        
        const attemptIdNum = Number(attemptId);
        const prevOrder =
            attempt.current_module_details.module_order != null
                ? Number(attempt.current_module_details.module_order)
                : 0;
        const currentModId = attempt.current_module_details.id;
        const idem = `submit.${attempt.id}.${currentModId}.v${attempt.version_number}`;

        // --- Self-Healing Utility: apply update and cleanup (already validated TestAttempt) ---
        const applyParsedSubmitResult = (data: TestAttempt) => {
            const nextOrder =
                data.current_module_details?.module_order != null
                    ? Number(data.current_module_details.module_order)
                    : null;
            const nextModId = data.current_module_details?.id ?? null;
            const didModuleChange = Boolean(nextModId && Number(nextModId) !== Number(currentModId));

            // If we are already on M2 or scoring, ensure we transition UI immediately
            // Only route to review when backend explicitly says COMPLETED.
            if (data.is_completed && data.current_state === "COMPLETED") {
                submitLockRef.current = false;
                setLoading(false);
                const meid = searchParams.get("mockExamId");
                const subj = data.practice_test_details?.subject;
                if (mockFlow && meid && platformSubjectIsReadingWriting(subj)) {
                    router.push(`/mock/${meid}/break?rwAttempt=${attemptId}`);
                    return;
                }
                if (mockFlow && meid && platformSubjectIsMath(subj)) {
                    const rw = searchParams.get("rwAttempt");
                    const qs =
                        rw && rw.length > 0
                            ? `?rwAttempt=${encodeURIComponent(rw)}&mathAttempt=${attemptId}`
                            : `?mathAttempt=${attemptId}`;
                    router.push(`/mock/${meid}/results${qs}`);
                    return;
                }
                router.push(`/review/${attemptId}`);
                return;
            }

            if (data.current_state === "SCORING") {
                mergeAttemptFromServer(data);
                setLoading(false);
                submitLockRef.current = false;
                return;
            }

            // If backend says we're in MODULE_2_ACTIVE but payload is missing, immediately re-fetch status.
            // This prevents getting stuck on the loader if an intermediate/stale response arrives.
            if (data.current_state === "MODULE_2_ACTIVE" && !data.current_module_details) {
                mergeAttemptFromServer(data);
                const aid = Number(attemptIdNum);
                setLoading(true);
                setTimeout(async () => {
                    try {
                        const stRec = await examsPublicApi.getAttemptStatus(aid);
                        applyParsedSubmitResult(stRec);
                    } catch {
                        setLoading(false);
                        submitLockRef.current = false;
                    }
                }, 400);
                return;
            }

            // Detect M1 -> M2 transition — show overlay first, apply Module 2 data after.
            // Applying Module 2 data in the same React batch as setTransitioning(true) causes
            // the useEffect at line ~944 to immediately cancel the overlay (because it sees
            // MODULE_2_ACTIVE + transitioning=true in the same render). By delaying the
            // mergeAttemptFromServer call until after the overlay duration, the student
            // sees the "Continuing to Module 2" screen for the full 1.8 s.
            if (didModuleChange && prevOrder === 1 && nextOrder === 2) {
                prevModuleOrderRef.current = 2;
                setTransitioning(true);
                setLoading(false);
                submitLockRef.current = false;
                setTimeout(() => {
                    mergeAttemptFromServer(data);
                    setCurrentQuestionIndex(0);
                    setAnswers({});
                    setFlagged([]);
                    setEliminatedOptions({});
                    setQuestionHighlights({});
                    if (data.current_module_details?.id) {
                        lastAnswersModuleIdRef.current = data.current_module_details.id;
                    }
                    setTransitioning(false);
                    try {
                        const key = `mastersat.examDraft.${attemptId}.${currentModId}`;
                        localStorage.removeItem(key);
                    } catch {}
                }, 1800);
                return;
            }

            // Update attempt state first (backend truth).
            mergeAttemptFromServer(data);

            // Only clear per-module local UI state when we actually moved to a different module.
            // If submit failed or was idempotently ignored, clearing here would "lose answers" in the UI.
            if (didModuleChange) {
                setCurrentQuestionIndex(0);
                setAnswers({});
                setFlagged([]);
                setEliminatedOptions({});
                setQuestionHighlights({});
                setShowAnswerPreview(false);
            }

            if (data.current_module_details?.id) {
                lastAnswersModuleIdRef.current = data.current_module_details.id;
            }

            setLoading(false);
            submitLockRef.current = false;

            // Cleanup persistence only if we moved off this module.
            if (didModuleChange) {
                try {
                    const key = `mastersat.examDraft.${attemptId}.${currentModId}`;
                    localStorage.removeItem(key);
                } catch {}
            }
        };

        // --- Autonomous Recovery: Watchdog ---
        // If the main submit request hangs for > 5s, start polling the status endpoint
        // to see if the backend already finished the job.
        let watchdogActive = true;
        const watchdogTimer = setTimeout(async () => {
            if (!watchdogActive) return;
            try {
                const recoveryData = await examsPublicApi.getAttemptStatus(attemptIdNum);
                const recoveryOrder =
                    recoveryData.current_module_details?.module_order != null
                        ? Number(recoveryData.current_module_details.module_order)
                        : 0;
                if (
                    recoveryOrder > prevOrder ||
                    recoveryData.is_completed ||
                    recoveryData.current_state === "SCORING"
                ) {
                    watchdogActive = false;
                    applyParsedSubmitResult(recoveryData);
                }
            } catch (e) {
                if (e instanceof InvalidTestAttemptPayloadError) console.error(e);
            }
        }, 5000);

        // --- Autonomous Recovery: Retry Loop ---
        const performSubmit = async (attemptCount = 0) => {
            if (!assertCriticalAuth()) {
                watchdogActive = false;
                clearTimeout(watchdogTimer);
                setLoading(false);
                submitLockRef.current = false;
                return;
            }
            try {
                const expected = attempt?.version_number;
                const resp = await examsPublicApi.submitModule(
                    attemptIdNum,
                    answers,
                    flagged,
                    { idempotencyKey: idem, expectedVersionNumber: expected },
                );
                
                watchdogActive = false;
                clearTimeout(watchdogTimer);
                applyParsedSubmitResult(resp);
            } catch (err: unknown) {
                const status = isAxiosError(err) ? err.response?.status : undefined;

                // If 409, the backend is already ahead of us. Use the data in the body.
                if (
                    status === 409 &&
                    isAxiosError(err) &&
                    err.response?.data &&
                    typeof err.response.data === "object" &&
                    err.response.data !== null &&
                    "attempt" in err.response.data
                ) {
                    watchdogActive = false;
                    clearTimeout(watchdogTimer);
                    const rawAttempt = (err.response.data as { attempt?: unknown }).attempt;
                    let conflict: TestAttempt;
                    try {
                        conflict = parseTestAttempt(rawAttempt, "submitModule 409 conflict body");
                    } catch (e) {
                        if (e instanceof InvalidTestAttemptPayloadError) console.error(e);
                        setLoading(false);
                        submitLockRef.current = false;
                        setLoadError(
                            "Received an invalid attempt response from the server. Please click Retry.",
                        );
                        return;
                    }
                    applyParsedSubmitResult(conflict);

                    // If we are still on module 1, retry once with the fresh version_number.
                    // This fixes the common case where background autosave/other tab bumped the version
                    // right before submit, causing a conflict but not applying the transition.
                    try {
                        const st = conflict.current_state;
                        const mo =
                            conflict.current_module_details?.module_order != null
                                ? Number(conflict.current_module_details.module_order)
                                : 0;
                        if (st === "MODULE_1_ACTIVE" && mo === 1) {
                            if (!assertCriticalAuth()) {
                                setLoading(false);
                                submitLockRef.current = false;
                                return;
                            }
                            const newV = conflict.version_number;
                            const newModId = conflict.current_module_details?.id ?? currentModId;
                            const retryIdem = `submit.${attemptIdNum}.${newModId}.v${newV}.retry`;
                            const resp2 = await examsPublicApi.submitModule(
                                attemptIdNum,
                                answers,
                                flagged,
                                { idempotencyKey: retryIdem, expectedVersionNumber: newV },
                            );
                            applyParsedSubmitResult(resp2);
                        }
                    } catch {
                        // If retry fails, release the lock so the user can try again.
                        setLoading(false);
                        submitLockRef.current = false;
                    }
                    return;
                }

                // If temporary error and we haven't recovered yet, retry with backoff
                if (watchdogActive && attemptCount < 4) {
                    const delay = Math.pow(2, attemptCount) * 1000;
                    setTimeout(() => performSubmit(attemptCount + 1), delay);
                } else if (!watchdogActive) {
                    // Recovered via watchdog already
                } else {
                    // Final fallback: try one last status check before giving up
                    try {
                        const finalSnap = await examsPublicApi.getAttemptStatus(attemptIdNum);
                        applyParsedSubmitResult(finalSnap);
                    } catch {
                        setLoading(false);
                        submitLockRef.current = false;
                        setLoadError(
                            `Submit failed.${status ? ` HTTP ${status}.` : ""} ` +
                            `Please click Retry and try submitting again.`,
                        );
                    }
                }
            }
        };

        void performSubmit();
    }, [
        attempt,
        attemptId,
        answers,
        flagged,
        router,
        mockFlow,
        searchParams,
        multiTabBlocked,
        assertCriticalAuth,
        mergeAttemptFromServer,
    ]);

    useEffect(() => {
        timeLeftRef.current = timeLeft;
    }, [timeLeft]);

    useEffect(() => {
        if (!attempt?.current_module_details || !attempt?.current_module_start_time) {
            // Reset timer state when module is not available (e.g. retry/reload)
            // to prevent stale timerReady=true from triggering auto-submit.
            setTimerReady(false);
            return;
        }
        const limitSec = moduleWallClockLimitSec(attempt);
        const remainingFromServer = clampedRemainingFromServer(attempt);

        const startMs = new Date(attempt.current_module_start_time).getTime();
        const nowMs = Date.now() + serverOffsetMsRef.current;
        const computedRemaining = (() => {
            if (!Number.isFinite(startMs)) return null;
            const elapsedSec = Math.floor((nowMs - startMs) / 1000);
            return Math.max(0, limitSec - elapsedSec);
        })();

        const remaining = remainingFromServer ?? computedRemaining ?? limitSec;
        // Align virtual start to the displayed remaining time so rAF timer is stable.
        virtualModuleStartMsRef.current = nowMs - (limitSec - remaining) * 1000;

        lastRenderedSecRef.current = remaining;
        moduleTimerSubmitDoneRef.current = false;
        wasTimerPausedRef.current = false;
        setTimerReady(true);
        setTimeLeft(remaining);
    }, [
        attempt?.current_module_details?.id,
        attempt?.current_module_start_time,
        attempt?.current_module_details?.time_limit_minutes,
        attempt?.module_duration_seconds,
        attempt?.remaining_seconds,
    ]);


    // After resume from pause, realign virtual start so remaining time matches the frozen display (no wall-clock jump).
    useEffect(() => {
        const paused = isPaused && !mockFlow;
        if (!attempt?.current_module_details || !attempt?.current_module_start_time) return;
        const limitSec = moduleWallClockLimitSec(attempt);
        if (wasTimerPausedRef.current && !paused) {
            const rem = timeLeftRef.current;
            const nowMs = Date.now() + serverOffsetMsRef.current;
            virtualModuleStartMsRef.current = nowMs - (limitSec - rem) * 1000;
            lastRenderedSecRef.current = -1;
        }
        wasTimerPausedRef.current = paused;
    }, [
        isPaused,
        mockFlow,
        attempt?.current_module_details?.id,
        attempt?.current_module_details?.time_limit_minutes,
        attempt?.current_module_start_time,
        attempt?.module_duration_seconds,
    ]);

    // rAF-driven timer: checks every frame, updates React only when the whole-second display changes.
    useEffect(() => {
        if (!attempt?.current_module_details || !attempt?.current_module_start_time) return;
        if (isPaused && !mockFlow) return;

        const limitSec = moduleWallClockLimitSec(attempt);
        let rafId = 0;

        const loop = () => {
            const nowMs = Date.now() + serverOffsetMsRef.current;
            const elapsedSec = Math.floor((nowMs - virtualModuleStartMsRef.current) / 1000);
            const remaining = Math.max(0, limitSec - elapsedSec);

            if (lastRenderedSecRef.current !== remaining) {
                lastRenderedSecRef.current = remaining;
                setTimeLeft(remaining);
            }

            if (remaining <= 0) {
                if (!moduleTimerSubmitDoneRef.current && !transitioning && !loading) {
                }
                return;
            }


            rafId = requestAnimationFrame(loop);
        };

        rafId = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(rafId);
    }, [
        attempt?.current_module_details?.id,
        attempt?.current_module_start_time,
        attempt?.current_module_details?.time_limit_minutes,
        attempt?.module_duration_seconds,
        isPaused,
        mockFlow,
        handleSubmitModule,
    ]);

    // Timer auto-submit: only fires after timerReady (state, not ref) so React
    // guarantees timeLeft and timerReady are from the same render snapshot.
    useEffect(() => {
        const isCompleted = !!attempt?.is_completed;
        if (timeLeft <= 0 && timerReady && !moduleTimerSubmitDoneRef.current && !isPaused && !loading && !isCompleted && !transitioning) {
            moduleTimerSubmitDoneRef.current = true;
            void handleSubmitModule();
        }
    }, [timeLeft, timerReady, isPaused, loading, attempt?.is_completed, transitioning, handleSubmitModule]);



    useEffect(() => {
        const moduleId = attempt?.current_module_details?.id;
        if (!moduleId) return;
        // Reset popup whenever module changes (prevents carry-over to Module 2).
        setShowFiveMinuteWarning(false);
        if (warningTimeoutRef.current) clearTimeout(warningTimeoutRef.current);
        warningTimeoutRef.current = null;
        setWarningShownForModule(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [attempt?.current_module_details?.id]);

    useEffect(() => {
        const moduleId = attempt?.current_module_details?.id;
        if (!moduleId) return;
        if (timeLeft <= 300 && timeLeft > 0 && warningShownForModule !== moduleId) {
            setShowFiveMinuteWarning(true);
            setWarningShownForModule(moduleId);
            if (warningTimeoutRef.current) clearTimeout(warningTimeoutRef.current);
            warningTimeoutRef.current = setTimeout(() => {
                setShowFiveMinuteWarning(false);
                warningTimeoutRef.current = null;
            }, 15_000);
        }
    }, [timeLeft, attempt?.current_module_details?.id, warningShownForModule]);

    // Forensic diagnostic logging (throttled)
    useEffect(() => {
        const interval = setInterval(() => {
        }, 5000);
        return () => clearInterval(interval);
    }, [attempt, questions.length, currentQuestionIndex, transitioning, loading]);

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    if (loadError) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center bg-white px-6">
                <h2 className="text-xl font-bold text-slate-900 tracking-tight text-center">Could not open the exam</h2>
                <p className="text-slate-500 font-medium mt-3 text-center max-w-md">{loadError}</p>
                <button
                    type="button"
                    onClick={() => {
                        setLoading(true);
                        setTimerReady(false);
                        setTimeLeft(0);
                        moduleTimerSubmitDoneRef.current = false;
                        setAttempt(null);
                        setReloadNonce((x) => x + 1);
                    }}
                    className="mt-6 inline-flex items-center justify-center rounded-xl bg-emerald-600 px-5 py-3 text-white font-bold hover:bg-emerald-700 transition-colors"
                >
                    Retry
                </button>
            </div>
        );
    }

    // If we are no longer loading and the backend expects an active module, but payload is missing,
    // treat as an error (do not hang on loader). Note: SCORING/COMPLETED intentionally have no module payload.
    if (
        !loading &&
        attempt &&
        !attempt.current_module_details &&
        (attempt.current_state === "MODULE_1_ACTIVE" || attempt.current_state === "MODULE_2_ACTIVE")
    ) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center bg-white px-6">
                <h2 className="text-xl font-bold text-slate-900 tracking-tight text-center">Module failed to load</h2>
                <p className="text-slate-500 font-medium mt-3 text-center max-w-md">
                    The attempt state loaded, but the module payload is missing. This is usually caused by a server-side
                    state/module mismatch or a network interruption.
                </p>
                <button
                    type="button"
                    onClick={() => {
                        setLoading(true);
                        setTimerReady(false);
                        setTimeLeft(0);
                        moduleTimerSubmitDoneRef.current = false;
                        setAttempt(null);
                        setReloadNonce((x) => x + 1);
                    }}
                    className="mt-6 inline-flex items-center justify-center rounded-xl bg-emerald-600 px-5 py-3 text-white font-bold hover:bg-emerald-700 transition-colors"
                >
                    Force refresh
                </button>
            </div>
        );
    }

    if (loading || !attempt || !attempt.current_module_details) {
        // Escape hatch: when we've stopped loading but still have no module
        // payload (e.g. a fresh NOT_STARTED attempt where the engine-start
        // call silently failed), give the student a manual "Start" button
        // instead of an infinite spinner.
        const stuckOnEmptyAttempt = !loading && !!attempt && !attempt.current_module_details;
        if (stuckOnEmptyAttempt) {
            return (
                <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-6 px-10 text-center">
                    <div className="max-w-md w-full">
                        <div className="bg-white p-10 rounded-2xl shadow-lg border border-slate-200">
                            <BookOpen className="w-12 h-12 text-blue-600 mx-auto mb-5" />
                            <h2 className="text-2xl font-extrabold text-slate-900 mb-3 tracking-tight">Ready to start?</h2>
                            <p className="text-slate-500 font-medium mb-6">
                                Press the button below to begin Module 1.
                            </p>
                            <button
                                type="button"
                                onClick={async () => {
                                    if (!assertCriticalAuth()) return;
                                    setLoading(true);
                                    try {
                                        const attemptIdNum = Number(attemptId);
                                        const idem = `start.${attemptIdNum}.manual.${Date.now()}`;
                                        const fresh = await examsPublicApi.startAttemptEngine(attemptIdNum, idem);
                                        mergeAttemptFromServer(fresh);
                                        const status = await examsPublicApi.getAttemptStatus(attemptIdNum);
                                        mergeAttemptFromServer(status);
                                    } catch (e) {
                                        console.error("[exam] manual start failed", e);
                                    } finally {
                                        setLoading(false);
                                    }
                                }}
                                className="w-full bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white font-bold py-4 rounded-xl shadow transition-all"
                            >
                                Start exam
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setLoading(true);
                                    setAttempt(null);
                                    setReloadNonce((x) => x + 1);
                                }}
                                className="w-full mt-3 text-sm font-bold text-slate-500 hover:text-slate-700 py-2"
                            >
                                Reload
                            </button>
                        </div>
                    </div>
                </div>
            );
        }
        return (
            <div className="min-h-screen flex flex-col items-center justify-center bg-white">
                <div className="animate-spin text-blue-600 w-12 h-12 mb-6">
                    <Pause className="w-full h-full" />
                </div>
                <h2 className="text-xl font-bold text-slate-900 tracking-tight">Loading exam...</h2>
                <p className="text-slate-500 font-medium mt-2">Please wait</p>
            </div>
        );
    }

    if (multiTabBlocked) {
        return (
            <AuthGuard>
                <div className="min-h-screen flex items-center justify-center bg-slate-950 text-white px-8">
                    <div className="w-full max-w-xl text-center">
                        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-amber-300">Session conflict</p>
                        <h1 className="mt-4 text-4xl font-black tracking-tight">This attempt is open in another tab</h1>
                        <p className="mt-3 text-slate-300 font-medium">
                            Close the other tab to continue here. This prevents double submits and corrupted state.
                        </p>
                    </div>
                </div>
            </AuthGuard>
        );
    }

    if (attempt?.current_state === "SCORING") {
        return (
            <AuthGuard>
                <div className="min-h-screen flex items-center justify-center bg-slate-950 text-white px-8">
                    <div className="w-full max-w-xl text-center">
                        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-primary">Scoring</p>
                        <h1 className="mt-4 text-4xl font-black tracking-tight">Calculating your score</h1>
                        <p className="mt-3 text-slate-300 font-medium">
                            Do not close this tab. If your connection drops, we will reconnect automatically.
                        </p>
                        <div className="mt-10 flex justify-center">
                            <div className="w-10 h-10 border-4 border-white/25 border-t-white rounded-full animate-spin" />
                        </div>
                    </div>
                </div>
            </AuthGuard>
        );
    }

    if (transitioning) {
        return (
            <AuthGuard>
                <div className="min-h-screen flex items-center justify-center bg-slate-950 text-white px-8">
                    <div className="w-full max-w-xl text-center">
                        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-emerald-400">Success</p>
                        <h1 className="mt-4 text-4xl font-black tracking-tight">Continuing to Module 2</h1>
                        <p className="mt-4 text-slate-400 font-medium text-lg">Great work. The next module is loading automatically.</p>
                        <div className="mt-12 flex justify-center">
                            <div className="w-12 h-12 border-4 border-white/10 border-t-emerald-400 rounded-full animate-spin" />
                        </div>
                    </div>
                </div>
            </AuthGuard>
        );
    }

    const goNext = () => {
        if (isNavigating) return;
        if (currentQuestionIndex < questions.length - 1) {
            setIsNavigating(true);
            setTimeout(() => {
                setCurrentQuestionIndex(currentQuestionIndex + 1);
                setTimeout(() => setIsNavigating(false), 50);
            }, 100);
        }
    };

    const goBack = () => {
        if (isNavigating) return;
        if (currentQuestionIndex > 0) {
            setIsNavigating(true);
            setTimeout(() => {
                setCurrentQuestionIndex(currentQuestionIndex - 1);
                setTimeout(() => setIsNavigating(false), 50);
            }, 100);
        }
    };

    const handleSaveAndExit = async () => {
        if (!assertCriticalAuth()) {
            return;
        }
        try {
            setLoading(true);
            const currentModId = attempt?.current_module_details?.id || "x";
            const ver = attempt?.version_number ?? "v";
            const idemKeyStorage = `mastersat.idem.saveAttempt.${attemptId}.${currentModId}.${ver}`;
            const idem =
                (typeof window !== "undefined" && sessionStorage.getItem(idemKeyStorage)) ||
                `save.${attemptId}.${currentModId}.v${ver}.${randomIdemSegment()}`;
            try {
                sessionStorage.setItem(idemKeyStorage, idem);
            } catch {
                /* ignore */
            }
            await examsPublicApi.saveAttempt(Number(attemptId), answers, flagged, {
                idempotencyKey: idem,
                expectedVersionNumber: attempt?.version_number,
            });
            router.push('/');
        } catch (err) {
            setLoading(false);
        }
    };

    const enterFullScreen = async () => {
        try {
            await document.documentElement.requestFullscreen();
            setIsFullscreen(true);
        } catch (e) {
        }
    };

    if (!isFullscreen && loading === false && !attempt.is_completed) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-6 px-10 text-center relative overflow-hidden">
                {/* Visual Kick Warning overlay */}
                {fullscreenWarningCountdown !== null && (
                    <div className="absolute inset-0 bg-red-600/10 flex items-center justify-center z-50">
                        <div className="bg-white p-10 rounded-2xl shadow-2xl max-w-lg border border-red-200 animate-in zoom-in-95">
                            <AlertCircle className="w-16 h-16 text-red-600 mx-auto mb-6" />
                            <h2 className="text-2xl font-black text-slate-900 mb-3">You left full-screen!</h2>
                            <p className="text-slate-600 font-medium mb-8 text-lg">
                                The exam requires full-screen mode to prevent distractions. You will be removed from the exam in <span className="font-black text-red-600 px-2 py-1 bg-red-100 rounded-lg">{fullscreenWarningCountdown}s</span> if you do not return.
                            </p>
                            <button
                                onClick={enterFullScreen}
                                className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-4 rounded-xl shadow-lg transition-colors text-lg"
                            >
                                Return to Full Screen Now
                            </button>
                        </div>
                    </div>
                )}

                <div className="max-w-xl w-full">
                    <div className="bg-white p-12 rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-200">
                        <BookOpen className="w-16 h-16 text-blue-600 mx-auto mb-8" />
                        <h1 className="text-3xl font-extrabold text-slate-900 mb-4 tracking-tight">Ready to begin?</h1>
                        <p className="text-slate-500 font-medium text-lg leading-relaxed mb-10">
                            This exam must be taken in full-screen mode to simulate standard testing conditions.
                        </p>
                        <button
                            onClick={enterFullScreen}
                            className="w-full bg-blue-600 hover:bg-blue-700 active:scale-[0.98] transition-all text-white font-bold py-5 rounded-2xl text-lg shadow-lg shadow-blue-600/20"
                        >
                            Enter Full Screen & Start
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // Rendering hardening: never crash the whole runner if question payload is temporarily empty/corrupt.
    // This prevents white screens and "kicks" caused by unhandled JS exceptions.
    if (attempt?.current_module_details && (!Array.isArray(questions) || questions.length === 0 || !currentQuestion)) {
        return (
            <AuthGuard>
                <div className="min-h-screen flex flex-col items-center justify-center bg-white px-6 text-center">
                    <h2 className="text-xl font-bold text-slate-900 tracking-tight">Questions failed to render</h2>
                    <p className="mt-3 text-slate-500 font-medium max-w-md">
                        The exam state is loaded, but the question payload is missing or invalid. This can happen after a
                        transient network issue. Click Retry to reload from the server.
                    </p>
                    <button
                        type="button"
                        onClick={() => {
                            setLoading(true);
                            setAttempt(null);
                            setReloadNonce((x) => x + 1);
                        }}
                        className="mt-6 inline-flex items-center justify-center rounded-xl bg-emerald-600 px-5 py-3 text-white font-bold hover:bg-emerald-700 transition-colors"
                    >
                        Retry
                    </button>
                </div>
            </AuthGuard>
        );
    }

    return (
        <AuthGuard>
            {/* Removed zoom: 1.5 to prevent layout breaking/scrolling, scaling fonts via Tailwind instead */}
            <div className={`min-h-screen bg-white flex flex-col font-sans text-slate-900 overflow-hidden relative ${highlighterActive ? 'annotate-mode' : ''}`}>
                {/* 5-minute warning popup (15 seconds) */}
                {showFiveMinuteWarning && (
                    <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[80] w-full max-w-md px-6">
                        <div className="rounded-2xl border border-red-200 bg-white shadow-2xl px-6 py-4">
                            <div className="flex items-start gap-3">
                                <div className="mt-0.5">
                                    <AlertCircle className="w-5 h-5 text-red-600" />
                                </div>
                                <div className="flex-1">
                                    <p className="text-xs font-black uppercase tracking-widest text-red-600">Time warning</p>
                                    <p className="mt-1 text-sm font-bold text-slate-900">Only 5 minutes remaining.</p>
                                    <p className="mt-1 text-xs font-medium text-slate-600">Make sure your answers are saved before time expires.</p>
                                </div>
                                <button
                                    onClick={() => setShowFiveMinuteWarning(false)}
                                    className="p-1 rounded-lg hover:bg-slate-50 text-slate-500"
                                    aria-label="Dismiss"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    </div>
                )}
                <header className="flex items-start justify-between px-6 py-2 bg-white relative z-10 w-full shadow-sm" style={{ zoom: 1.15 }}>
                    {!isOnline ? (
                        <div className="absolute top-0 left-0 right-0 bg-amber-50 border-b border-amber-200 text-amber-900 text-[11px] font-bold py-1 px-3 text-center">
                            Offline. Your answers are kept locally and will sync when you reconnect.
                        </div>
                    ) : null}
                    <div className="flex-1 flex items-center gap-4">
                        <img src="/images/logo.png" alt="Master SAT" className="w-9 h-9 object-contain" />
                        <div>
                            <h1 className="text-sm font-bold text-slate-900 tracking-tight flex items-center gap-1">
                                Section {attemptPtSubjectIsRW(attempt) ? '1' : '2'}, Module {attempt.current_module_details?.module_order || 1}: {attemptPtSubjectIsRW(attempt) ? 'Reading and Writing' : 'Math'}
                            </h1>
                            <button className="text-[11px] font-bold text-slate-700 flex items-center mt-1 border-b border-transparent hover:border-slate-800 pb-0.5">
                                Directions <ChevronDown className="w-3 h-3 ml-1 stroke-[3px]" />
                            </button>
                        </div>
                    </div>

                    <div className="flex-1 flex flex-col items-center">
                        {showTimer ? (
                            <div className="flex flex-col items-center">
                                <span className={`text-lg font-bold font-mono tracking-tight ${isPaused ? 'opacity-40' : ''}`}>
                                    {timerReady ? formatTime(timeLeft) : '--:--'}
                                </span>
                                <div className="flex items-center gap-2 mt-0.5">
                                    {!mockFlow && (
                                    <button
                                        onClick={async () => {
                                            const next = !isPaused;
                                            // Optimistic UI toggle first.
                                            setIsPaused(next);
                                            setPauseResumeError(null);
                                            try {
                                                if (next) {
                                                    // Going INTO pause: hit the server so the
                                                    // deadline freezes there too.
                                                    console.log('[exam] pause: calling server...');
                                                    const upd = await examsPublicApi.pauseAttempt(Number(attemptId));
                                                    console.log('[exam] pause: server ok', { is_paused: upd.is_paused, remaining: upd.remaining_seconds });
                                                    mergeAttemptFromServer(upd);
                                                    // Sync from server — if server says not actually
                                                    // paused (race), correct it.
                                                    setIsPaused(upd.is_paused);
                                                } else {
                                                    // Coming OUT of pause: explicitly realign the
                                                    // virtual timer anchor BEFORE the await so the
                                                    // rAF loop (which restarts on this same React
                                                    // commit) doesn't briefly compute from the
                                                    // stale pre-pause start. Then call the server
                                                    // to bank the elapsed pause window.
                                                    const rem = timeLeftRef.current;
                                                    const limitSec = attempt
                                                        ? moduleWallClockLimitSec(attempt)
                                                        : 0;
                                                    if (limitSec > 0) {
                                                        const nowMs = Date.now() + serverOffsetMsRef.current;
                                                        virtualModuleStartMsRef.current =
                                                            nowMs - (limitSec - rem) * 1000;
                                                    }
                                                    lastRenderedSecRef.current = -1;
                                                    wasTimerPausedRef.current = false;
                                                    console.log('[exam] resume: calling server...', { rem, limitSec });
                                                    const upd = await examsPublicApi.resumePauseAttempt(Number(attemptId));
                                                    console.log('[exam] resume: server ok', { is_paused: upd.is_paused, remaining: upd.remaining_seconds });
                                                    mergeAttemptFromServer(upd);
                                                    // Re-anchor again using the server's authoritative
                                                    // remaining_seconds (handles any clock drift).
                                                    const serverRem = clampedRemainingFromServer(upd);
                                                    if (limitSec > 0 && serverRem != null) {
                                                        const nowMs = Date.now() + serverOffsetMsRef.current;
                                                        virtualModuleStartMsRef.current =
                                                            nowMs - (limitSec - serverRem) * 1000;
                                                        setTimeLeft(serverRem);
                                                    }
                                                    lastRenderedSecRef.current = -1;
                                                    // Sync authoritative pause state from server.
                                                    setIsPaused(upd.is_paused);
                                                }
                                            } catch (e) {
                                                console.error("[exam] pause/resume failed", e);
                                                if (next) {
                                                    // Failed to pause → revert to running.
                                                    setIsPaused(false);
                                                }
                                                // For resume (next=false): do NOT revert isPaused to
                                                // true. Keeping the timer running is far better than
                                                // freezing it. The server will re-sync on next poll.
                                                const errDetail =
                                                    (e as { response?: { data?: { detail?: string; message?: string } } })
                                                        ?.response?.data?.detail ??
                                                    (e as { response?: { data?: { detail?: string; message?: string } } })
                                                        ?.response?.data?.message ??
                                                    (e as { message?: string })?.message ??
                                                    'Unknown error';
                                                console.error('[exam] pause/resume error detail:', errDetail, e);
                                                setPauseResumeError(next ? 'Pause failed — timer is still running.' : `Resume sync failed (${errDetail}). Timer continues.`);
                                            }
                                        }}
                                        className="text-[10px] font-bold text-slate-600 border border-slate-300 rounded-full px-3 py-0.5 hover:bg-slate-50 transition-colors flex items-center gap-1"
                                    >
                                        {isPaused ? <><Play className="w-2.5 h-2.5 inline" /> Resume</> : <><Pause className="w-2.5 h-2.5 inline" /> Pause</>}
                                    </button>
                                    )}
                                    <button
                                        onClick={() => setShowTimer(false)}
                                        className="text-[10px] font-bold text-slate-600 border border-slate-300 rounded-full px-3 py-0.5 hover:bg-slate-50 transition-colors"
                                    >
                                        Hide
                                    </button>
                                </div>
                                {pauseResumeError && (
                                    <p className="text-[10px] text-red-500 mt-1 max-w-[160px] text-center leading-tight">
                                        {pauseResumeError}
                                    </p>
                                )}
                            </div>
                        ) : (
                            <div className="flex flex-col items-center">
                                <button className="p-1 mb-1" onClick={() => setShowTimer(true)}>
                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                                </button>
                                <button
                                    onClick={() => setShowTimer(true)}
                                    className="text-[10px] font-bold text-slate-600 border border-slate-300 rounded-full px-3 py-0.5 hover:bg-slate-50 transition-colors"
                                >
                                    Show
                                </button>
                            </div>
                        )}
                    </div>

                    <div className="flex-1 flex justify-end items-start gap-4 pt-1">
                        <button
                            onClick={zoomOut}
                            disabled={zoomLevel <= 0.7}
                            className={`flex flex-col items-center gap-1 transition-all ${zoomLevel <= 0.7 ? 'text-slate-300' : 'text-slate-600 hover:text-slate-900'}`}
                        >
                            <span className="w-5 h-5 flex items-center justify-center border-2 border-current rounded font-bold text-xs">-</span>
                            <span className="text-[9px] font-bold uppercase tracking-wider">Zoom Out</span>
                        </button>
                        <div className="flex flex-col items-center justify-center">
                            <span className="text-[10px] font-bold text-slate-400 mt-0.5">{Math.round(zoomLevel * 100)}%</span>
                        </div>
                        <button
                            onClick={zoomIn}
                            disabled={zoomLevel >= 1.5}
                            className={`flex flex-col items-center gap-1 transition-all ${zoomLevel >= 1.5 ? 'text-slate-300' : 'text-slate-600 hover:text-slate-900'}`}
                        >
                            <span className="w-5 h-5 flex items-center justify-center border-2 border-current rounded font-bold text-xs">+</span>
                            <span className="text-[9px] font-bold uppercase tracking-wider">Zoom In</span>
                        </button>

                        <div className="w-px h-8 bg-slate-100 mx-1" />

                        <button
                            onClick={() => {
                                const sel = window.getSelection();
                                if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
                                    handleAnnotate();
                                } else {
                                    setHighlighterActive(!highlighterActive);
                                    setIsEliminationMode(false);
                                }
                            }}
                            className={`flex flex-col items-center gap-1 transition-all ${highlighterActive ? 'text-blue-600' : 'text-slate-600 hover:text-slate-900'}`}
                        >
                            <Highlighter className="w-5 h-5 mx-auto stroke-2" />
                            <span className="text-[9px] font-bold uppercase tracking-wider">Annotate</span>
                        </button>

                        {!midtermMode && attemptPtSubjectIsMath(attempt) && (
                            <>
                                <button onClick={() => {
                                    if (!showCalculator) {
                                        setCalculatorPos({ x: 80, y: 100 });
                                    }
                                    setShowCalculator(!showCalculator);
                                }} className={`flex flex-col items-center gap-1 transition-all ${showCalculator ? 'text-blue-600' : 'text-slate-600 hover:text-slate-900'}`}>
                                    <Calculator className="w-5 h-5 mx-auto stroke-2" />
                                    <span className="text-[9px] font-bold uppercase tracking-wider">Calculator</span>
                                </button>
                                <button onClick={() => setShowReferenceSheet(true)} className="flex flex-col items-center gap-1 text-slate-600 hover:text-slate-900 transition-all">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mx-auto"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>
                                    <span className="text-[9px] font-bold uppercase tracking-wider">Reference</span>
                                </button>
                            </>
                        )}
                        
                        <div className="relative">
                            <button
                                onClick={() => setShowMoreMenu(!showMoreMenu)}
                                className="flex flex-col items-center gap-1 text-slate-600 hover:text-slate-900 transition-all ml-2"
                            >
                                <MoreVertical className="w-5 h-5 mx-auto stroke-2" />
                                <span className="text-[9px] font-bold uppercase tracking-wider">More</span>
                            </button>
                            
                            {showMoreMenu && (
                                <>
                                    <div className="fixed inset-0 z-40" onClick={() => setShowMoreMenu(false)} />
                                    <div className="absolute right-0 top-full mt-2 w-48 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden py-1">
                                        <button
                                            type="button"
                                            disabled={!criticalAuthReady}
                                            onClick={handleSaveAndExit}
                                            className="w-full flex items-center px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:pointer-events-none"
                                        >
                                            <Save className="w-4 h-4 mr-3 text-slate-400" />
                                            Save and Exit
                                        </button>
                                        <div className="h-px bg-slate-100 mx-2" />
                                        <button
                                            type="button"
                                            disabled={!criticalAuthReady}
                                            onClick={() => {
                                                setShowMoreMenu(false);
                                                setShowAnswerPreview(true);
                                            }}
                                            className="w-full flex items-center px-4 py-3 text-sm font-bold text-emerald-600 hover:bg-emerald-50 transition-colors disabled:opacity-50 disabled:pointer-events-none"
                                        >
                                            <ChevronRight className="w-4 h-4 mr-3" />
                                            Submit Section
                                        </button>
                                    </div>

                                </>
                            )}
                        </div>
                    </div>
                </header>
                <div className="w-full h-[3px] opacity-100 shrink-0" style={{ background: 'repeating-linear-gradient(to right, #b91c1c 0, #b91c1c 24px, transparent 24px, transparent 28px, #ca8a04 28px, #ca8a04 52px, transparent 52px, transparent 56px, #15803d 56px, #15803d 80px, transparent 80px, transparent 84px, #0f172a 84px, #0f172a 108px, transparent 108px, transparent 112px)' }} />

                {/* Main Content — adaptive layout based on question type */}
                {currentQuestion && (
                    <main className={`flex-1 flex overflow-hidden relative transition-all duration-300 ${isNavigating ? 'opacity-0 scale-[0.99]' : 'opacity-100 scale-100'}`}>

                        {/* LEFT PANE:
                            - Reading/Writing: passage text
                            - SPR (Math input): directions panel
                            - Plain Math: no left pane
                        */}
                        {!showCalculator && attemptPtSubjectIsRW(attempt) ? (                                            
                            <QuestionPane
                                currentQuestion={currentQuestion}
                                zoomLevel={zoomLevel}
                                                highlighterActive={highlighterActive}
                                                passageHtml={passageHighlights[currentQuestion.id]}
                                                handleShowPopover={handleShowPopover}
                                            />
                        ) : currentQuestion.is_math_input ? (
                            <div className="w-1/2 p-0 overflow-hidden border-r border-slate-200 bg-white flex flex-col justify-start shrink-0">
                                <div className="p-4 bg-slate-50 border-b border-slate-200">
                                    <h3 className="text-sm font-bold text-slate-900">Student-Produced Response Directions</h3>
                                </div>
                                <div className="flex-1 overflow-y-auto p-6">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src="/images/spr_directions.png" alt="SPR Directions" className="max-w-full h-auto" />
                                </div>
                            </div>
                        ) : null}
                        {/* RIGHT PANE: always shown, full-width for plain Math */}
                        <RightPane
                            currentQuestion={currentQuestion}
                            currentQuestionIndex={currentQuestionIndex}
                            attempt={attempt}
                            zoomLevel={zoomLevel}
                            highlighterActive={highlighterActive}
                            handleShowPopover={handleShowPopover}
                            questionHighlights={questionHighlights}
                            questionPromptHighlights={questionPromptHighlights}
                            optionHighlights={optionHighlights}
                            answers={answers}
                            setAnswers={setAnswers}
                            eliminatedOptions={eliminatedOptions}
                            setEliminatedOptions={setEliminatedOptions}
                            isEliminationMode={isEliminationMode}
                            setIsEliminationMode={setIsEliminationMode}
                            flagged={flagged}
                            setFlagged={setFlagged}
                            showCalculator={showCalculator}
                        />
                    </main>

                )}


                {/* Question Navigation Drawer */}
                {showNavigation && (
                    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/5[1px] p-4 text-slate-900">
                        <div className="mb-16 mx-auto bg-white max-w-xl w-full rounded-2xl shadow-[0_2px_40px_rgb(0,0,0,0.3)] border border-slate-200 border-t-[6px] border-t-slate-800 overflow-hidden animate-in slide-in-from-bottom-4 duration-200">
                            <div className="px-6 py-4 flex justify-between items-center bg-white border-b border-slate-200">
                                <h2 className="text-base font-bold text-slate-900">
                                    Section {attemptPtSubjectIsRW(attempt) ? '1' : '2'}, Module {attempt.current_module_details.module_order}: {attemptPtSubjectIsRW(attempt) ? 'Reading and Writing' : 'Math'} Questions
                                </h2>
                                <button onClick={() => setShowNavigation(false)} className="text-slate-500 hover:text-slate-800">
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                            
                            <div className="px-6 py-3 bg-white border-b border-slate-200 flex justify-center gap-8 text-[11px] font-bold text-slate-600">
                                <div className="flex items-center gap-1.5">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="10" r="3"/><path d="M12 21.7C17.3 17 20 13 20 10a8 8 0 1 0-16 0c0 3 2.7 7 8 11.7z"/></svg>
                                    Current
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <div className="w-3.5 h-3.5 border-2 border-dashed border-slate-400 bg-white" />
                                    Unanswered
                                </div>

                                <div className="flex items-center gap-1.5">
                                    <Bookmark className="w-3.5 h-3.5 text-red-600 fill-red-600" />
                                    For Review
                                </div>
                            </div>

                            <div className="p-8 max-h-[50vh] overflow-y-auto">
                                <div className="flex flex-wrap gap-[6px] justify-center">
                                    {questions.map((q, idx) => {
                                        const isAnswered = answers[q.id] !== undefined;
                                        const isFlagged = flagged.includes(q.id);
                                        const isCurrent = currentQuestionIndex === idx;

                                        return (
                                            <div key={q.id} className="relative group">
                                                {isCurrent && (
                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="absolute -top-3 -left-1 text-slate-900 z-10"><path d="M12 21.7C17.3 17 20 13 20 10a8 8 0 1 0-16 0c0 3 2.7 7 8 11.7z"/><circle cx="12" cy="10" r="3" fill="white"/></svg>
                                                )}
                                                {isFlagged && (
                                                    <Bookmark className="absolute -top-1 -right-1 w-4 h-4 text-red-600 fill-red-600 z-10" />
                                                )}
                                                <button
                                                    onClick={() => {
                                                        setCurrentQuestionIndex(idx);
                                                        setShowNavigation(false);
                                                    }}
                                                    className={`w-10 h-10 flex flex-col items-center justify-center font-bold text-sm ${isAnswered
                                                        ? 'bg-[#3b5998] text-white border-none'
                                                        : 'bg-white text-[#3b5998] border-[1.5px] border-dashed border-[#3b5998]'
                                                    }`}
                                                >
                                                    {idx + 1}
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                                
                                <div className="mt-8 flex justify-center">
                                    <button 
                                        onClick={() => setShowAnswerPreview(true)}
                                        className="border border-blue-600 text-blue-800 font-bold px-8 py-2 rounded-full hover:bg-blue-50 transition-colors text-sm"
                                    >
                                        Go to Review Page
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
                
                {/* Answer Preview Modal Before Submit */}
                {showAnswerPreview && (
                    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 p-6 animate-in fade-in duration-200">
                        <div className="bg-white w-full max-w-5xl h-[80vh] flex flex-col rounded-[32px] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
                            <div className="px-10 py-8 border-b border-slate-100 flex justify-between items-center bg-white relative z-10">
                                <div>
                                    <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight">Answer Preview</h2>
                                    <p className="text-slate-500 font-medium mt-2">
                                        Review your selected answers before finishing the module. Click any question to return to it.
                                    </p>
                                </div>
                                <button onClick={() => setShowAnswerPreview(false)} className="p-3 rounded-2xl hover:bg-slate-100 transition-colors border border-slate-200">
                                    <X className="w-6 h-6 text-slate-600" />
                                </button>
                            </div>
                            <div className="flex-1 overflow-y-auto p-10 bg-slate-50/50">
                                <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-10 gap-4">
                                    {questions.map((q, idx) => {
                                        const isAnswered = answers[q.id];
                                        const isFlagged = flagged.includes(q.id);

                                        return (
                                            <button
                                                key={q.id}
                                                onClick={() => {
                                                    setCurrentQuestionIndex(idx);
                                                    setShowAnswerPreview(false);
                                                }}
                                                className={`relative flex flex-col items-center justify-center h-20 rounded-2xl border-2 transition-all group hover:-translate-y-1 hover:shadow-lg ${isAnswered
                                                    ? 'border-slate-800 bg-slate-800 text-white'
                                                    : 'border-white bg-white hover:border-blue-200 text-slate-600 shadow-sm'
                                                }`}
                                            >
                                                <span className="text-lg font-bold">{idx + 1}</span>
                                                <span className={`text-[12px] font-bold tracking-widest mt-1 opacity-90 ${!isAnswered ? 'text-slate-400' : ''}`}>
                                                    {isAnswered ? (
                                                        q.is_math_input ? (
                                                            <SprFraction text={isAnswered} />
                                                        ) : isAnswered
                                                    ) : 'Omit'}
                                                </span>
                                                {isFlagged && (
                                                    <Bookmark className="absolute -top-2 -right-2 w-5 h-5 fill-red-500 text-red-500 drop-shadow" />
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                            <div className="px-10 py-6 bg-white border-t border-slate-100 flex justify-between items-center z-10">
                                <div className="flex gap-8">
                                    <div className="flex items-center text-xs font-bold uppercase tracking-widest text-slate-500">
                                        <div className="w-3 h-3 bg-slate-800 rounded mr-2" /> Answered
                                    </div>
                                    <div className="flex items-center text-xs font-bold uppercase tracking-widest text-slate-500">
                                        <div className="w-3 h-3 bg-white border border-slate-200 rounded mr-2" /> Omitted
                                    </div>
                                    <div className="flex items-center text-xs font-bold uppercase tracking-widest text-slate-500">
                                        <Bookmark className="w-3 h-3 text-red-500 fill-red-500 mr-2" /> Flagged
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    disabled={!criticalAuthReady || loading || transitioning}
                                    onClick={handleSubmitModule}
                                    className="bg-emerald-600 text-white font-bold px-10 py-4 rounded-2xl hover:bg-emerald-700 transition-all shadow-xl shadow-emerald-500/20 active:scale-95 text-lg flex items-center gap-3 disabled:opacity-50 disabled:pointer-events-none"
                                >
                                    Confirm Submission
                                    <ChevronRight className="w-5 h-5" />
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Draggable Calculator Modal */}
                {showCalculator && !midtermMode && (
                    <div
                        style={{ position: 'fixed', left: `${calculatorPos.x}px`, top: `${calculatorPos.y}px`, width: `${calcSize.w}px`, height: `${calcSize.h}px`, zIndex: 60, minWidth: '350px', minHeight: '400px', resize: 'both', overflow: 'hidden' }}
                        className="bg-white rounded-2xl shadow-2xl flex flex-col border border-slate-300 pb-3 pr-3"
                        onMouseUp={(e) => {
                            // Track if resize handles are used
                            const target = e.currentTarget as HTMLDivElement;
                            if (target.style.width && target.style.height) {
                                setCalcSize({ w: parseInt(target.style.width), h: parseInt(target.style.height) });
                            }
                        }}
                    >
                        <div
                            onMouseDown={handleCalcMouseDown}
                            className="px-4 py-3 flex justify-between items-center bg-[#222] text-white cursor-move"
                        >
                            <div className="flex items-center gap-2">
                                <Calculator className="w-4 h-4 text-white/80" />
                                <span className="text-sm font-bold tracking-wide">Desmos Calculator</span>
                            </div>
                            <button onClick={() => setShowCalculator(false)} className="px-3 py-1 bg-transparent border border-slate-600 rounded text-[11px] font-bold hover:bg-slate-800 transition-colors flex items-center gap-1.5">
                                Close
                                <X className="w-3.5 h-3.5" />
                            </button>
                        </div>
                        <div className="flex-1 bg-white relative w-full h-full">
                            <iframe
                                src="https://www.desmos.com/testing/cb-digital-sat/graphing"
                                className="absolute inset-0 w-full h-full border-none rounded-b-xl"
                                title="Calculator"
                                style={{ pointerEvents: isDragging ? 'none' : 'auto' }}
                            />
                        </div>
                    </div>
                )}

                {/* Reference Sheet Modal */}
                {showReferenceSheet && !midtermMode && (
                    <div
                        style={{ position: 'fixed', left: `${referencePos.x}px`, top: `${referencePos.y}px`, width: '800px', zIndex: 60 }}
                        className="bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col border border-slate-300"
                    >
                        <div
                            onMouseDown={(e: React.MouseEvent) => {
                                setIsRefDragging(true);
                                setRefDragOffset({ x: e.clientX - referencePos.x, y: e.clientY - referencePos.y });
                            }}
                            className="px-4 py-3 flex justify-between items-center bg-[#222] text-white cursor-move"
                        >
                            <span className="text-sm font-bold tracking-wide">Reference Sheet</span>
                            <button onClick={() => setShowReferenceSheet(false)} className="px-3 py-1 bg-transparent border border-slate-600 rounded text-[11px] font-bold hover:bg-slate-800 transition-colors flex items-center gap-1.5">
                                Collapse
                                <X className="w-3.5 h-3.5" />
                            </button>
                        </div>
                        <div className="p-4 max-h-[800px] overflow-y-auto bg-white flex justify-center">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src="/images/reference_sheet.png" alt="Reference Sheet" className="max-w-full h-auto" />
                        </div>
                    </div>
                )}

                {/* Annotation Popover */}
                {annotationPopover.visible && highlighterActive && (
                    <div 
                        onMouseDown={(e) => e.preventDefault()}
                        className="fixed z-[100] bg-[#ebf0f7] p-2 rounded-xl shadow-[0_5px_20px_rgba(0,0,0,0.15)] flex items-center gap-2 border border-slate-300 animate-in fade-in zoom-in-95 duration-150"
                        style={{ 
                            left: `${annotationPopover.x}px`, 
                            top: `${annotationPopover.y}px`,
                            transform: 'translate(-50%, -100%)'
                        }}
                    >
                        <button onClick={() => applyAnnotation('yellow')} className="w-8 h-8 rounded-full bg-[#faed7d] border border-slate-400/30 shadow-inner hover:scale-110 transition-transform" />
                        <button onClick={() => applyAnnotation('blue')} className="w-8 h-8 rounded-full bg-[#d0e6f5] border border-slate-400/30 shadow-inner hover:scale-110 transition-transform" />
                        <button onClick={() => applyAnnotation('pink')} className="w-8 h-8 rounded-full bg-[#fae0e0] border border-slate-400/30 shadow-inner hover:scale-110 transition-transform" />
                        
                        <div className="w-[1px] h-6 bg-slate-300 mx-1" />
                        
                        <button 
                            onClick={() => applyAnnotation('underline')}
                            className="p-1 px-2.5 bg-white border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 transition-colors flex items-center gap-1 font-bold text-xs"
                        >
                            <span className="underline text-base leading-none">U</span>
                        </button>

                        <button 
                            onClick={() => applyAnnotation('clear')}
                            className="p-2 bg-white border border-slate-300 rounded-lg text-slate-400 hover:text-red-500 hover:border-red-200 transition-colors"
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                    </div>
                )}

                {/* Footer Controls */}
                <footer className="h-11 bg-white relative px-8 flex items-center justify-between border-t border-slate-200 sticky bottom-0 z-10 w-full overflow-hidden" style={{ zoom: 1.15 }}>
                    {/* Decorative Color Bar - Dashed Pattern */}
                    <div 
                        className="absolute top-0 left-0 right-0 h-[3px] w-full" 
                        style={{ 
                            background: 'repeating-linear-gradient(to right, #b91c1c 0, #b91c1c 48px, transparent 48px, transparent 54px, #ca8a04 54px, #ca8a04 102px, transparent 102px, transparent 108px, #15803d 108px, #15803d 156px, transparent 156px, transparent 162px, #0f172a 162px, #0f172a 210px, transparent 210px, transparent 216px)' 
                        }}
                    ></div>

                    <div className="flex-1 flex items-center">
                        <span className="text-sm font-bold text-black uppercase tracking-tight">
                            {attempt?.student_details?.first_name} {attempt?.student_details?.last_name ?? ""}
                        </span>
                    </div>

                    {/* Nav Pill — moved to bottom */}
                    <div className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2">
                        {currentQuestion && (
                            <button
                                onClick={() => setShowNavigation(true)}
                                className="flex items-center gap-2 bg-[#222] text-white px-6 py-1.5 rounded-[4px] font-bold text-xs hover:bg-[#333] transition-all shadow-[0_2px_10px_rgb(0,0,0,0.15)] tracking-wide"
                            >
                                Question {currentQuestionIndex + 1} of {questions.length}
                                <ChevronUp className="w-3.5 h-3.5 stroke-[3px]" />
                            </button>
                        )}
                    </div>

                    <div className="flex justify-end gap-3 flex-1">
                        {currentQuestionIndex > 0 && (
                            <button
                                onClick={goBack}
                                disabled={isNavigating}
                                className={`flex items-center gap-1 font-bold px-6 py-1.5 rounded-full border-2 border-slate-800 text-blue-900 bg-white hover:bg-slate-100 transition-all text-xs active:scale-[0.92] ${isNavigating ? 'opacity-50 pointer-events-none' : ''}`}
                            >
                                Back
                            </button>
                        )}

                        {currentQuestionIndex < questions.length - 1 ? (
                                <button
                                    onClick={goNext}
                                    disabled={isNavigating}
                                    className={`flex items-center gap-1 bg-[#2563eb] text-white font-bold px-6 py-1.5 rounded-full hover:bg-blue-700 transition-all shadow text-xs active:scale-[0.92] ${isNavigating ? 'opacity-50 pointer-events-none' : ''}`}
                                >
                                    Next
                                </button>
                        ) : (
                            <button
                                onClick={() => setShowAnswerPreview(true)}
                                className={`bg-[#2563eb] text-white font-bold px-6 py-1.5 rounded-full hover:bg-blue-700 transition-all shadow text-xs active:scale-[0.92] ${isNavigating ? 'opacity-50 pointer-events-none' : ''}`}
                            >
                                Submit
                            </button>
                        )}

                    </div>
                </footer>
            </div>

            <style jsx global>{`
                .annot-yellow { background-color: #faed7d !important; color: #000 !important; }
                .annot-blue { background-color: #d0e6f5 !important; color: #000 !important; }
                .annot-pink { background-color: #fae0e0 !important; color: #000 !important; }
                .annot-underline { 
                    background-color: transparent !important; 
                    text-decoration: underline !important; 
                    text-decoration-color: #3b82f6 !important;
                    text-decoration-thickness: 2px !important;
                    text-underline-offset: 3px !important;
                }
                .annotate-mode *::selection { background-color: #3b82f640; }
                /* MathJax/KaTeX nodes sometimes disable selection; allow highlighting while Annotate is on */
                .annotate-mode .mathjax-process,
                .annotate-mode .mathjax-process *,
                .annotate-mode .katex,
                .annotate-mode .katex * {
                    -webkit-user-select: text !important;
                    user-select: text !important;
                }
            `}</style>
        </AuthGuard>
    );
}

export default function ExamPlayerPage() {
    return (
        <Suspense
            fallback={
                <div className="min-h-screen flex items-center justify-center bg-white">
                    <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
                </div>
            }
        >
            <ExamPlayerInner />
        </Suspense>
    );
}
