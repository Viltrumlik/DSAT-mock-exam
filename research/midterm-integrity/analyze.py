#!/usr/bin/env python3
"""Phase 3: browser-era analysis of midterm integrity events (RQ1–RQ3).

Reads the hashed extract (data/attempts.csv, data/strikes.csv) and writes, into results/:
four PNG figures and results.md, which states every number and how it was computed.

Only aggregates leave this script. Any group with fewer than MIN_STUDENTS distinct students
is suppressed. The app era is not analysed: the app was never required on the server, and
only 2 attempts were sat in it (see results.md, "Scope").

    .venv/bin/python analyze.py            # reads ./data, writes ./results
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import matplotlib.ticker as mticker  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from scipy import stats  # noqa: E402

HERE = Path(__file__).resolve().parent
DATA, OUT = HERE / "data", HERE / "results"

ERA_START = "2026-07-22"  # first stored strike: the off-screen rule was live from this day
MIN_STUDENTS = 10
SEED, BOOT = 20261030, 2000
GRACE_S = 3
# Same absence charged again: the browser waits the full 3 s grace before it reports again,
# so a continuation cannot arrive sooner than 3.0 s; the browser's own flag (Oct 19 on) puts
# every one at or below 4.02 s, and the nearest new absence at 5.45 s.
CONT_WINDOW = (3.0, 5.0)
SENSITIVITY_WINDOWS = [(3.0, 4.0), (3.0, 6.0), (2.5, 5.0)]

# Reference palette (dataviz skill, light mode), validated with validate_palette.js.
BLUE, ORANGE = "#2a78d6", "#eb6834"
SURFACE, INK, INK2, GRID = "#fcfcfb", "#0b0b0b", "#52514e", "#e6e5e1"


# ── statistics ──────────────────────────────────────────────────────────────────────────────
def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (math.nan, math.nan)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0.0, c - h), min(1.0, c + h))


def boot_mean(df: pd.DataFrame, col: str, rng) -> tuple[float, float]:
    """95 % CI of mean(col), resampling STUDENTS: all of one student's rows move together."""
    per = df.groupby("student_hash")[col].agg(["sum", "count"]).to_numpy(dtype=float)
    idx = rng.integers(0, len(per), (BOOT, len(per)))
    vals = per[idx, 0].sum(axis=1) / per[idx, 1].sum(axis=1)
    lo, hi = np.percentile(vals, [2.5, 97.5])
    return float(lo), float(hi)


def boot_diff(d1: pd.DataFrame, d2: pd.DataFrame, col: str, rng) -> tuple[float, float]:
    """95 % CI of mean1 - mean2, resampling students jointly (a student can be in both groups)."""
    g1 = d1.groupby("student_hash")[col].agg(["sum", "count"])
    g2 = d2.groupby("student_hash")[col].agg(["sum", "count"])
    per = g1.join(g2, how="outer", lsuffix="1", rsuffix="2").fillna(0).to_numpy(dtype=float)
    idx = rng.integers(0, len(per), (BOOT, len(per)))
    s = per[idx].sum(axis=1)
    vals = s[:, 0] / s[:, 1] - s[:, 2] / s[:, 3]
    lo, hi = np.percentile(vals, [2.5, 97.5])
    return float(lo), float(hi)


def newcombe_diff(k1, n1, k2, n2) -> tuple[float, float, float]:
    """Risk difference p1 - p2 with Newcombe's hybrid-Wilson 95 % CI."""
    p1, p2 = k1 / n1, k2 / n2
    l1, u1 = wilson(k1, n1)
    l2, u2 = wilson(k2, n2)
    d = p1 - p2
    return d, d - math.sqrt((p1 - l1) ** 2 + (u2 - p2) ** 2), d + math.sqrt((u1 - p1) ** 2 + (p2 - l2) ** 2)


def two_prop_z(k1, n1, k2, n2) -> tuple[float, float]:
    p = (k1 + k2) / (n1 + n2)
    z = (k1 / n1 - k2 / n2) / math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2))
    return z, 2 * stats.norm.sf(abs(z))


def risk_ratio(k1, n1, k2, n2) -> tuple[float, float, float]:
    rr = (k1 / n1) / (k2 / n2)
    se = math.sqrt(1 / k1 - 1 / n1 + 1 / k2 - 1 / n2)
    return rr, rr * math.exp(-1.96 * se), rr * math.exp(1.96 * se)


def cohens_h(p1, p2) -> float:
    return 2 * math.asin(math.sqrt(p1)) - 2 * math.asin(math.sqrt(p2))


def pct(x: float) -> str:
    return "n/a" if x is None or (isinstance(x, float) and math.isnan(x)) else f"{100 * x:.1f}%"


def ci(lo_hi) -> str:
    return f"{100 * lo_hi[0]:.1f}–{100 * lo_hi[1]:.1f}%"


