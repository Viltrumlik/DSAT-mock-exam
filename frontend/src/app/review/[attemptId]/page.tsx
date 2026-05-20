"use client";
import React, { useMemo, useState, useEffect } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { examsStudentApi } from "@/features/examsStudent/api";
import AuthGuard from '@/components/AuthGuard';
import { CheckCircle2, XCircle, ArrowLeft, BarChart3, Eye, EyeOff, X, ChevronRight, BookOpen, AlertCircle, Lock } from 'lucide-react';
import { MathText } from '@/components/MathText';

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
                            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{question.type} · {question.is_correct ? 'Correct' : 'Incorrect'}</p>
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
                                        const isStudent = question.student_answer === key;
                                        const isCorrect = question.correct_answers === key;

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
    const confetti = useMemo(
        () =>
            Array.from({ length: 100 }).map((_, i) => ({
                id: i,
                left: Math.random() * 100,
                delay: Math.random() * 1.2,
                duration: 2.6 + Math.random() * 1.8,
                color: ['#2563eb', '#22c55e', '#eab308', '#ef4444', '#a855f7'][i % 5],
                size: 6 + Math.round(Math.random() * 6),
            })),
        []
    );

    const searchParams = useSearchParams();
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

    return (
        <AuthGuard>
            <div className="min-h-screen bg-background relative pb-20">
                <header className="bg-card border-b border-border px-8 py-4 flex justify-between items-center sticky top-0 z-40 shadow-sm">
                    <div className="flex items-center">
                        <button onClick={() => router.push('/')} className="mr-6 p-2 rounded-xl hover:bg-surface-2 transition-all border border-border shadow-sm">
                            <ArrowLeft className="w-4 h-4 text-muted-foreground" />
                        </button>
                        <div className="flex items-center gap-3 border-l border-border pl-6 ml-1">
                            <img src="/images/logo.png" alt="Master SAT" className="w-8 h-8 object-contain" />
                            <h1 className="text-xl font-extrabold tracking-tight text-foreground uppercase">Master SAT</h1>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setShowCorrectAnswers(!showCorrectAnswers)}
                            className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all border shadow-sm font-bold text-xs uppercase tracking-wider ${showCorrectAnswers ? 'bg-surface-2 text-muted-foreground border-border hover:bg-muted' : 'bg-foreground text-background border-foreground shadow-md hover:opacity-90'}`}
                        >
                            {showCorrectAnswers ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            {showCorrectAnswers ? 'Hide Answers' : 'Show Answers'}
                        </button>
                        <button
                            onClick={() => {
                                setShowCelebration(true);
                                setTimeout(() => setShowCelebration(false), 5000);
                            }}
                            className="flex items-center gap-2 px-4 py-2 rounded-xl transition-all border shadow-sm font-bold text-xs uppercase tracking-wider bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-200"
                        >
                            Celebration
                        </button>
                    </div>
                </header>

                {showCelebration && (
                    <div className="pointer-events-none fixed inset-0 z-[120] overflow-hidden">
                        {confetti.map((p) => (
                            <span
                                key={p.id}
                                className="absolute rounded-sm"
                                style={{
                                    left: `${p.left}%`,
                                    top: `-8%`,
                                    width: `${p.size}px`,
                                    height: `${p.size * 0.55}px`,
                                    backgroundColor: p.color,
                                    animation: `confetti-fall ${p.duration}s linear ${p.delay}s forwards`,
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

                    {/* Hero Summary */}
                    <div className="bg-card rounded-3xl p-10 border border-border mb-10 overflow-hidden relative shadow-sm">
                        <div className="absolute top-0 right-0 p-8 opacity-5 scale-[2] rotate-12 pointer-events-none text-foreground">
                            <BarChart3 className="w-64 h-64" />
                        </div>

                        <div className="relative z-10 flex flex-col items-center w-full text-center">
                            <div className="mb-6">
                                <span className="text-[10px] font-bold text-primary uppercase tracking-[0.2em] mb-3 block">
                                    Examination Completed · Historical Record
                                </span>
                                <h2 className="text-4xl font-black tracking-tight text-foreground mb-2">Congratulations! 🎉</h2>
                                <p className="text-muted-foreground font-medium">You have successfully completed the test.</p>
                            </div>

                            <div className="bg-foreground text-background rounded-[32px] px-12 py-8 shadow-xl flex flex-col items-center border-4 border-foreground/80 mb-8">
                                <p className="text-[11px] font-bold uppercase tracking-[0.3em] opacity-60 mb-2">
                                  {review.mock_kind === "MOCK_SAT" && review.subject === "READING_WRITING"
                                    ? "Reading & Writing Score"
                                    : review.mock_kind === "MOCK_SAT" && review.subject === "MATH"
                                    ? "Math Score"
                                    : "Score"}
                                </p>
                                <p className="text-7xl font-black tabular-nums">{review.total_score}</p>
                                <p className="text-[11px] font-bold opacity-40 mt-1 italic">
                                  {review.mock_kind === "MOCK_SAT" ? "/ 800 Max" : `/ ${review.total_questions} questions`}
                                </p>
                            </div>

                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full max-w-3xl">
                                <div className="bg-surface-2 rounded-2xl p-5 border border-border flex flex-col items-center">
                                    <p className="text-2xl font-bold text-emerald-600">{review.total_correct}</p>
                                    <p className="text-[9px] uppercase font-bold tracking-wider text-muted-foreground">Correct</p>
                                </div>
                                <div className="bg-surface-2 rounded-2xl p-5 border border-border flex flex-col items-center">
                                    <p className="text-2xl font-bold text-red-500">{review.total_incorrect}</p>
                                    <p className="text-[9px] uppercase font-bold tracking-wider text-muted-foreground">Incorrect</p>
                                </div>
                                <div className="bg-surface-2 rounded-2xl p-5 border border-border flex flex-col items-center">
                                    <p className="text-2xl font-bold text-foreground">{review.total_skipped}</p>
                                    <p className="text-[9px] uppercase font-bold tracking-wider text-muted-foreground">Omitted</p>
                                </div>
                                <div className="bg-surface-2 rounded-2xl p-5 border border-border flex flex-col items-center">
                                    <p className="text-2xl font-bold text-primary">{Math.round(review.score_percentage || 0)}%</p>
                                    <p className="text-[9px] uppercase font-bold tracking-wider text-muted-foreground">Accuracy</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Modular Analysis Sections */}
                    {review.module_results && review.module_results.map((module: any) => (
                        <div key={module.module_id} className="mb-10 animate-in slide-in-from-bottom-4 duration-500">
                            <div className="flex items-center gap-4 mb-4">
                                <div className="bg-foreground text-background w-10 h-10 rounded-xl flex items-center justify-center font-bold shadow-lg">
                                    {module.module_order}
                                </div>
                                <div>
                                    <h3 className="text-xl font-bold text-foreground">Module {module.module_order} Results</h3>
                                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
                                        Earned: <span className="text-foreground">{module.module_earned}</span>
                                        {module.capped_earned !== module.module_earned && <span className="text-primary ml-1"> (Capped: {module.capped_earned})</span>}
                                    </p>
                                </div>
                                <div className="ml-auto flex items-center gap-3 bg-card px-5 py-2.5 rounded-2xl border border-border shadow-sm">
                                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Points Contributed</span>
                                    <span className="text-lg font-black text-foreground">+{module.capped_earned}</span>
                                </div>
                            </div>

                            <div className="bg-card rounded-[24px] shadow-sm border border-border overflow-hidden">
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left border-collapse">
                                        <thead>
                                            <tr className="border-b border-border bg-surface-2/30">
                                                <th className="px-8 py-4 text-[10px] font-bold uppercase tracking-widest text-muted-foreground w-20">#</th>
                                                <th className="px-4 py-4 text-[10px] font-bold uppercase tracking-widest text-muted-foreground text-center">Your Answer</th>
                                                <th className="px-4 py-4 text-[10px] font-bold uppercase tracking-widest text-muted-foreground text-center">Correct Answer</th>
                                                <th className="px-4 py-4 text-[10px] font-bold uppercase tracking-widest text-muted-foreground w-28 text-center">Outcome</th>
                                                <th className="px-8 py-4 text-[10px] font-bold uppercase tracking-widest text-muted-foreground w-36 text-right">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {module.questions.map((q: any, i: number) => (
                                                <tr key={q.id} className="group hover:bg-surface-2/50 transition-colors border-b border-border/50 last:border-0 cursor-pointer" onClick={() => setSelectedQuestion({ ...q, index_in_module: i + 1 })}>
                                                    <td className="px-8 py-5">
                                                        <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border font-bold text-xs uppercase tracking-wider ${q.is_correct ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-red-50 text-red-700 border-red-100'}`}>
                                                            <span>Q{i + 1}</span>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-5 text-center font-bold text-foreground">
                                                        {q.student_answer || 'Omitted'}
                                                    </td>
                                                    <td className="px-4 py-5 text-center font-bold text-foreground">
                                                        {showCorrectAnswers ? q.correct_answers : '---'}
                                                    </td>
                                                    <td className="px-4 py-5">
                                                        <div className="flex justify-center">
                                                            {q.is_correct ? (
                                                                <div className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
                                                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                                                </div>
                                                            ) : (
                                                                <div className="w-6 h-6 rounded-full bg-red-100 text-red-500 flex items-center justify-center">
                                                                    <XCircle className="w-3.5 h-3.5" />
                                                                </div>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="px-8 py-5 text-right">
                                                        <button
                                                            className="inline-flex items-center gap-1.5 bg-surface-2 text-foreground border border-border font-bold uppercase tracking-wider text-[9px] px-4 py-2 rounded-lg hover:border-foreground transition-all active:scale-95"
                                                            onClick={(e) => { e.stopPropagation(); setSelectedQuestion({ ...q, index_in_module: i + 1 }); }}
                                                        >
                                                            <Eye className="w-3 h-3" /> Explore
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    ))}
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
