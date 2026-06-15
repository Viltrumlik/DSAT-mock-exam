import type { TeacherAnalyticsModel, StudentRecord, AssignmentRecord, RiskLevel } from "./useTeacherAnalytics";

function student(id: number, name: string, classId: number, className: string, reviewAvg: number | null, completionPct: number | null, practiceAverage: number | null, inactiveDays: number | null, overdueCount: number, assessmentLow: number | null): StudentRecord {
  const reasons: string[] = [];
  let level: RiskLevel = "on-track";
  if (assessmentLow != null) { reasons.push(`Average ${assessmentLow}%`); level = "at-risk"; }
  if (inactiveDays != null && inactiveDays >= 14) { reasons.push(`Inactive ${inactiveDays}d`); level = "at-risk"; }
  else if (inactiveDays != null && inactiveDays >= 7) { reasons.push(`Inactive ${inactiveDays}d`); if (level === "on-track") level = "watch"; }
  if (overdueCount >= 2) { reasons.push(`${overdueCount} missing`); level = "at-risk"; }
  else if (overdueCount === 1) { reasons.push("1 missing"); if (level === "on-track") level = "watch"; }
  return { id, name, classId, className, reviewAvg, completionPct, practiceAverage, assessmentLow, inactiveDays, overdueCount, riskLevel: level, riskReasons: reasons };
}
function assignment(id: number, title: string, classId: number, className: string, completionPct: number, submitted: number, total: number, isAssessment: boolean, isOverdue: boolean, groupMean: number | null): AssignmentRecord {
  return { id, title, classId, className, completionPct, submitted, total, isAssessment, isOverdue, groupMean, createdMs: null, effectiveness: completionPct < 50 ? "low-completion" : groupMean != null && groupMean < 1300 ? "challenging" : "healthy" };
}

const students: StudentRecord[] = [
  student(1, "Sara Kim", 1, "Math 101", 48, 60, 1180, 16, 3, 48),
  student(2, "Diyor Aliyev", 1, "Math 101", 91, 100, 1480, 0, 0, null),
  student(3, "Lola Tashkenova", 1, "Math 101", 68, 70, 1290, 9, 1, null),
  student(4, "Otabek Rashidov", 2, "Reading B", 95, 92, 1500, 1, 0, null),
  student(5, "Nodira S.", 2, "Reading B", 72, 80, 1330, 0, 0, null),
  student(6, "Jasur K.", 2, "Reading B", 55, 40, 1210, 8, 2, 55),
  student(7, "Madina T.", 3, "Mock cohort", 84, 88, 1420, 2, 0, null),
  student(8, "Aziz R.", 3, "Mock cohort", 77, 75, 1380, 0, 1, null),
  student(9, "Kamola N.", 3, "Mock cohort", 89, 95, 1460, 0, 0, null),
];

export const SAMPLE_TEACHER_ANALYTICS: TeacherAnalyticsModel = {
  classCount: 3,
  totalStudents: 9,
  atRiskCount: students.filter((s) => s.riskLevel === "at-risk").length,
  watchCount: students.filter((s) => s.riskLevel === "watch").length,
  classes: [
    { id: 1, name: "Math 101", students: 3, reviewAvg: 69, completion: 77, atRisk: 1 },
    { id: 2, name: "Reading B", students: 3, reviewAvg: 74, completion: 71, atRisk: 1 },
    { id: 3, name: "Mock cohort", students: 3, reviewAvg: 83, completion: 88, atRisk: 0 },
  ],
  students,
  assignments: [
    assignment(1, "Linear functions HW", 1, "Math 101", 92, 22, 24, false, false, null),
    assignment(2, "Inferences set", 2, "Reading B", 64, 12, 19, true, false, null),
    assignment(3, "Full mock 3", 3, "Mock cohort", 41, 9, 21, false, true, 1280),
    assignment(4, "Geometry basics", 1, "Math 101", 78, 19, 24, false, false, null),
    assignment(5, "Practice test 2", 3, "Mock cohort", 86, 18, 21, false, false, 1390),
    assignment(6, "Percentages quiz", 1, "Math 101", 48, 12, 24, true, true, null),
  ],
  classAvgTrend: [
    { label: "Mar 3", score: 1180 }, { label: "Mar 20", score: 1220 }, { label: "Apr 8", score: 1250 },
    { label: "Apr 26", score: 1290 }, { label: "May 14", score: 1320 }, { label: "Jun 1", score: 1360 },
  ],
  recommendations: [
    { id: "atrisk", title: "Check in with 2 at-risk students", detail: "Low averages, missing work, or inactivity.", href: "/teacher/students" },
    { id: "completion", title: "Boost completion on “Full mock 3”", detail: "41% turned in · Mock cohort", href: "/teacher/homework" },
    { id: "review", title: "Review “Full mock 3” as a class", detail: "Group mean below the class average.", href: "/teacher/gradebook" },
    { id: "inactive", title: "Re-engage 3 inactive students", detail: "No activity in 7+ days.", href: "/teacher/students" },
  ],
};
