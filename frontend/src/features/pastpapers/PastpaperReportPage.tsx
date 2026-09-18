"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Award, Download, Target } from "lucide-react";
import { useAttemptReport } from "./pastpaperReportHooks";
import { pastpaperReportApi } from "./pastpaperReportApi";

function fmtDay(s: string | null | undefined): string {
  if (!s) return "";
  const d = new Date(s);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * The error report for one finished pastpaper, plus the certificate download.
 *
 * Styled with the `.dz` tokens rather than the classroom kit, because it is reached from
 * /pastpapers and has to look like the page it came from — the platform runs two design
 * systems and mixing them on one journey is what makes it obvious there are two.
 *
 * The report leads with the skill breakdown, not the question list. A student who has just
 * scored badly does not need a list of their mistakes — they need to know which one thing to
 * practise, and that is a different screen even though it is the same data.
 */
export function PastpaperReportPage({ attemptId }: { attemptId: number }) {
  const router = useRouter();
  const report = useAttemptReport(attemptId);
  // The report PDF, or the attempt id whose certificate is being prepared.
  const [downloading, setDownloading] = useState<null | "report" | number>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const historyRef = useRef<HTMLDivElement>(null);

  // The library card's "History" link lands on #history, and the list only exists once the
  // report has loaded — so the browser's own jump to the anchor finds nothing to scroll to.
  useEffect(() => {
    if (report.data && window.location.hash === "#history") {
      historyRef.current?.scrollIntoView({ block: "start" });
    }
  }, [report.data]);

  const save = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Two downloads, because they are two documents — the same split a midterm has. The
  // certificate goes by attempt: that works for every sitting in the history, and for the ones
  // finished before a certificate was ever minted.
  const downloadCertificate = async (forAttempt: number) => {
    setDownloading(forAttempt);
    setDownloadError(null);
    try {
      save(
        await pastpaperReportApi.downloadCertificateForAttempt(forAttempt),
        `MasterSAT-certificate-${forAttempt}.pdf`,
      );
    } catch {
      setDownloadError("The certificate couldn't be produced right now. Your result is safe.");
    } finally {
      setDownloading(null);
    }
  };

  const downloadReport = async () => {
    setDownloading("report");
    setDownloadError(null);
    try {
      save(
        await pastpaperReportApi.downloadReport(attemptId),
        `MasterSAT-error-report-${attemptId}.pdf`,
      );
    } catch {
      setDownloadError("The report couldn't be produced right now. Nothing has been lost.");
    } finally {
      setDownloading(null);
    }
  };

  // A sitting that earns a certificate shows the button whether or not one was ever minted: the
  // download mints it. `certificate_code` alone kept the button hidden on every sitting.
  const certificateAvailable =
    report.data?.certificate_available ?? Boolean(report.data?.certificate_code);
  const history = report.data?.history ?? [];

  return (
    <div className="dzboard" style={{ maxWidth: 900, margin: "0 auto", padding: "18px 16px 40px" }}>
      <button
        type="button"
        onClick={() => router.push("/pastpapers")}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 16,
          border: "none", background: "none", cursor: "pointer",
          fontFamily: "inherit", fontSize: 13, fontWeight: 700, color: "var(--dz-mute)",
        }}
      >
        <ArrowLeft size={15} /> Past papers
      </button>

      {report.isPending ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--dz-mute)", fontWeight: 600 }}>
          Loading your report…
        </div>
      ) : report.isError ? (
        <div
          style={{
            padding: 20, borderRadius: 14, background: "var(--dz-card)",
            border: "1px solid var(--dz-line)",
          }}
        >
          <div style={{ fontWeight: 800, color: "var(--dz-ink)", marginBottom: 6 }}>
            The report didn&apos;t load.
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--dz-mute)", marginBottom: 12 }}>
            Nothing has been lost — your score is safe.
          </div>
          <button
            type="button"
            onClick={() => void report.refetch()}
            className="dz-actionbtn"
            style={{
              padding: "9px 16px", borderRadius: 10, border: "none",
              background: "var(--dz-indigo)", color: "#fff",
              fontFamily: "inherit", fontSize: 13, fontWeight: 800, cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      ) : (
        <>
          {/* Score + certificate */}
          <div
            style={{
              padding: 22, borderRadius: 16, background: "var(--dz-card)",
              border: "1px solid var(--dz-line)", marginBottom: 16,
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".08em", color: "var(--dz-faint)" }}>
              {report.data.paper_title || "PAST PAPER"}
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 6 }}>
              <span style={{ fontSize: 44, fontWeight: 800, letterSpacing: "-.03em", color: "var(--dz-ink)", lineHeight: 1 }}>
                {report.data.score ?? "—"}
              </span>
              <span style={{ fontSize: 15, fontWeight: 700, color: "var(--dz-faint)" }}>/ 800</span>
            </div>
            <div style={{ marginTop: 8, fontSize: 14, fontWeight: 700, color: "var(--dz-ink)" }}>
              {report.data.headline}
            </div>

            <div style={{ marginTop: 16, display: "flex", flexWrap: "wrap", gap: 8 }}>
              {certificateAvailable ? (
                <button
                  type="button"
                  onClick={() => void downloadCertificate(attemptId)}
                  disabled={downloading !== null}
                  className="dz-actionbtn"
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 7,
                    padding: "11px 18px", borderRadius: 11, border: "none",
                    background: "var(--dz-indigo)", color: "#fff",
                    fontFamily: "inherit", fontSize: 13, fontWeight: 800, cursor: "pointer",
                  }}
                >
                  <Award size={15} />
                  {downloading === attemptId ? "Preparing…" : "Certificate"}
                </button>
              ) : null}
              {report.data.wrong > 0 ? (
                <button
                  type="button"
                  onClick={() => void downloadReport()}
                  disabled={downloading !== null}
                  className="dz-actionbtn"
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 7,
                    padding: "11px 18px", borderRadius: 11,
                    border: "1px solid var(--dz-line)", background: "transparent",
                    color: "var(--dz-ink)",
                    fontFamily: "inherit", fontSize: 13, fontWeight: 800, cursor: "pointer",
                  }}
                >
                  <Download size={15} />
                  {downloading === "report" ? "Preparing…" : "Error report PDF"}
                </button>
              ) : null}
            </div>
            {downloadError ? (
              <div style={{ marginTop: 10, fontSize: 12.5, fontWeight: 700, color: "var(--dz-mute)" }}>
                {downloadError}
              </div>
            ) : null}
          </div>

          {/* Every sitting of this paper, newest first, each with its own certificate. A paper a
              homework sets again is sat again, and the sitting before it stays here. */}
          {history.length > 0 ? (
            <div ref={historyRef} id="history" style={{ marginBottom: 16, scrollMarginTop: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".1em", color: "var(--dz-faint)", margin: "0 0 10px 2px" }}>
                HISTORY
              </div>
              <div
                style={{
                  borderRadius: 16, overflow: "hidden",
                  background: "var(--dz-card)", border: "1px solid var(--dz-line)",
                }}
              >
                {history.map((row, i) => {
                  const here = row.attempt_id === attemptId;
                  const day = fmtDay(row.completed_at);
                  return (
                    <div
                      key={row.attempt_id}
                      style={{
                        display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8,
                        padding: "12px 16px",
                        borderTop: i === 0 ? "none" : "1px solid var(--dz-line)",
                      }}
                    >
                      <div style={{ flex: "1 1 140px", minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: 6 }}>
                          <span style={{ fontSize: 16, fontWeight: 800, color: "var(--dz-ink)" }}>
                            {row.score ?? "—"}
                          </span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--dz-faint)" }}>/ 800</span>
                          {i === 0 ? <Tag>Latest</Tag> : null}
                          {here ? <Tag>This report</Tag> : null}
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--dz-mute)" }}>
                          {day || "—"}
                        </div>
                      </div>
                      {here ? null : (
                        <button
                          type="button"
                          onClick={() => router.push(`/pastpapers/${row.attempt_id}/report`)}
                          className="dz-actionbtn"
                          style={{
                            padding: "7px 11px", borderRadius: 9,
                            border: "1px solid var(--dz-line)", background: "transparent",
                            color: "var(--dz-ink)",
                            fontFamily: "inherit", fontSize: 12, fontWeight: 800, cursor: "pointer",
                          }}
                        >
                          Report
                        </button>
                      )}
                      {certificateAvailable && row.score != null ? (
                        <button
                          type="button"
                          onClick={() => void downloadCertificate(row.attempt_id)}
                          disabled={downloading !== null}
                          aria-label={day ? `Certificate for ${day}` : "Certificate"}
                          className="dz-actionbtn"
                          style={{
                            display: "inline-flex", alignItems: "center", gap: 6,
                            padding: "7px 11px", borderRadius: 9, border: "none",
                            background: "var(--dz-indigo-soft)", color: "var(--dz-indigo)",
                            fontFamily: "inherit", fontSize: 12, fontWeight: 800, cursor: "pointer",
                          }}
                        >
                          <Download size={14} />
                          {downloading === row.attempt_id ? "Preparing…" : "Certificate"}
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* Totals */}
          <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
            {[
              { n: report.data.correct_count, l: "Correct" },
              { n: report.data.wrong, l: "To review" },
              { n: `${report.data.accuracy}%`, l: "Accuracy" },
            ].map((stat) => (
              <div
                key={stat.l}
                style={{
                  flex: 1, padding: "14px 16px", borderRadius: 14,
                  background: "var(--dz-card)", border: "1px solid var(--dz-line)",
                }}
              >
                <div style={{ fontSize: 26, fontWeight: 800, color: "var(--dz-ink)", lineHeight: 1 }}>
                  {stat.n}
                </div>
                <div style={{ marginTop: 4, fontSize: 11, fontWeight: 800, letterSpacing: ".08em", color: "var(--dz-faint)" }}>
                  {stat.l.toUpperCase()}
                </div>
              </div>
            ))}
          </div>

          {report.data.wrong === 0 ? (
            <div
              style={{
                padding: 28, borderRadius: 16, textAlign: "center",
                background: "var(--dz-card)", border: "1px solid var(--dz-line)",
              }}
            >
              <Target size={22} style={{ color: "var(--dz-indigo)" }} />
              <div style={{ marginTop: 8, fontSize: 15, fontWeight: 800, color: "var(--dz-ink)" }}>
                Nothing to review
              </div>
              <div style={{ marginTop: 4, fontSize: 13, fontWeight: 600, color: "var(--dz-mute)" }}>
                Every question correct.
              </div>
            </div>
          ) : (
            <>
              {/* Skills first — what to practise, not what went wrong. */}
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".1em", color: "var(--dz-faint)", margin: "0 0 10px 2px" }}>
                WHAT TO WORK ON
              </div>
              <div
                style={{
                  borderRadius: 16, overflow: "hidden",
                  background: "var(--dz-card)", border: "1px solid var(--dz-line)", marginBottom: 20,
                }}
              >
                {report.data.skills.map((row, i) => (
                    <div
                      key={row.skill}
                      style={{
                        display: "flex", alignItems: "center", gap: 12, padding: "13px 16px",
                        borderTop: i === 0 ? "none" : "1px solid var(--dz-line)",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 800, color: "var(--dz-ink)" }}>
                          {row.skill}
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--dz-mute)" }}>
                          {row.domain} · questions {row.question_numbers.join(", ")}
                        </div>
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 800, color: "var(--dz-ink)" }}>
                          {row.wrong}/{row.total}
                        </div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--dz-faint)" }}>
                          {row.accuracy}% right
                        </div>
                      </div>
                    </div>
                  ))}
              </div>

              {/* The same disclosure the PDF carries. Untagged questions are counted but
                  never folded into a skill row, so without this line the skill totals would
                  look like they should add up to the mistake count and would not. */}
              {report.data.unclassified_wrong > 0 ? (
                <div style={{ margin: "-12px 2px 20px", fontSize: 12, fontWeight: 600, color: "var(--dz-mute)" }}>
                  {report.data.unclassified_wrong} of your mistakes are on questions that
                  aren&apos;t tagged with a skill yet, so they aren&apos;t in the list above.
                </div>
              ) : null}

              {/* Then the questions themselves, with both answers — "wrong" without the right
                  answer is a scolding rather than a lesson. */}
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".1em", color: "var(--dz-faint)", margin: "0 0 10px 2px" }}>
                YOUR MISTAKES
              </div>
              <div
                style={{
                  borderRadius: 16, overflow: "hidden",
                  background: "var(--dz-card)", border: "1px solid var(--dz-line)",
                }}
              >
                {report.data.questions.map((q, i) => (
                  <div
                    key={q.number}
                    style={{
                      display: "flex", alignItems: "center", gap: 12, padding: "12px 16px",
                      borderTop: i === 0 ? "none" : "1px solid var(--dz-line)",
                    }}
                  >
                    <div
                      style={{
                        width: 30, height: 30, borderRadius: 9, flexShrink: 0,
                        display: "grid", placeItems: "center",
                        background: "var(--dz-soft, rgba(99,102,241,.1))",
                        fontSize: 12.5, fontWeight: 800, color: "var(--dz-indigo)",
                      }}
                    >
                      {q.number}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--dz-ink)" }}>
                        {q.skill}
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--dz-mute)" }}>
                        You put <strong>{q.your_answer}</strong> · correct{" "}
                        <strong>{q.correct_answer}</strong>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 10.5, fontWeight: 800, letterSpacing: ".04em",
        color: "var(--dz-indigo)", background: "var(--dz-indigo-soft)",
        padding: "2px 7px", borderRadius: 6,
      }}
    >
      {children}
    </span>
  );
}
