#!/usr/bin/env python3
"""Figure 5: the browser's strike rule drawn as a timeline. A schematic, not data.

The timings come from the code, not the extract: the browser confirms a leave after
CONFIRM_S (useOffscreenGuard.ts, CONFIRM_MS = 250) and reports it; the server counts the
strike and grants GRACE_S (midterms/proctoring.py, GRACE_SECONDS = 3) after strikes 1 and 2;
strike 3 (VIOLATION_LIMIT) takes the paper in at once. A student still away when a grace
runs out is reported again, as the same absence. RTT_S is an illustrative fast network
round trip; every strike adds one, which is why Figure 2's peak sits at 3.1-3.3 s, not 3.0.

    .venv/bin/python fig_timeline.py       # writes ./results/fig5_strike_timeline.png
"""

from __future__ import annotations

import matplotlib.pyplot as plt

from analyze import BLUE, GRACE_S, INK, INK2, ORANGE, OUT, SURFACE, style

CONFIRM_S = 0.25
RTT_S = 0.05
ROWS = {"Student away": 2, "Countdown on screen": 1, "Server counts a strike": 0}
BAR_H = 0.42


def strike_times(leaves: list[tuple[float, float | None]]):
    """Walk the rule over absences (start, end); end=None = stays away. Returns strikes and countdowns."""
    strikes, countdowns = [], []
    for start, end in leaves:
        t = start + CONFIRM_S + RTT_S / 2  # the report reaches the server
        while True:
            strikes.append(t)
            if len(strikes) == 3:
                return strikes, countdowns
            shown = t + RTT_S / 2  # the reply starts the countdown in the browser
            expires = shown + GRACE_S
            if end is not None and end < expires:
                countdowns.append((shown, end))  # back in time: the countdown is cleared
                break
            countdowns.append((shown, expires))
            t = expires + RTT_S / 2  # still away: reported again, as the same absence
    return strikes, countdowns


def panel(ax, title, leaves, xmax, end_label="Paper taken in"):
    strikes, countdowns = strike_times(leaves)
    end_t = strikes[-1]
    away = [(s, (e if e is not None else end_t) - s) for s, e in leaves]
    ax.broken_barh(away, (ROWS["Student away"] - BAR_H / 2, BAR_H), color=ORANGE, edgecolor=SURFACE, linewidth=2)
    ax.broken_barh([(s, e - s) for s, e in countdowns], (ROWS["Countdown on screen"] - BAR_H / 2, BAR_H),
                   color=BLUE, edgecolor=SURFACE, linewidth=2)
    ax.plot(strikes, [ROWS["Server counts a strike"]] * 3, "o", color=INK, markersize=8,
            markeredgecolor=SURFACE, markeredgewidth=2, zorder=4)
    for i, t in enumerate(strikes, 1):
        ax.annotate(f"{i}", (t, 0), xytext=(0, -9), textcoords="offset points", ha="center", va="top",
                    fontsize=9, color=INK)
    ax.vlines(end_t, 0.3, 2.95, color=INK2, linewidth=1, linestyle=(0, (3, 3)), zorder=2)
    ax.text(end_t + xmax * 0.012, 2.62, end_label, fontsize=8.5, color=INK, va="center")
    ax.set_yticks(list(ROWS.values()), list(ROWS.keys()), fontsize=9)
    ax.set_ylim(-0.75, 2.95)
    ax.set_xlim(-xmax * 0.02, xmax)
    style(ax, title, xlabel="Seconds since the student first left", grid_axis="x")
    ax.tick_params(axis="y", length=0)
    ax.spines["left"].set_visible(False)
    return strikes


def note(ax, text, xy, dx, dy, ha="left"):
    ax.annotate(text, xy, xytext=(dx, dy), textcoords="offset points", fontsize=8, color=INK2, ha=ha, va="center")


def main():
    OUT.mkdir(exist_ok=True)
    fig, (a, b) = plt.subplots(2, 1, figsize=(7.2, 5.6), dpi=200)
    fig.patch.set_facecolor(SURFACE)

    s = panel(a, "A. One continuous absence spends all three strikes", [(0.0, None)], 7.6,
              f"Paper taken in\n≈ {CONFIRM_S + 2 * GRACE_S:.2f} s + network")
    note(a, f"Leave confirmed after\n{CONFIRM_S * 1000:.0f} ms: strike 1", (s[0], 0), 12, 0)
    for lo, hi in ((s[0], s[1]), (s[1], s[2])):
        a.text((lo + hi) / 2, 1.42, f"{GRACE_S} s grace", fontsize=8, color=INK2, ha="center")
    note(a, "Still away: the same\nabsence, charged again", (s[1], 0), 12, 0)

    # The third absence is cut where the paper is taken in: strike 3 has no grace to return in.
    leaves = [(0.0, 1.2), (6.0, 7.0), (12.0, None)]
    s = panel(b, "B. Three short absences, each back within the grace, also end it", leaves, 15.2)
    b.text(s[0], 1.42, "Back in time: the countdown clears, the strike stays", fontsize=8, color=INK2)
    note(b, "Strike 3 has no grace", (s[2], 0), -12, 0, ha="right")

    fig.text(0.01, 0.005, "Schematic. Timings from the code; network delay drawn as a fast "
             f"{RTT_S * 1000:.0f} ms round trip. Panel B's gaps between absences are illustrative.",
             fontsize=7.5, color=INK2, ha="left", va="bottom")
    fig.tight_layout(rect=(0, 0.03, 1, 1), h_pad=2.2)  # not save(): its tight_layout drops the footnote's room
    fig.savefig(OUT / "fig5_strike_timeline.png", facecolor=SURFACE)
    plt.close(fig)
    print("wrote", OUT / "fig5_strike_timeline.png")


if __name__ == "__main__":
    main()
