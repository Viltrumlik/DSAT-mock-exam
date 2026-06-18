import { ClassroomPickerList } from "@/features/classroom/pages/ClassroomPickerList";

export default function TeacherMaterialsPage() {
  return (
    <ClassroomPickerList
      tab="materials"
      title="Materials"
      description="Pick a classroom to upload and manage downloadable study materials."
    />
  );
}

