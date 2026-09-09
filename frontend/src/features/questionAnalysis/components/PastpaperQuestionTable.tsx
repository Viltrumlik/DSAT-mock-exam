import { formatCount } from "../format";
import type { PastpaperItemRow } from "../types";
import { RateValue } from "./Rate";

/**
 * Every question on a past paper, in paper order.
 *
 * "Blank" keeps its own column beside "Wrong" for the same reason the flagged card keeps its
 * own sentence: a question the class ran out of time for and a question the class got wrong
 * are two different problems. `overflow-x-auto` around the `min-w` table so the page itself
 * never scrolls sideways.
 */
export function PastpaperQuestionTable({ rows }: { rows: PastpaperItemRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[54rem] text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="py-1.5 pr-3 font-semibold">#</th>
            <th className="py-1.5 pr-3 font-semibold">Module</th>
            <th className="py-1.5 pr-3 font-semibold">Question</th>
            <th className="py-1.5 pr-3 font-semibold">Type</th>
            <th className="py-1.5 pr-3 font-semibold">Skill</th>
            <th className="py-1.5 pr-3 text-right font-semibold">Saw it</th>
            <th className="py-1.5 pr-3 text-right font-semibold">Answered</th>
            <th className="py-1.5 pr-3 text-right font-semibold">Blank</th>
            <th className="py-1.5 pr-3 text-right font-semibold">Wrong</th>
            <th className="py-1.5 pr-3 text-right font-semibold">Error rate</th>
            <th className="py-1.5 text-right font-semibold">Miss rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.question_id} className="border-t border-border align-top">
              <td className="py-2 pr-3 tabular-nums text-muted-foreground">{row.number}</td>
              <td className="py-2 pr-3 text-muted-foreground">{row.module_label}</td>
              <td className="max-w-sm py-2 pr-3 text-foreground">
                <span className="line-clamp-2">{row.stem || "—"}</span>
              </td>
              <td className="py-2 pr-3 text-muted-foreground">{row.question_type_label}</td>
              <td className="py-2 pr-3 text-muted-foreground">{row.skill}</td>
              <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                {formatCount(row.seen)}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                {formatCount(row.answered)}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                {row.omitted > 0 ? formatCount(row.omitted) : "—"}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums text-foreground">
                {formatCount(row.wrong)}
              </td>
              <td className="py-2 pr-3 text-right font-semibold">
                <RateValue value={row.error_rate} flagged={row.needs_analysis} />
              </td>
              <td className="py-2 text-right">
                <RateValue value={row.miss_rate} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