def pval(p: float) -> str:
    return "< 0.001" if p < 0.001 else f"= {p:.3f}"


# ── data ────────────────────────────────────────────────────────────────────────────────────
def load():
    a = pd.read_csv(DATA / "attempts.csv", dtype={"student_hash": str, "attempt_hash": str})
    s = pd.read_csv(DATA / "strikes.csv", dtype={"student_hash": str, "attempt_hash": str})
    return a, s, json.loads((DATA / "manifest.json").read_text())


def browser_era(a: pd.DataFrame):
    excluded = {
        "app": int((a.client_type == "app").sum()),
        "unknown_client": int((a.client_type == "unknown").sum()),
        "before_rule": int(((a.client_type == "browser") & (a.exam_date < ERA_START)).sum()),
    }
    b = a[(a.client_type == "browser") & (a.exam_date >= ERA_START)].copy()
    b["warned"] = (b.warnings > 0).astype(int)
    b["forced"] = (b.forced_submit == 1).astype(int)
    return b, excluded


def absences(strikes: pd.DataFrame, b: pd.DataFrame, window) -> pd.DataFrame:
    """One row per absence: the strikes it covered and whether it outlasted the 3 s grace."""
    s = strikes[strikes.attempt_hash.isin(b.attempt_hash)].sort_values(["attempt_hash", "seconds_since_start"])
    s = s.assign(cont=s.gap_prev_s.between(*window))
    rows = []
    for att, g in s.groupby("attempt_hash", sort=False):
        cur = None
        for x in g.itertuples():
            if cur is None or not x.cont:
                if cur is not None:
                    rows.append(cur)
                cur = {"attempt_hash": att, "student_hash": x.student_hash, "strikes": 0, "ended_paper": False}
            cur["strikes"] += 1
            cur["ended_paper"] = x.ended_paper == 1
        rows.append(cur)
    ab = pd.DataFrame(rows)
    # A one-strike absence that ended the paper had no grace at all: how long it lasted is unknown.
    ab["outcome"] = np.where(ab.strikes >= 2, "outlasted",
                             np.where(ab.ended_paper, "unknown", "returned_within_grace"))
    ab["short"] = (ab.outcome == "returned_within_grace").astype(int)
    return ab


def forfeit_patterns(ab: pd.DataFrame, b: pd.DataFrame) -> pd.DataFrame:
    f = b[b.forced == 1][["attempt_hash", "student_hash", "submit_delay_s"]].copy()
    per = ab.groupby("attempt_hash").agg(n_abs=("strikes", "size"),
                                         any_long=("outcome", lambda o: bool((o == "outlasted").any())))
    f = f.join(per, on="attempt_hash")
    f["pattern"] = np.select([f.n_abs == 1, f.any_long.astype(bool)], ["one_continuous", "several_incl_long"],
                             "all_short")
    f["after_deadline"] = f.submit_delay_s > 0
    return f


# ── figures ─────────────────────────────────────────────────────────────────────────────────
def new_fig(w=7.2, h=4.0):
    fig, ax = plt.subplots(figsize=(w, h), dpi=200)
    fig.patch.set_facecolor(SURFACE)
    return fig, ax


def style(ax, title, ylabel=None, xlabel=None, grid_axis="y"):
    ax.set_facecolor(SURFACE)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(GRID)
    ax.tick_params(colors=INK2, labelsize=9)
    ax.grid(axis=grid_axis, color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)
    ax.set_title(title, loc="left", color=INK, fontsize=11, pad=12)
    if ylabel:
        ax.set_ylabel(ylabel, color=INK2, fontsize=9)
    if xlabel:
        ax.set_xlabel(xlabel, color=INK2, fontsize=9)


def save(fig, path):
    fig.tight_layout()
    fig.savefig(path, facecolor=SURFACE)
    plt.close(fig)


def fig_monthly(rows: list[dict], path: Path):
    fig, ax = new_fig()
    rows = [r for r in rows if r["ok"]]
    x = np.arange(len(rows))
    for key, colour, label in (("warn", BLUE, "≥ 1 warning"), ("forced", ORANGE, "Forced submission")):
        y = np.array([r[key] for r in rows]) * 100
        err = np.array([[r[key] - r[f"{key}_ci"][0] for r in rows], [r[f"{key}_ci"][1] - r[key] for r in rows]]) * 100
        ax.errorbar(x, y, yerr=err, color=colour, linewidth=2, marker="o", markersize=7, markeredgecolor=SURFACE,
                    markeredgewidth=2, capsize=3, elinewidth=1, label=label)
        ax.annotate(f"{label}", (x[-1], y[-1]), xytext=(10, 0), textcoords="offset points", va="center",
                    color=INK2, fontsize=9)
    ax.set_xticks(x, [f"{r['label']}\nn = {r['n']}" for r in rows])
    ax.set_ylim(0, 100)
    ax.set_xlim(-0.4, len(rows) - 0.1)
    ax.yaxis.set_major_formatter(mticker.PercentFormatter())
    months = [r["group"] for r in rows]
    if "2026-10" in months:
        xv = months.index("2026-10") - 0.15
        ax.axvline(xv, color=INK2, linewidth=1, linestyle=(0, (3, 3)))
        ax.text(xv - 0.05, 97, "App available, not required (11 Oct)", ha="right", va="top", fontsize=8, color=INK2)
    ax.legend(frameon=False, fontsize=9, loc="upper left", labelcolor=INK2)
    style(ax, "Browser midterms: attempts with a warning, and forced submissions",
          ylabel="Share of attempts (95% Wilson CI)", xlabel="Month (July = 22–31 July)")
    save(fig, path)


