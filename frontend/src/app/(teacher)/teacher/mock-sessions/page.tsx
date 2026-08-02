import MockSessionsConsole from "@/features/mockSessions/MockSessionsConsole";

/**
 * The teacher's half of an invigilated mock sitting. Same console the admin sees, minus the
 * controls the server would refuse them: a teacher cannot mint a sitting or rotate its code,
 * but they let students in and press Start, because they are the one in the room.
 */
export default function TeacherMockSessionsPage() {
  return <MockSessionsConsole />;
}
