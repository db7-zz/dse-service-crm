import { StudentRecordPage } from "../../../../../src/operations/student-record-page";

export default async function Page({ params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await params;
  return <StudentRecordPage studentId={studentId} />;
}