def fig_gaps(gaps: pd.Series, window, path: Path):
    fig, ax = new_fig()
    edges = np.logspace(np.log10(0.2), np.log10(max(gaps.max(), 5000)), 60)
    ax.hist(gaps, bins=edges, color=BLUE, edgecolor=SURFACE, linewidth=0.6, zorder=3)
    ax.set_xscale("log")
    ax.axvspan(*window, color=ORANGE, alpha=0.2, linewidth=0, zorder=1)
    ymax = ax.get_ylim()[1]
    ax.text(window[1] * 1.1, ymax * 0.92, f"Same absence charged again\n({window[0]:g}–{window[1]:g} s after the last strike)",
            fontsize=8, color=INK2, va="top")
    ax.set_xticks([0.3, 1, 3, 10, 60, 600, 3600], ["0.3 s", "1 s", "3 s", "10 s", "1 min", "10 min", "1 h"])
    ax.xaxis.set_minor_locator(mticker.NullLocator())
    style(ax, "Time between consecutive strikes in one attempt (browser)", ylabel="Strikes",
          xlabel="Seconds since the previous strike (log scale)")
    save(fig, path)


def fig_forfeit_timing(minutes_left: pd.Series, path: Path):
    fig, ax = new_fig()
    edges = np.arange(math.floor(minutes_left.min() / 5) * 5, math.ceil(minutes_left.max() / 5) * 5 + 5, 5)
    ax.hist(minutes_left[minutes_left >= 0], bins=edges, color=BLUE, edgecolor=SURFACE, linewidth=1,
            label="Before the deadline")
    ax.hist(minutes_left[minutes_left < 0], bins=edges, color=ORANGE, edgecolor=SURFACE, linewidth=1,
            label="After time ran out")
    ax.axvline(0, color=INK2, linewidth=1)
    ax.invert_xaxis()
    ax.legend(frameon=False, fontsize=9, labelcolor=INK2)
    style(ax, "When forced submissions happened, relative to the module deadline", ylabel="Forced submissions",
          xlabel="Minutes left in the module (negative = after time ran out)")
    save(fig, path)


PATTERN_NAMES = {
    "all_short": "Every absence ended within the 3 s grace\n(the third ended the paper at once)",
    "several_incl_long": "Several absences, at least one\nlonger than the grace",
    "one_continuous": "One continuous absence\n(about 6.3 s or more)",
}
PATTERN_ORDER = ["all_short", "several_incl_long", "one_continuous"]


def fig_patterns(tab: pd.DataFrame, path: Path):
    fig, ax = new_fig(h=3.3)
    y = np.arange(len(PATTERN_ORDER))
    before = np.array([int(tab.loc[p, "before"]) if p in tab.index else 0 for p in PATTERN_ORDER])
    after = np.array([int(tab.loc[p, "after"]) if p in tab.index else 0 for p in PATTERN_ORDER])
    ax.barh(y, before, color=BLUE, height=0.6, edgecolor=SURFACE, linewidth=2, label="Before the deadline")
    ax.barh(y, after, left=before, color=ORANGE, height=0.6, edgecolor=SURFACE, linewidth=2,
            label="After time ran out")
    for i, tot in enumerate(before + after):
        ax.text(tot + 2, i, str(tot), va="center", fontsize=9, color=INK)
    ax.set_yticks(y, [PATTERN_NAMES[p] for p in PATTERN_ORDER], fontsize=8.5)
    ax.invert_yaxis()
    ax.set_xlim(0, (before + after).max() * 1.12)
    ax.legend(frameon=False, fontsize=9, labelcolor=INK2, loc="upper right")
    style(ax, "Forced submissions by the absences that caused them", xlabel="Forced submissions", grid_axis="x")
    save(fig, path)


