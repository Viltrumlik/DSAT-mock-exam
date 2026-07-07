"use client";
import React, { useMemo, useState, useEffect } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { examsStudentApi } from "@/features/examsStudent/api";
import AuthGuard from '@/components/AuthGuard';
import { CheckCircle2, XCircle, ArrowLeft, BarChart3, Eye, EyeOff, X, ChevronRight, BookOpen, AlertCircle, Lock, ArrowUp, ArrowDown, Trophy } from 'lucide-react';
import { MathText } from '@/components/MathText';
import { spawnRipple } from "@/features/classroom/ui/ripple";

const examsPublicApi = examsStudentApi;

interface QuestionReviewModalProps {
    question: any;
    showCorrectAnswers: boolean;
    onClose: () => void;
    onNext?: () => void;
    onPrevious?: () => void;
}

const QuestionReviewModal = ({ question, showCorrectAnswers, onClose, onNext, onPrevious }: QuestionReviewModalProps) => {
    if (!question) return null;

    // Unanswered question — labelled "Omitted" (not "Incorrect") in the header.
    const isOmitted = !question.student_answer || String(question.student_answer).trim() === "";

    const getImageUrl = (path: string | null | undefined) => {
        if (!path) return undefined;
        if (path.startsWith('http')) return path;
        const baseUrl = process.env.NEXT_PUBLIC_API_URL?.replace('/api', '') || '';
        return `${baseUrl}${path}`;
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-10 animate-in fade-in duration-200">
            <div className="absolute inset-0 bg-foreground/40" onClick={onClose} />
            <div className="bg-card w-full max-w-7xl h-[92vh] rounded-[24px] shadow-2xl overflow-hidden flex flex-col relative animate-in zoom-in-95 duration-200">
                {/* Modal Header */}
                <div className="px-8 py-5 border-b border-border flex justify-between items-center bg-card shrink-0">
                    <div className="flex items-center gap-4">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center border ${question.is_correct ? 'bg-emerald-50 border-emerald-100 text-emerald-600' : 'bg-red-50 border-red-100 text-red-500'}`}>
                            {question.is_correct ? <CheckCircle2 className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
                        </div>
                        <div>
                            <h2 className={`text-lg font-bold ${question.is_correct ? 'text-emerald-700' : 'text-red-700'}`}>Question {question.index_in_module}</h2>
                            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{question.type} · {question.is_correct ? 'Correct' : isOmitted ? 'Omitted' : 'Incorrect'}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-xl hover:bg-surface-2 transition-colors border border-border">
                        <X className="w-5 h-5 text-muted-foreground" />
                    </button>
                </div>

                {/* Modal Body */}
                <div className="flex-1 overflow-hidden flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-border">
                    {/* Left Pane: Question Content */}
                    <div className="md:w-3/5 p-8 md:p-10 overflow-y-auto bg-card">
                        <div className="max-w-none text-foreground font-[Georgia] leading-relaxed text-base">
                            {question.image && (
                                <div className="mb-6 rounded-xl overflow-hidden border border-border bg-surface-2 flex justify-center">
                                    <img
                                        src={getImageUrl(question.image)}
                                        alt="Question figure"
                                        className="max-w-full h-auto max-h-[450px] object-contain p-4"
                                    />
                                </div>
                            )}
                            <MathText
                                text={question.text || "Question text missing"}
                                block
                                className="bg-surface-2 p-6 rounded-2xl border border-border text-foreground leading-normal"
                            />
                        </div>
                    </div>

                    {/* Right Pane: Analysis */}
                    <div className="md:w-2/5 p-8 md:p-10 bg-surface-2/30 overflow-y-auto space-y-8">
                        {question.question_prompt && (
                            <div>
                                <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3 flex items-center">
                                    <BookOpen className="w-3 h-3 mr-2" /> Question Prompt
                                </h3>
                                <MathText
                                    text={question.question_prompt}
                                    block
                                    className="font-[Georgia] text-foreground leading-relaxed border-l-4 border-primary pl-5 py-1 text-base font-medium"
                                />
                            </div>
                        )}

                        <div>
                            <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-5 flex items-center">
                                <AlertCircle className="w-3 h-3 mr-2" /> Answer Analysis
                            </h3>

                            {!question.is_math_input ? (
                                <div className="space-y-3">
                                    {Object.entries(question.options || {}).map(([key, val]) => {
                                        // Normalise both sides so "D" vs "d" vs trailing spaces
                                        // can't make the green/red highlight disappear.
                                        const ans = String(question.student_answer ?? "").trim().toLowerCase();
                                        const corr = String(question.correct_answers ?? "").trim().toLowerCase();
                                        const k = String(key).trim().toLowerCase();
                                        const isStudent = ans !== "" && ans === k;
                                        const isCorrect = corr !== "" && corr === k;

                                        let boxStyle = "border-border bg-card text-foreground";
                                        let icon = null;

                                        if (showCorrectAnswers && isCorrect) {
                                            boxStyle = "border-emerald-500 bg-emerald-50 text-emerald-900 font-bold";
                                            icon = <CheckCircle2 className="w-4 h-4 text-emerald-600 ml-auto" />;
                                        } else if (isStudent) {
                                            if (showCorrectAnswers && !isCorrect) {
                                                boxStyle = "border-red-400 bg-red-50 text-red-900 font-bold";
                                                icon = <XCircle className="w-4 h-4 text-red-600 ml-auto" />;
                                            } else if (!showCorrectAnswers) {
                                                boxStyle = "border-border bg-surface-2 text-foreground font-bold";
                                            }
                                        }

                                        return (
                                            <div key={key} className={`flex items-center p-4 rounded-xl border-2 transition-all ${boxStyle}`}>
                                                <div className={`w-7 h-7 rounded-lg border-2 flex items-center justify-center font-bold text-xs shrink-0 mr-4 ${showCorrectAnswers && isCorrect ? 'bg-emerald-500 border-emerald-500 text-white' : isStudent && showCorrectAnswers ? 'bg-red-500 border-red-500 text-white' : isStudent ? 'bg-primary border-primary text-primary-foreground' : 'border-border text-muted-foreground'}`}>
                                                    {key}
                                                </div>
                                                <div className="font-[Georgia] text-sm w-full">
                                                    {typeof val === 'object' && val !== null && (val as any).image ? (
                                                        <div className="py-1">
                                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                                            <img
                                                                src={getImageUrl((val as any).image)}
                                                                alt={`Option ${key}`}
                                                                className="max-w-full h-auto max-h-[150px] object-contain rounded-lg border border-border bg-card"
                                                            />
                                                        </div>
                                                    ) : (
                                                        <MathText
                                            text={(typeof val === "object" && val !== null ? (val as any).text : (val as string)) || ""}
                                            className="text-sm leading-relaxed"
                                        />
                                                    )}
                                                </div>
                                                {icon}
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <div className={`p-5 rounded-xl border-2 ${showCorrectAnswers && question.is_correct ? 'border-emerald-500 bg-emerald-50' : showCorrectAnswers && !question.is_correct ? 'border-red-400 bg-red-50' : 'border-border bg-surface-2'}`}>
                                        <p className="text-[10px] uppercase font-bold text-muted-foreground mb-1">Your Answer</p>
                                        <div className="flex items-center justify-between">
                                            <p className={`text-xl font-bold ${showCorrectAnswers && question.is_correct ? 'text-emerald-700' : showCorrectAnswers && !question.is_correct ? 'text-red-700' : 'text-foreground'}`}>{question.student_answer || 'Omitted'}</p>
                                            {showCorrectAnswers && (question.is_correct ? <CheckCircle2 className="w-6 h-6 text-emerald-600" /> : <XCircle className="w-6 h-6 text-red-600" />)}
                                        </div>
                                    </div>
                                    {showCorrectAnswers && (
                                        <div className="p-5 rounded-xl border-2 border-foreground bg-foreground text-background shadow-lg">
                                            <p className="text-[10px] uppercase font-bold opacity-70 mb-1">Correct Answer(s)</p>
                                            <p className="text-xl font-bold">{question.correct_answers}</p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {showCorrectAnswers && question.explanation && (
                            <div className="bg-primary/5 p-6 rounded-2xl border border-primary/15">
                                <h4 className="text-[10px] font-bold text-primary uppercase tracking-widest mb-3">Explanation</h4>
                                <MathText
                                    text={question.explanation}
                                    block
                                    className="text-foreground font-[Georgia] leading-relaxed text-sm"
                                />
                            </div>
                        )}
                    </div>
                </div>

                {/* Modal Footer */}
                <div className="px-8 py-4 border-t border-border bg-card flex justify-end items-center gap-3 shrink-0">
                    <button
                        onClick={onPrevious}
                        disabled={!onPrevious}
                        className={`flex items-center gap-2 font-bold px-8 py-2 rounded-full border-2 transition-all text-sm ${onPrevious ? 'border-foreground text-foreground bg-card hover:bg-surface-2 active:scale-95' : 'text-muted-foreground border-border cursor-not-allowed'}`}
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back
                    </button>
                    <button
                        onClick={onNext}
                        disabled={!onNext}
                        className={`flex items-center gap-2 font-bold px-8 py-2 rounded-full transition-all text-sm shadow-md ${onNext ? 'bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95' : 'bg-muted text-muted-foreground cursor-not-allowed'}`}
                    >
                        Next
                        <ChevronRight className="w-4 h-4" />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default function ReviewPage() {
    const { attemptId } = useParams();
    const router = useRouter();
    const [review, setReview] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [selectedQuestion, setSelectedQuestion] = useState<any>(null);
    const [showCorrectAnswers, setShowCorrectAnswers] = useState(true);
    const [showCelebration, setShowCelebration] = useState(false);
    // Active module tab + whether to replay the row slide-in on tab change.
    const [activeModule, setActiveModule] = useState(0);
    const [animRows, setAnimRows] = useState(false);

    // 3-cannon popper burst + falling confetti rain, ported 1:1 from the
    // Results mockup. Math.random() is fine here — this is page runtime, not a
    // deterministic workflow script. Colours are decorative confetti pigment,
    // not UI chrome, so literal hex is acceptable for the pieces themselves.
    const celebration = useMemo(() => {
        const poppers: any[] = [];
        const confetti: any[] = [];
        const cols = ['#2563eb', '#16a34a', '#eab308', '#ef4444', '#a855f7', '#ec4899', '#14b8a6'];
        // three cannons: bottom-left, bottom-right, bottom-center
        const cannons = [
            { x: 6, y: 96, ang: -62 },
            { x: 94, y: 96, ang: -118 },
            { x: 50, y: 100, ang: -90 },
        ];
        const waves = [0, 0.7, 1.4, 2.1];
        let idx = 0;
        cannons.forEach((cn) => {
            waves.forEach((wd) => {
                for (let i = 0; i < 14; i++) {
                    const spread = (Math.random() - 0.5) * 70;
                    const ang = ((cn.ang + spread) * Math.PI) / 180;
                    const power = 240 + Math.random() * 230;
                    const fx = Math.cos(ang) * power;
                    const fy = Math.sin(ang) * power + (160 + Math.random() * 220);
                    poppers.push({
                        id: `p${idx}`,
                        left: cn.x,
                        top: cn.y,
                        width: 6 + Math.floor(Math.random() * 5),
                        height: 8 + Math.floor(Math.random() * 8),
                        color: cols[idx % cols.length],
                        fx: `${fx.toFixed(0)}px`,
                        fy: `${fy.toFixed(0)}px`,
                        rot: `${(Math.random() * 1080 - 540).toFixed(0)}deg`,
                        duration: 1.4 + Math.random() * 1.0,
                        delay: wd + Math.random() * 0.25,
                    });
                    idx++;
                }
            });
        });
        // falling confetti rain from above
        for (let i = 0; i < 80; i++) {
            confetti.push({
                id: `c${i}`,
                left: Math.random() * 100,
                delay: Math.random() * 1.4,
                duration: 2.0 + Math.random() * 1.3,
                color: cols[i % cols.length],
                width: 6 + Math.round(Math.random() * 5),
                height: 8 + Math.round(Math.random() * 8),
            });
        }
        return { poppers, confetti };
    }, []);

    const searchParams = useSearchParams();
    // Where the back button returns to. Callers (e.g. /pastpapers) pass ?back=…;
    // restricted to internal paths to avoid open redirects. Defaults to the dashboard.
    const backParam = searchParams.get('back');
    const backTarget = backParam && backParam.startsWith('/') && !backParam.startsWith('//') ? backParam : '/';
    const moduleId = searchParams.get('module_id');
    // ?q=N deep-link: open the Nth question (1-indexed) on load
    const qParam = searchParams.get('q');

    useEffect(() => {
        const fetchReview = async () => {
            try {
                const data = await examsPublicApi.getReview(Number(attemptId), moduleId ? Number(moduleId) : undefined);
                setReview(data);
                setLoading(false);
            } catch (err) {
                console.error(err);
            }
        };
        fetchReview();
    }, [attemptId, moduleId]);

    // Auto-open question from ?q= param once review data is loaded
    useEffect(() => {
        if (!review || !qParam) return;
        const targetIdx = parseInt(qParam, 10) - 1; // convert to 0-indexed
        if (!Number.isFinite(targetIdx) || targetIdx < 0) return;
        const allQs: any[] = [];
        (review.module_results || []).forEach((m: any) => {
            m.questions.forEach((q: any, i: number) => {
                allQs.push({ ...q, index_in_module: i + 1 });
            });
        });
        if (targetIdx < allQs.length) {
            setSelectedQuestion(allQs[targetIdx]);
        }
    }, [review, qParam]);

    // Keep the active module tab in range whenever the result set changes.
    useEffect(() => {
        if (!review?.module_results?.length) return;
        setActiveModule((prev) => (prev < review.module_results.length ? prev : 0));
    }, [review]);

    useEffect(() => {
        if (!attemptId) return;
        const key = `celebration_seen_attempt_${attemptId}`;
        if (!localStorage.getItem(key)) {
            setShowCelebration(true);
            localStorage.setItem(key, '1');
            const timer = setTimeout(() => setShowCelebration(false), 5000);
            return () => clearTimeout(timer);
        }
    }, [attemptId]);

    // Math rendering is now handled by MathText per-element useEffect calls.
    // The previous document.body-level renderMathInElement + MathJax retry
    // block has been removed — it is redundant and raced against MathText.

    if (loading || !review) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background">
                <div className="animate-spin text-primary w-8 h-8">
                    <BarChart3 className="w-full h-full" />
                </div>
            </div>
        );
    }

    if (review?.score_only && review?.released === false) {
        return (
            <AuthGuard>
                <div className="min-h-screen flex items-center justify-center bg-background px-6 text-center">
                    <div className="max-w-md">
                        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                            <Lock className="h-7 w-7" />
                        </div>
                        <h1 className="text-2xl font-bold text-foreground">Results not released yet</h1>
                        <p className="mt-2 text-sm text-muted-foreground">You’ve submitted this midterm. Your teacher will release your score soon — check the Midterm page.</p>
                        <button onClick={() => router.push("/midterm")} className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-white hover:bg-[var(--primary-hover)]">
                            Back to midterms
                        </button>
                    </div>
                </div>
            </AuthGuard>
        );
    }

    return (
        <AuthGuard>
            <div className="min-h-screen bg-background relative pb-20" style={{ fontFamily: "var(--font-plus-jakarta), system-ui, sans-serif" }}>
                <header className="bg-card border-b border-border px-8 py-4 flex justify-between items-center sticky top-0 z-40 shadow-sm">
                    <div className="flex items-center">
                        <button onPointerDown={spawnRipple} onClick={() => router.push(backTarget)} className="cr-ripple cr-press mr-6 p-2 rounded-xl hover:bg-surface-2 transition-all border border-border shadow-sm">
                            <ArrowLeft className="w-4 h-4 text-muted-foreground" />
                        </button>
                        <div className="flex items-center gap-3 border-l border-border pl-6 ml-1">
                            <img src="/images/logo.png" alt="Master SAT" className="w-8 h-8 object-contain" />
                            <h1 className="text-xl font-extrabold tracking-tight text-foreground uppercase">Master SAT</h1>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onPointerDown={spawnRipple}
                            onClick={() => setShowCorrectAnswers(!showCorrectAnswers)}
                            className={`cr-ripple cr-press flex items-center gap-2 px-4 py-2 rounded-xl transition-all border shadow-sm font-bold text-xs uppercase tracking-wider ${showCorrectAnswers ? 'bg-surface-2 text-muted-foreground border-border hover:bg-muted' : 'bg-foreground text-background border-foreground shadow-md hover:opacity-90'}`}
                        >
                            {showCorrectAnswers ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            {showCorrectAnswers ? 'Hide Answers' : 'Show Answers'}
                        </button>
                        <button
                            onPointerDown={spawnRipple}
                            onClick={() => {
                                setShowCelebration(true);
                                setTimeout(() => setShowCelebration(false), 5000);
                            }}
                            className="cr-ripple cr-press flex items-center gap-2 px-4 py-2 rounded-xl transition-all border shadow-sm font-bold text-xs uppercase tracking-wider bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-200"
                        >
                            Celebration
                        </button>
                    </div>
                </header>

                {showCelebration && (
                    <div className="pointer-events-none fixed inset-0 z-[120] overflow-hidden">
                        {/* 3-cannon popper burst (bottom-left / bottom-right / bottom-center) */}
                        {celebration.poppers.map((p) => (
                            <span
                                key={p.id}
                                className="cr-popper"
                                style={{
                                    left: `${p.left}%`,
                                    top: `${p.top}%`,
                                    width: `${p.width}px`,
                                    height: `${p.height}px`,
                                    backgroundColor: p.color,
                                    animationDuration: `${p.duration}s`,
                                    animationDelay: `${p.delay}s`,
                                    '--fx': p.fx,
                                    '--fy': p.fy,
                                    '--rot': p.rot,
                                } as React.CSSProperties}
                            />
                        ))}
                        {/* Falling confetti rain */}
                        {celebration.confetti.map((c) => (
                            <span
                                key={c.id}
                                className="cr-confetti"
                                style={{
                                    left: `${c.left}%`,
                                    top: `-4%`,
                                    width: `${c.width}px`,
                                    height: `${c.height}px`,
                                    backgroundColor: c.color,
                                    animationDuration: `${c.duration}s`,
                                    animationDelay: `${c.delay}s`,
                                }}
                            />
                        ))}
                    </div>
                )}

                <main className="max-w-6xl mx-auto px-8 py-10">
                    {/* Historical snapshot provenance banner */}
                    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card px-5 py-3 shadow-sm">
                        <div className="flex items-center gap-2.5">
                            <Lock className="h-4 w-4 text-muted-foreground shrink-0" />
                            <div>
                                <p className="text-xs font-extrabold text-foreground uppercase tracking-wider">
                                    Historical snapshot
                                </p>
                                <p className="text-[11px] text-muted-foreground mt-0.5">
                                    Your answers and grading are permanently preserved.
                                    This record cannot be altered.
                                </p>
                            </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                            {review.submitted_at && (
                                <span className="font-semibold">
                                    Submitted:{" "}
                                    {new Date(review.submitted_at).toLocaleDateString("en-US", {
                                        year: "numeric",
                                        month: "long",
                                        day: "numeric",
                                    })}
                                </span>
                            )}
                            {review.attempt_id && (
                                <span className="font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                                    #{review.attempt_id}
                                </span>
                            )}
                            <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wide">
                                <Lock className="h-2.5 w-2.5" />
                                Immutable
                            </span>
                        </div>
                    </div>

                    {/* Hero Summary — gradient score banner */}
                    {(() => {
                        const subjectLabel =
                            review.subject === "READING_WRITING"
                                ? "Reading & Writing"
                                : review.subject === "MATH"
                                ? "Math"
                                : "Score";
                        const scoreLabel =
                            review.mock_kind === "MOCK_SAT" && review.subject === "READING_WRITING"
                                ? "Reading & Writing Score"
                                : review.mock_kind === "MOCK_SAT" && review.subject === "MATH"
                                ? "Math Score"
                                : "Score";
                        const scoreMax =
                            review.mock_kind === "MOCK_SAT"
                                ? "/ 800 Max"
                                : review.score_only
                                ? (review.scoring_scale === "SCALE_800" ? "/ 800 Max" : "/ 100")
                                : `/ ${review.total_questions} questions`;
                        const delta = review.score_delta;
                        return (
                            <div className="cr-celebpop relative mb-10 overflow-hidden rounded-3xl bg-gradient-to-br from-primary to-primary-hover p-10 text-primary-foreground shadow-xl">
                                {/* soft glow + watermark trophy */}
                                <div className="pointer-events-none absolute -right-10 -top-10 h-52 w-52 rounded-full bg-white/5" />
                                <div className="pointer-events-none absolute right-8 top-8 opacity-10">
                                    <Trophy className="cr-trophy h-32 w-32" />
                                </div>

                                <div className="relative z-10 flex flex-col items-center text-center">
                                    <span className="mb-2 block text-[11px] font-extrabold uppercase tracking-[0.16em] text-primary-foreground/70">
                                        {subjectLabel} · Section Score
                                    </span>

                                    <div className="flex items-end justify-center gap-4">
                                        <p className="text-7xl font-black leading-[0.95] tracking-tight tabular-nums">
                                            {review.total_score}
                                        </p>
                                        {delta != null && (
                                            <span
                                                className={`mb-4 inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-extrabold ${
                                                    delta > 0
                                                        ? "bg-emerald-500/90 text-white"
                                                        : delta < 0
                                                        ? "bg-rose-500/90 text-white"
                                                        : "bg-white/20 text-primary-foreground"
                                                }`}
                                            >
                                                {delta > 0 ? (
                                                    <>
                                                        <ArrowUp className="h-3.5 w-3.5" /> +{delta} pts
                                                    </>
                                                ) : delta < 0 ? (
                                                    <>
                                                        <ArrowDown className="h-3.5 w-3.5" /> {delta} pts
                                                    </>
                                                ) : (
                                                    <>±0</>
                                                )}
                                            </span>
                                        )}
                                    </div>
                                    <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.2em] text-primary-foreground/60">
                                        {scoreLabel} · {scoreMax}
                                    </p>

                                    {/* Midterm students see ONLY their score — never the
                                        per-question correctness. The teacher gets the full
                                        breakdown from the admin results section. */}
                                    {review.score_only && (
                                        <p className="mt-6 max-w-md text-center text-sm font-medium text-primary-foreground/80">
                                            Your teacher can review the full breakdown of your answers.
                                        </p>
                                    )}

                                    {!review.score_only && (
                                        <div className="mt-8 grid w-full max-w-3xl grid-cols-2 gap-6 md:grid-cols-4">
                                            <div className="flex flex-col items-center">
                                                <p className="text-3xl font-black tabular-nums text-emerald-300">{review.total_correct}</p>
                                                <p className="mt-1 text-[11px] font-bold uppercase tracking-wider text-primary-foreground/60">Correct</p>
                                            </div>
                                            <div className="flex flex-col items-center">
                                                <p className="text-3xl font-black tabular-nums text-rose-300">{review.total_incorrect}</p>
                                                <p className="mt-1 text-[11px] font-bold uppercase tracking-wider text-primary-foreground/60">Incorrect</p>
                                            </div>
                                            <div className="flex flex-col items-center">
                                                <p className="text-3xl font-black tabular-nums text-primary-foreground">{review.total_skipped}</p>
                                                <p className="mt-1 text-[11px] font-bold uppercase tracking-wider text-primary-foreground/60">Omitted</p>
                                            </div>
                                            <div className="flex flex-col items-center">
                                                <p className="text-3xl font-black tabular-nums text-sky-300">{Math.round(review.score_percentage || 0)}%</p>
                                                <p className="mt-1 text-[11px] font-bold uppercase tracking-wider text-primary-foreground/60">Accuracy</p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })()}

                    {/* Answer review — module tabs + active module table.
                        Midterm (score_only) hides the per-question breakdown. */}
                    {!review.score_only && review.module_results && review.module_results.length > 0 && (() => {
                        const modules = review.module_results;
                        const active = modules[activeModule] || modules[0];
                        const rowAnim = (active?.module_order || 1) % 2 ? "cr-rowslide-a" : "cr-rowslide-b";
                        return (
                            <div className="rounded-3xl border border-border bg-card p-6 shadow-sm sm:p-7">
                                <div className="mb-5 flex flex-wrap items-center gap-4">
                                    <h2 className="text-xl font-extrabold tracking-tight text-foreground">Answer review</h2>
                                    <div className="flex-1" />
                                    {/* Module tabs */}
                                    <div className="flex gap-1 rounded-2xl bg-surface-2 p-1">
                                        {modules.map((m: any, mi: number) => {
                                            const isActive = mi === activeModule;
                                            return (
                                                <button
                                                    key={m.module_id}
                                                    onPointerDown={spawnRipple}
                                                    onClick={() => { setActiveModule(mi); setAnimRows(true); }}
                                                    className={`cr-ripple cr-press rounded-xl px-4 py-2 text-sm font-bold transition-colors ${
                                                        isActive
                                                            ? "bg-card text-primary shadow-sm"
                                                            : "bg-transparent text-muted-foreground hover:text-foreground"
                                                    }`}
                                                >
                                                    Module {m.module_order}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* Per-module points summary */}
                                <div className="mb-4 flex flex-wrap items-center gap-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                                    <span>
                                        Earned: <span className="text-foreground">{active.module_earned}</span>
                                        {active.capped_earned !== active.module_earned && (
                                            <span className="ml-1 text-primary">(Capped: {active.capped_earned})</span>
                                        )}
                                    </span>
                                    <span className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-3.5 py-1.5">
                                        <span>Points Contributed</span>
                                        <span className="text-base font-black text-foreground">+{active.capped_earned}</span>
                                    </span>
                                </div>

                                <div className="overflow-x-auto">
                                    <div className="min-w-[680px]">
                                        {/* header — light pill row */}
                                        <div className="grid grid-cols-[120px_110px_110px_1fr_96px] gap-3 rounded-[10px] bg-surface-2 px-4 py-[11px] text-[11px] font-extrabold uppercase tracking-[0.05em] text-label-foreground">
                                            <div>Question</div>
                                            <div>Your Answer</div>
                                            <div>Correct</div>
                                            <div>Outcome</div>
                                            <div className="text-right">Action</div>
                                        </div>
                                        <div key={`mod-${activeModule}`}>
                                            {active.questions.map((q: any, i: number) => {
                                                const isOmitted = !q.student_answer || String(q.student_answer).trim() === "";
                                                const outcomeBar = isOmitted
                                                    ? "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
                                                    : q.is_correct
                                                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                                                    : "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300";
                                                // On tab change, slide rows in (parity-based direction);
                                                // otherwise use the staggered entry animation.
                                                const animClass = animRows ? rowAnim : "cr-rowin2";
                                                return (
                                                    <div
                                                        key={q.id}
                                                        className={`${animClass} grid cursor-pointer grid-cols-[120px_110px_110px_1fr_96px] items-center gap-3 border-b border-border/60 px-4 py-3.5 transition-colors last:border-0 hover:bg-surface-2/60`}
                                                        style={{ animationDelay: `${i * 0.06}s` }}
                                                        onClick={() => setSelectedQuestion({ ...q, index_in_module: i + 1 })}
                                                    >
                                                        <span className="whitespace-nowrap text-[15px] font-extrabold text-foreground">Question {i + 1}</span>
                                                        <span className="text-[15px] font-bold">
                                                            {isOmitted ? (
                                                                <span className="italic text-muted-foreground">Omitted</span>
                                                            ) : (
                                                                <span className={q.is_correct ? "text-foreground" : "text-rose-600 dark:text-rose-400"}>{q.student_answer}</span>
                                                            )}
                                                        </span>
                                                        <span className="text-[15px] font-extrabold text-emerald-700 dark:text-emerald-400">
                                                            {showCorrectAnswers ? q.correct_answers : "—"}
                                                        </span>
                                                        {/* OUTCOME — full-width bar spanning the column */}
                                                        <div className={`flex w-full items-center justify-center rounded-md py-2 text-[11px] font-extrabold ${outcomeBar}`}>
                                                            {isOmitted ? "Omitted" : q.is_correct ? "Correct" : "Incorrect"}
                                                        </div>
                                                        <div className="text-right">
                                                            <button
                                                                onPointerDown={spawnRipple}
                                                                className="cr-ripple cr-press inline-flex items-center gap-1.5 rounded-[10px] border border-border bg-card px-3.5 py-2 text-[13px] font-extrabold text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
                                                                onClick={(e) => { e.stopPropagation(); setSelectedQuestion({ ...q, index_in_module: i + 1 }); }}
                                                            >
                                                                <Eye className="h-3.5 w-3.5" /> Explore
                                                            </button>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })()}
                </main>

                {/* Modal Overlay */}
                <QuestionReviewModal
                    question={selectedQuestion}
                    showCorrectAnswers={showCorrectAnswers}
                    onClose={() => setSelectedQuestion(null)}
                    onNext={(() => {
                        if (!selectedQuestion || !review.module_results) return undefined;
                        const allQs: any[] = [];
                        review.module_results.forEach((m: any) => {
                            m.questions.forEach((q: any, i: number) => {
                                allQs.push({ ...q, index_in_module: i + 1 });
                            });
                        });
                        const currentIdx = allQs.findIndex(q => q.id === selectedQuestion.id);
                        if (currentIdx !== -1 && currentIdx < allQs.length - 1) {
                            return () => setSelectedQuestion(allQs[currentIdx + 1]);
                        }
                        return undefined;
                    })()}
                    onPrevious={(() => {
                        if (!selectedQuestion || !review.module_results) return undefined;
                        const allQs: any[] = [];
                        review.module_results.forEach((m: any) => {
                            m.questions.forEach((q: any, i: number) => {
                                allQs.push({ ...q, index_in_module: i + 1 });
                            });
                        });
                        const currentIdx = allQs.findIndex(q => q.id === selectedQuestion.id);
                        if (currentIdx > 0) {
                            return () => setSelectedQuestion(allQs[currentIdx - 1]);
                        }
                        return undefined;
                    })()}
                />
            </div>
        </AuthGuard>
    );
}
