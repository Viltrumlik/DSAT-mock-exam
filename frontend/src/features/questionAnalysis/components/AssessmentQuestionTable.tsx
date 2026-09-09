import { formatCount } from "../format";
import type { AssessmentItemRow } from "../types";
import { RateValue } from "./Rate";

/**
 * Every assessment question, worst first — the full picture under the work list.
 *
 * `overflow-x-auto` around a `min-w` table: the table is wider than the classroom shell's
 * column and wider still than a phone, and a page that scrolls sideways as a whole is the
 * house rule this wrapper exists to keep.
 */
export function AssessmentQuestionTable({ rows }: { rows: AssessmentItemRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[46rem] text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="py-1.5 pr-3 font-semibold">#</th>
            <th className="py-1.5 pr-3 font-semibold">Question</th>
            <th className="py-1.5 pr-3 font-semibold">Set</th>
            <th className="py-1.5 pr-3 font-semibold">Type</th>
            <th className="py-1.5 pr-3 text-right font-semibold">Wrong</th>
            <th className="py-1.5 pr-3 text-right font-semibold">Graded</th>
            <th className="py-1.5 pr-3 text-right font-semibold">Not graded</th>
            <th className="py-1.5 text-right font-semibold">Error rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.question_id} className="border-t border-border align-top">
              <td className="py-2 pr-3 tabular-nums text-muted-foreground">{row.position}</td>
              <td className="max-w-md py-2 pr-3 text-foreground">
                <span className="line-clamp-2">{row.prompt || "—"}</span>
              </td>
              <td className="py-2 pr-3 text-muted-foreground">{row.set.title}</td>
              <td className="py-2 pr-3 text-muted-foreground">{row.question_type_label}</td>
              <td className="py-2 pr-3 text-right tabular-nums text-foreground">
                {formatCount(row.students_wrong)}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                {formatCount(row.students_graded)}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                {row.ungraded > 0 ? formatCount(row.ungraded) : "—"}
              </td>
              <td className="py-2 text-right font-semibold">
                <RateValue value={row.error_rate} flagged={row.needs_analysis} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