# ── tables ──────────────────────────────────────────────────────────────────────────────────
def group_table(b: pd.DataFrame, key: str, labels=None) -> list[dict]:
    rows = []
    for val, g in b.groupby(key):
        n, ns = len(g), g.student_hash.nunique()
        kw, kf = int(g.warned.sum()), int(g.forced.sum())
        rows.append({"group": val, "label": (labels or {}).get(val, val), "n": n, "students": ns,
                     "ok": ns >= MIN_STUDENTS, "kw": kw, "kf": kf, "warn": kw / n, "warn_ci": wilson(kw, n),
                     "forced": kf / n, "forced_ci": wilson(kf, n)})
    return rows


def md_group_table(rows, title) -> str:
    out = [f"| {title} | Attempts | Students | ≥ 1 warning (95% CI) | Forced submission (95% CI) |",
           "|---|---:|---:|---|---|"]
    for r in rows:
        if r["ok"]:
            out.append(f"| {r['label']} | {r['n']} | {r['students']} | {r['kw']} = {pct(r['warn'])} "
                       f"({ci(r['warn_ci'])}) | {r['kf']} = {pct(r['forced'])} ({ci(r['forced_ci'])}) |")
        else:
            out.append(f"| {r['label']} | {r['n']} | < {MIN_STUDENTS} | suppressed | suppressed |")
    return "\n".join(out)


