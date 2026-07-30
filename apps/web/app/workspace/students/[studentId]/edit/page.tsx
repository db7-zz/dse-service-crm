"use client";

import { useParams } from "next/navigation";
import { StudentFormPage } from "../../../../../src/students/student-form-page";

export default function EditStudentPage() {
  const params = useParams<{ studentId: string }>();
  return <StudentFormPage mode="edit" studentId={params.studentId} />;
}
