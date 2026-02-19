// app/dashboard/home/page.tsx
import { redirect } from "next/navigation";

export default function DashboardHomeRedirect() {
  redirect("/dashboard");
}