# ── analysis ────────────────────────────────────────────────────────────────────────────────
def main():
    OUT.mkdir(exist_ok=True)
    rng = np.random.default_rng(SEED)
    a, s, manifest = load()
    cov = manifest["coverage_utc"]
    b, excluded = browser_era(a)
    n, ns = len(b), b.student_hash.nunique()

    # RQ1 — overall and by group
    kw, kf = int(b.warned.sum()), int(b.forced.sum())
    warn_boot, forced_boot = boot_mean(b, "warned", rng), boot_mean(b, "forced", rng)
    mean_w, mean_w_boot = b.warnings.mean(), boot_mean(b, "warnings", rng)
    wdist = b.warnings.value_counts().sort_index()
    month_rows = group_table(b, "month", {"2026-07": "Jul*", "2026-08": "Aug", "2026-09": "Sep", "2026-10": "Oct"})
    fig_monthly(month_rows, OUT / "fig1_monthly_rates.png")
    subj_rows = group_table(b, "subject", {"MATH": "Math", "READING_WRITING": "Reading & Writing"})
    type_rows = group_table(b, "exam_type", {"MIDTERM": "Midterm", "PRE_MIDTERM": "Pre-midterm", "RETAKE": "Retake"})
    level_rows = group_table(b, "level", {"foundation": "Foundation", "junior": "Junior", "middle": "Middle",
                                          "senior": "Senior"})

    m, rw = b[b.subject == "MATH"], b[b.subject == "READING_WRITING"]
    comp = {}
    for col in ("forced", "warned"):
        k1, n1, k2, n2 = int(m[col].sum()), len(m), int(rw[col].sum()), len(rw)
        z, p = two_prop_z(k1, n1, k2, n2)
        d, dlo, dhi = newcombe_diff(k1, n1, k2, n2)
        comp[col] = dict(k1=k1, n1=n1, k2=k2, n2=n2, z=z, p=p, d=d, dlo=dlo, dhi=dhi, rr=risk_ratio(k1, n1, k2, n2),
                         dboot=boot_diff(m, rw, col, rng), h=cohens_h(k1 / n1, k2 / n2))
    u = stats.mannwhitneyu(m.warnings, rw.warnings, alternative="two-sided")
    rank_biserial = 2 * u.statistic / (len(m) * len(rw)) - 1

    f = b[b.forced == 1]
    minutes_left = -f.submit_delay_s / 60
    late = f[f.submit_delay_s > 0]
    fig_forfeit_timing(minutes_left, OUT / "fig3_forfeit_timing.png")

    # RQ2
    src = b.submit_source.value_counts()
    swept = int(b.swept_late.sum())
    swept_months = b[b.swept_late == 1].month.value_counts().sort_index()
    late_months = late.month.value_counts().sort_index()
    late_never_m2 = int((late.reached_module_2 == 0).sum())
    post_close = int((b.post_close_saves > 0).sum())
    cs = b[b.submit_source == "client_submit"].submit_delay_s
    cs_at_deadline = int((cs.abs() <= 60).sum())

    # RQ3
    sb = s[s.attempt_hash.isin(b.attempt_hash)]
    gaps = sb.gap_prev_s.dropna()
    fig_gaps(gaps, CONT_WINDOW, OUT / "fig2_strike_gaps.png")
    lab = sb[sb.audit_continuing.notna() & sb.gap_prev_s.notna()]
    truth = lab.audit_continuing.astype(str).str.lower() == "true"
    val = {}
    for wnd in [CONT_WINDOW] + SENSITIVITY_WINDOWS:
        pred = lab.gap_prev_s.between(*wnd)
        val[wnd] = dict(tp=int((pred & truth).sum()), fp=int((pred & ~truth).sum()),
                        fn=int((~pred & truth).sum()), tn=int((~pred & ~truth).sum()))
    lab_students = lab.student_hash.nunique()
    in_window, peak = int(gaps.between(*CONT_WINDOW).sum()), int(gaps.between(3.1, 3.3).sum())

    ab = absences(s, b, CONT_WINDOW)
    known = ab[ab.outcome != "unknown"]
    k_short = int(known.short.sum())
    short_boot = boot_mean(known, "short", rng)
    pat = forfeit_patterns(ab, b)
    tab = pd.crosstab(pat.pattern, pat.after_deadline.map({False: "before", True: "after"}))
    for col in ("before", "after"):
        if col not in tab:
            tab[col] = 0
    pat_students = pat.groupby("pattern").student_hash.nunique()
    fig_patterns(tab, OUT / "fig4_forfeit_patterns.png")
    sens = {}
    for wnd in SENSITIVITY_WINDOWS:
        abw = absences(s, b, wnd)
        pw = forfeit_patterns(abw, b)
        sens[wnd] = dict(short=abw[abw.outcome != "unknown"].short.mean(),
                         all_short=int((pw.pattern == "all_short").sum()),
                         continuous=int((pw.pattern == "one_continuous").sum()))
    n_short = int((pat.pattern == "all_short").sum())
    n_cont = int((pat.pattern == "one_continuous").sum())
    overlap = int(((pat.pattern == "all_short") & pat.after_deadline).sum())
    either = n_short + len(late) - overlap

    reasons = sb[sb.audit_reason.notna()]
    reason_counts = reasons.audit_reason.value_counts()
    reason_students = reasons.groupby("audit_reason").student_hash.nunique()

    # ── results.md ─────────────────────────────────────────────────────────────────────────
    L: list[str] = []
    w = L.append
    w("# Results: midterm integrity in the browser era\n")
    w(f"Generated by `analyze.py` from the extract of {manifest['generated_at_utc'][:10]} (extract script sha256 "
      f"`{manifest['script_sha256'][:12]}…`). Every number here is computed by that script; rerun it to reproduce. "
      f"Groups with fewer than {MIN_STUDENTS} distinct students are suppressed.\n")

    w("## Scope\n")
    w(f"- **No app era to compare.** The server setting that requires the app (`MIDTERM_DESKTOP_REQUIRED`) was never "
      f"set on production: it is absent from all 22 settings backups (May to 2026-10-28) and from the live settings. "
      f"Of {manifest['rows']['attempts']} started attempts, {excluded['app']} were sat in the app. Browser-vs-app "
      f"comparisons for RQ1 and RQ2 are **not estimable**; this report covers the browser era only.")
    w(f"- **Browser era:** attempts sat in the browser from {ERA_START} (first stored strike "
      f"{cov['first_browser_strike_row'][:16].replace('T', ' ')} UTC) to {cov['last_attempt_update'][:10]}: "
      f"**{n} attempts by {ns} students**.")
    w(f"- **Excluded:** {excluded['before_rule']} browser attempts before {ERA_START} (rule not yet live); "
      f"{excluded['app']} app attempts (fewer than {MIN_STUDENTS} students, suppressed); {excluded['unknown_client']} "
      f"attempts whose client cannot be determined; and, at extraction, "
      f"{manifest['rows']['attempts_excluded_non_student']} attempts by staff, non-student or test accounts.")
    w(f"- **Unit and dependence.** The unit is the attempt, and students repeat (mean {n / ns:.1f} attempts per "
      f"student), so attempts are not independent. Rates carry a Wilson 95% CI, which treats attempts as "
      f"independent, and a **student-level bootstrap** 95% CI ({BOOT} resamples of students, seed {SEED}). Where "
      f"they differ, the bootstrap is the honest one.\n")

    w("## RQ1: integrity warnings and forced submissions (browser)\n")
    w("| Measure | Value | Wilson 95% CI | Student-bootstrap 95% CI |")
    w("|---|---|---|---|")
    w(f"| Attempts with ≥ 1 warning | {kw} / {n} = {pct(kw / n)} | {ci(wilson(kw, n))} | {ci(warn_boot)} |")
    w(f"| Forced submissions | {kf} / {n} = {pct(kf / n)} | {ci(wilson(kf, n))} | {ci(forced_boot)} |")
    w(f"| Forced, among attempts with a warning | {kf} / {kw} = {pct(kf / kw)} | {ci(wilson(kf, kw))} | — |")
    w(f"| Warnings per attempt (mean) | {mean_w:.2f} | — | {mean_w_boot[0]:.2f}–{mean_w_boot[1]:.2f} |\n")
    w("Distribution: " + ", ".join(f"{int(k)} warning{'' if k == 1 else 's'}: {v} attempts" for k, v in wdist.items())
      + ". A warning is a strike the server counted (`offscreen_violations`). The third strike forces the "
        "submission, so every attempt with 3 warnings was forced.\n")
    w("**By month** (Figure 1, `fig1_monthly_rates.png`; *July = 22–31 July only):\n")
    w(md_group_table(month_rows, "Month") + "\n")
    w(md_group_table(subj_rows, "Subject") + "\n")
    w(md_group_table(type_rows, "Type") + "\n")
    w(md_group_table(level_rows, "Level") + "\n")
    w("**Math vs Reading & Writing.** This is the largest contrast in the data. It describes a confounder, not a "
      "research question.\n")
    for col, name in (("forced", "Forced submission"), ("warned", "≥ 1 warning")):
        c = comp[col]
        w(f"- {name}: {c['k1']}/{c['n1']} = {pct(c['k1'] / c['n1'])} (Math) vs {c['k2']}/{c['n2']} = "
          f"{pct(c['k2'] / c['n2'])} (R&W). Risk difference {100 * c['d']:.1f} points (Newcombe 95% CI "
          f"{100 * c['dlo']:.1f} to {100 * c['dhi']:.1f}; student-bootstrap {100 * c['dboot'][0]:.1f} to "
          f"{100 * c['dboot'][1]:.1f}); risk ratio {c['rr'][0]:.2f} (95% CI {c['rr'][1]:.2f}–{c['rr'][2]:.2f}); "
          f"Cohen's h = {c['h']:.2f}; two-proportion z = {c['z']:.2f}, p {pval(c['p'])}.")
    w(f"- Warnings per attempt (0–3): Mann-Whitney U = {u.statistic:.0f}, p {pval(u.pvalue)}, rank-biserial "
      f"r = {rank_biserial:.2f}.")
    w("- The z-test and Mann-Whitney treat attempts as independent; the bootstrap intervals do not. Subject is "
      "confounded with paper structure: Math midterms have two timed modules and no early hand-in.\n")
    q = minutes_left.quantile([0.1, 0.25, 0.5, 0.75, 0.9])
    w("**When forced submissions happened** (Figure 3, `fig3_forfeit_timing.png`). Minutes left = the module "
      "deadline minus the submission time, using the midterm's stored durations. Those durations check out: of "
      f"{len(cs)} client hand-ins, {cs_at_deadline} ({pct(cs_at_deadline / len(cs))}) land within 1 minute of the "
      "deadline they imply.\n")
    w(f"- {int((minutes_left >= 0).sum())} of {kf} forced submissions ({pct((minutes_left >= 0).mean())}) came "
      f"before the deadline. Minutes left across all forced submissions: median {q[0.5]:.1f}, quartiles "
      f"{q[0.25]:.1f} and {q[0.75]:.1f}, 10th–90th percentile {q[0.1]:.1f} to {q[0.9]:.1f}.")
    w(f"- **{len(late)} ({pct(len(late) / kf)}) came after the module's time had already run out**, by a median "
      f"{late.submit_delay_s.median() / 60:.1f} min (see RQ2).\n")

    w("## RQ2: connection failures and client–server mismatches (browser)\n")
    w("**Not measurable:** connection drops and reconnects. Neither client records them in the database (see the "
      "README, \"Not in the data\"). What the data does show:\n")
    w("| Measure | Value | Wilson 95% CI | How computed |")
    w("|---|---|---|---|")
    w(f"| Stuck attempts closed by the cleanup job | {swept} / {n} = {pct(swept / n)} | {ci(wilson(swept, n))} | no "
      f"client request at submission, submitted ≥ 30 min after the deadline; the job runs from cron every 15 min "
      f"(log since 2026-07-28) |")
    w(f"| Forced submissions **after** the module's time ran out | {len(late)} / {n} = {pct(len(late) / n)} "
      f"({late.student_hash.nunique()} students) | {ci(wilson(len(late), n))} | `forced_submit` = 1 and "
      f"`submit_delay_s` > 0 |")
    w(f"| Autosaves after the server had closed the paper | {post_close} attempts | — | `post_close_saves` > 0 |\n")
    w("How browser attempts ended: " + ", ".join(f"`{k}` {v} ({pct(v / n)})" for k, v in src.items()) + ".")
    w("Stuck attempts by month: " + ", ".join(f"{k}: {v}" for k, v in swept_months.items()) + ".\n")
    w("**After-deadline forfeits point to a client–server mismatch.** The browser arms the strike guard only while "
      "its own copy of the attempt says module 1 or 2 is running and a question is on screen (`ExamRunnerPage.tsx`, "
      "`offscreenEnforced`). The server would have moved the paper on at the first autosave or submit after the "
      f"deadline. In these {len(late)} attempts it never did: {late_never_m2} never reached module 2, yet strikes "
      f"kept arriving a median {late.submit_delay_s.median() / 60:.1f} min (quartiles "
      f"{late.submit_delay_s.quantile(0.25) / 60:.1f} and {late.submit_delay_s.quantile(0.75) / 60:.1f}) after "
      "module 1's time was up. The screen kept showing an expired module, and leaving it was charged as an "
      "integrity offence. By month: " + ", ".join(f"{k}: {v}" for k, v in late_months.items()) + ". The data "
      "cannot say why the screen did not advance (the server logs for August–September are gone). Report this as "
      "a measured symptom with an unknown cause.\n")

    w("## RQ3: how many forced submissions were likely false positives?\n")
    w("**The threshold cannot be chosen from the data.** Neither client records how long a student was away. The "
      "only length the data reveals is whether an absence outlasted the 3 s grace: if it did, the browser charged "
      "the same absence again about 3 s later. So the threshold is fixed at the grace, and the proxy for a false "
      "positive is \"returned within the grace\" (away for less than about 3 s, plus network delay).\n")
    w(f"**Recognising a continued absence** (Figure 2, `fig2_strike_gaps.png`). Of {len(gaps)} gaps between "
      f"consecutive strikes, {peak} fall between 3.1 and 3.3 s, a sharp peak just after the grace; {in_window} fall "
      f"in the window {CONT_WINDOW[0]:g}–{CONT_WINDOW[1]:g} s. The lower bound is mechanical: the browser reports "
      "again only after the full 3 s countdown, so a continuation cannot arrive sooner. The upper bound is "
      f"empirical: since {cov['first_strike_audit_row'][:10]} the browser also stores its own \"same absence\" flag. "
      f"Checked against that flag ({len(lab)} labelled gaps from {lab_students} students):\n")
    w("| Window | Continuations caught | False alarms | Missed | New absences, correct | Sensitivity | Precision |")
    w("|---|---:|---:|---:|---:|---|---|")
    for wnd, r in val.items():
        se = r["tp"] / (r["tp"] + r["fn"]) if r["tp"] + r["fn"] else math.nan
        pr = r["tp"] / (r["tp"] + r["fp"]) if r["tp"] + r["fp"] else math.nan
        w(f"| {wnd[0]:g}–{wnd[1]:g} s{' (used)' if wnd == CONT_WINDOW else ''} | {r['tp']} | {r['fp']} | {r['fn']} | "
          f"{r['tn']} | {pct(se)} | {pct(pr)} |")
    w("\nThe flag exists only from 19 October; earlier gaps are classified by the same rule without that check.\n")
    w(f"**Absences.** Joining each attempt's strikes into absences gives {len(ab)} absences. "
      f"{int((ab.outcome == 'unknown').sum())} ended the paper on their first strike, so their length is unknown. "
      f"Of the remaining {len(known)}, **{k_short} ({pct(k_short / len(known))}) ended within the 3 s grace** "
      f"(Wilson {ci(wilson(k_short, len(known)))}; student-bootstrap {ci(short_boot)}); "
      f"{len(known) - k_short} outlasted it.\n")
    w("**Forced submissions by the absences that caused them** (Figure 4, `fig4_forfeit_patterns.png`):\n")
    w("| Pattern | Before the deadline | After time ran out | Total | Students |")
    w("|---|---:|---:|---:|---:|")
    for p_ in PATTERN_ORDER:
        bf = int(tab.loc[p_, "before"]) if p_ in tab.index else 0
        af = int(tab.loc[p_, "after"]) if p_ in tab.index else 0
        st = int(pat_students.get(p_, 0))
        label = PATTERN_NAMES[p_].replace("\n", " ")
        if st < MIN_STUDENTS:
            w(f"| {label} | suppressed | suppressed | suppressed | < {MIN_STUDENTS} |")
        else:
            w(f"| {label} | {bf} | {af} | {bf + af} ({pct((bf + af) / kf)}) | {st} |")
    w(f"\n**Likely false positives, by the proxy: {n_short} of {kf} forced submissions ({pct(n_short / kf)}; Wilson "
      f"{ci(wilson(n_short, kf))}).** In each, the student came back within about 3 s every time it could be "
      f"measured, and the paper was taken in on a third leave. Separately, {len(late)} forced submissions "
      f"({pct(len(late) / kf)}) happened after the module's time had run out (RQ2): a false positive of a different "
      f"kind, since the paper should already have closed. Counting either kind once: {either} of {kf} "
      f"({pct(either / kf)}). At the other end, {n_cont} ({pct(n_cont / kf)}) came from one continuous absence of "
      "about 6.3 s or more. The proxy cannot see intent: a short absence can be deliberate, and a long one can be "
      "innocent (a student who had finished and walked away). It bounds plausibility; it does not count honest "
      "students.\n")
    w("**Sensitivity to the window:**\n")
    w("| Window | Absences ending within the grace | Forced: all short | Forced: one continuous |")
    w("|---|---|---:|---:|")
    w(f"| {CONT_WINDOW[0]:g}–{CONT_WINDOW[1]:g} s (used) | {pct(k_short / len(known))} | {n_short} | {n_cont} |")
    for wnd, r in sens.items():
        w(f"| {wnd[0]:g}–{wnd[1]:g} s | {pct(r['short'])} | {r['all_short']} | {r['continuous']} |")
    w("")
    if len(reasons):
        w(f"**What the browser saw** (strikes since {cov['first_strike_audit_row'][:10]} only: {len(reasons)} strikes "
          f"from {reasons.student_hash.nunique()} students): " + ", ".join(
              f"`{k}` {v} ({pct(v / len(reasons))})" if reason_students.get(k, 0) >= MIN_STUDENTS
              else f"`{k}` suppressed (< {MIN_STUDENTS} students)" for k, v in reason_counts.items())
          + ". `blur` = focus moved to another window; `fullscreen` = fullscreen was exited; `hidden` = the page "
            "was hidden (another tab, minimised). None of these can tell a notification from a deliberate switch.\n")

    w("## Confounders and limitations\n")
    for item in (
        "**No comparison group.** The app was never required, so browser vs app is unanswered. A later comparison "
        "would be before/after, not randomised: different months, different papers.",
        "**Different exams and cohorts each month.** Papers, levels and the Math / Reading & Writing mix change by "
        "month, and students repeat across months, so monthly rates mix all of these.",
        "**Paper structure.** Two-module Math midterms started on 2026-07-28. A midterm cannot be handed in early, "
        "so students who finish can only wait. An earlier read-only review (2026-09-18) found most Math forfeits had "
        "every question answered. Many \"integrity\" events are exits from finished papers.",
        "**One long absence spends all three strikes.** An absence of about 6.3 s or more triggers strikes 1–3, so "
        "\"3 warnings\" does not mean three separate leaves.",
        "**No ground truth for cheating.** A strike records leaving the window, not misconduct. The false-positive "
        "proxy bounds plausibility only.",
        "**The browser client changed during the period.** Strike evidence (reason, same-absence flag) exists only "
        "from 2026-10-19, and the fullscreen-exit menu item was removed with PR #231 (merged 2026-10-16).",
        "**Timestamps are server arrival times.** Deadlines use the midterm's current durations; they match client "
        "hand-ins for nearly every exam, but an edited duration would shift `submit_delay_s`.",
        "**Novelty effect.** It would matter for a browser-vs-app comparison; it does not apply here.",
        f"**Client type is inferred** from the requests each attempt made; {excluded['unknown_client']} attempts could "
        "not be classified.",
    ):
        w(f"- {item}")
    w("\n## How each number was computed\n")
    for item in (
        f"Browser era = `client_type == \"browser\"` and `exam_date >= \"{ERA_START}\"` in `attempts.csv`.",
        "Warning = `warnings > 0`; forced = `forced_submit == 1`; minutes left = `-submit_delay_s / 60`.",
        f"Wilson score interval, z = 1.96. Student bootstrap: resample students with replacement {BOOT} times "
        f"(seed {SEED}), recompute the rate from the resampled students' attempts, take the 2.5th and 97.5th "
        "percentiles.",
        "Risk difference with Newcombe's hybrid score CI; risk ratio with a log-scale CI; Cohen's h = "
        "2·asin√p₁ − 2·asin√p₂; two-proportion z-test with the pooled proportion; Mann-Whitney U, two-sided, "
        "rank-biserial r = 2U/(n₁n₂) − 1.",
        f"Continued absence = gap to the previous strike in {CONT_WINDOW[0]:g}–{CONT_WINDOW[1]:g} s. An absence is a "
        "run of strikes joined by continuations. One strike that did not end the paper → ended within the grace; "
        "two or more strikes → outlasted the grace; one strike that ended the paper → length unknown.",
        "Forfeit pattern: one absence → \"one continuous\"; several absences, any outlasting the grace → \"several, "
        "at least one long\"; otherwise → \"all short\".",
        f"Suppression: any group with fewer than {MIN_STUDENTS} distinct students is reported as suppressed.",
    ):
        w(f"- {item}")
    w("\n## Figures\n")
    w("1. `fig1_monthly_rates.png`: share of attempts with ≥ 1 warning and with a forced submission, by month, with "
      "Wilson 95% CIs. The dashed line marks 11 October, when the app's API went live; it was never required.")
    w("2. `fig2_strike_gaps.png`: time between consecutive strikes in one attempt, log scale. The shaded band is "
      "the continuation window.")
    w("3. `fig3_forfeit_timing.png`: minutes left in the module when each forced submission happened.")
    w("4. `fig4_forfeit_patterns.png`: forced submissions by absence pattern, before and after time ran out.")
    (OUT / "results.md").write_text("\n".join(L) + "\n", encoding="utf-8")
    print(f"browser era n={n} students={ns}; wrote {OUT}/results.md and 4 figures")


if __name__ == "__main__":
    main()
