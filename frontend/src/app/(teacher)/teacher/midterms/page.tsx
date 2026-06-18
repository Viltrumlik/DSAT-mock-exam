import { ClassroomPickerList } from "@/features/classroom/pages/ClassroomPickerList";

export default function TeacherMidtermsPage() {
  return (
    <ClassroomPickerList
      tab="midterms"
      title="Midterms"
      description="Pick a classroom to assign an existing interactive midterm and review results."
    />
  );
}

